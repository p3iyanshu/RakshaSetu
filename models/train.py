"""
train.py -- Step 6 (per Member1_HANDOVER_REPORT.md section 5): trains
PointNet2SegMSG on the full real SemanticKITTI train split and validates on
sequence 08, following the handover's proposed recipe:

    Adam(betas=(0.9, 0.999)), initial lr=1e-3
    ReduceLROnPlateau(mode="max" on val mIoU, factor=0.5, patience=5, min_lr=1e-6)
    early stopping patience ~10 epochs, max epochs 50 (both configurable)
    checkpoint = best validation mIoU
    metrics: per-class IoU, mIoU, overall accuracy, per-class recall -- IGNORE_LABEL excluded from all

Per the handover's open items, this script is also where the two things it
explicitly deferred get done: real per-channel feature normalization stats
and real class weights, both computed from the actual train split (not the
4-frame verification subset) and cached so train/val/inference all apply the
identical transform.

    python train.py --data-root ../data/semantickitti/dataset
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from dataset import SemanticKITTIDataset, TRAIN_SEQUENCES, VAL_SEQUENCES
from pointnet2_seg import PointNet2SegMSG, build_loss, compute_class_weights, NUM_CLASSES
from feature_engineering import FEATURE_NAMES
from label_remap import IGNORE_LABEL
from metrics import IoUMeter

CKPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checkpoints")
STATS_PATH = os.path.join(CKPT_DIR, "dataset_stats.json")


def compute_dataset_stats(dataset, n_samples, num_classes, seed=0):
    """Real class weights + per-channel feature mean/std, from a random sample
    of frames drawn from the ACTUAL train split (not the 4-frame dev subset
    the handover explicitly says not to reuse). Also returns the raw class
    counts (diagnostic) and the number of scans/points the sample covered.

    A full pass over every one of ~19k train scans just for statistics would
    cost about as much CPU time as one training epoch, for numbers that
    stabilize with far fewer samples -- n_samples defaults to a few hundred
    scans (~millions of points), which is enough for stable mean/std/weights.
    """
    rng = np.random.default_rng(seed)
    idxs = rng.choice(len(dataset), size=min(n_samples, len(dataset)), replace=False)

    all_labels = []
    feat_sum = torch.zeros(len(FEATURE_NAMES), dtype=torch.float64)
    feat_sumsq = torch.zeros(len(FEATURE_NAMES), dtype=torch.float64)
    n_points = 0

    for i in idxs:
        item = dataset[int(i)]
        all_labels.append(item["labels"])
        feats = item["features"].double()
        feat_sum += feats.sum(dim=0)
        feat_sumsq += (feats ** 2).sum(dim=0)
        n_points += feats.shape[0]

    all_labels = torch.cat(all_labels)
    class_weights = compute_class_weights(all_labels, num_classes=num_classes, ignore_index=IGNORE_LABEL)

    valid = all_labels != IGNORE_LABEL
    class_counts = torch.bincount(all_labels[valid].to(torch.long), minlength=num_classes)

    mean = feat_sum / n_points
    var = (feat_sumsq / n_points) - mean ** 2
    std = var.clamp_min(1e-12).sqrt()

    return {
        "class_weights": class_weights.tolist(),
        "class_counts": class_counts.tolist(),
        "feature_mean": mean.tolist(),
        "feature_std": std.tolist(),
        "feature_names": FEATURE_NAMES,
        "n_scans_sampled": int(len(idxs)),
        "n_points_sampled": int(n_points),
    }


def normalize_features(features, mean, std):
    """xyz is intentionally never normalized (raw ego-frame geometry drives
    FPS/ball-query, per pointnet2_seg.py's docstring) -- only the 7 engineered
    feature channels are normalized, identically at train/val/inference."""
    return (features - mean) / std


def validate(model, loader, device, feat_mean, feat_std, num_classes):
    model.eval()
    meter = IoUMeter(num_classes)
    total_loss = 0.0
    n_batches = 0
    crit = build_loss(class_weights=None)  # unweighted for reporting -- weighting is a train-time-only choice
    with torch.no_grad():
        for batch in loader:
            xyz = batch["xyz"].to(device)
            feat = normalize_features(batch["features"], feat_mean, feat_std).to(device)
            labels = batch["labels"].to(device)
            logits = model(xyz, feat)
            loss = crit(logits.reshape(-1, num_classes), labels.reshape(-1))
            total_loss += loss.item()
            n_batches += 1
            preds = logits.argmax(dim=-1)
            meter.update(preds, labels)
    return total_loss / max(n_batches, 1), meter.compute()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data-root", default=os.path.join("..", "data", "semantickitti", "dataset"))
    p.add_argument("--num-points", type=int, default=8192)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--num-workers", type=int, default=4)
    p.add_argument("--val-every", type=int, default=1)
    p.add_argument("--early-stop-patience", type=int, default=10)
    p.add_argument("--lr-patience", type=int, default=5)
    p.add_argument("--lr-factor", type=float, default=0.5)
    p.add_argument("--min-lr", type=float, default=1e-6)
    p.add_argument("--stats-sample-scans", type=int, default=800)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--max-train-scans", type=int, default=None, help="cap train set size for fast iteration/debugging")
    p.add_argument("--max-val-scans", type=int, default=None, help="cap val set size for fast iteration/debugging")
    args = p.parse_args()

    os.makedirs(CKPT_DIR, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")

    train_ds = SemanticKITTIDataset(args.data_root, TRAIN_SEQUENCES, num_points_per_sample=args.num_points, seed=0)
    val_ds = SemanticKITTIDataset(args.data_root, VAL_SEQUENCES, num_points_per_sample=args.num_points, seed=1)
    if args.max_train_scans:
        train_ds.entries = train_ds.entries[: args.max_train_scans]
    if args.max_val_scans:
        val_ds.entries = val_ds.entries[: args.max_val_scans]
    print(f"train: {len(train_ds)} scans, val: {len(val_ds)} scans")

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                               num_workers=args.num_workers, drop_last=True,
                               persistent_workers=(args.num_workers > 0), prefetch_factor=(2 if args.num_workers > 0 else None))
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                             num_workers=args.num_workers,
                             persistent_workers=(args.num_workers > 0), prefetch_factor=(2 if args.num_workers > 0 else None))

    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            stats = json.load(f)
        print(f"loaded cached dataset stats from {STATS_PATH} ({stats['n_scans_sampled']} scans, {stats['n_points_sampled']:,} points)")
    else:
        print(f"computing class weights + feature normalization stats from {args.stats_sample_scans} real train scans...")
        stats = compute_dataset_stats(train_ds, args.stats_sample_scans, NUM_CLASSES)
        with open(STATS_PATH, "w") as f:
            json.dump(stats, f, indent=2)
        print(f"saved dataset stats to {STATS_PATH}")
    print("class_weights:", stats["class_weights"])
    print("class_counts:", stats["class_counts"])
    print("feature_mean:", stats["feature_mean"])
    print("feature_std:", stats["feature_std"])

    class_weights = torch.tensor(stats["class_weights"], dtype=torch.float32, device=device)
    feat_mean = torch.tensor(stats["feature_mean"], dtype=torch.float32)
    feat_std = torch.tensor(stats["feature_std"], dtype=torch.float32)

    model = PointNet2SegMSG(num_classes=NUM_CLASSES, in_channels=len(FEATURE_NAMES)).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr, betas=(0.9, 0.999))
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(
        opt, mode="max", factor=args.lr_factor, patience=args.lr_patience, min_lr=args.min_lr)
    crit = build_loss(class_weights=class_weights)

    start_epoch = 0
    best_miou = 0.0
    epochs_since_best = 0
    history = []
    last_ckpt_path = os.path.join(CKPT_DIR, "last.pth")
    if args.resume and os.path.exists(last_ckpt_path):
        ckpt = torch.load(last_ckpt_path, map_location=device)
        model.load_state_dict(ckpt["model_state_dict"])
        opt.load_state_dict(ckpt["optimizer_state_dict"])
        sched.load_state_dict(ckpt["scheduler_state_dict"])
        start_epoch = ckpt["epoch"] + 1
        best_miou = ckpt.get("best_miou", 0.0)
        epochs_since_best = ckpt.get("epochs_since_best", 0)
        history = ckpt.get("history", [])
        print(f"resumed from epoch {start_epoch}, best_miou so far {best_miou:.4f}")

    for epoch in range(start_epoch, args.epochs):
        model.train()
        t0 = time.time()
        running_loss = 0.0
        for step, batch in enumerate(train_loader):
            xyz = batch["xyz"].to(device)
            feat = normalize_features(batch["features"], feat_mean, feat_std).to(device)
            labels = batch["labels"].to(device)
            opt.zero_grad()
            logits = model(xyz, feat)
            loss = crit(logits.reshape(-1, NUM_CLASSES), labels.reshape(-1))
            loss.backward()
            opt.step()
            running_loss += loss.item()
            if step % 200 == 0:
                print(f"  epoch {epoch} step {step}/{len(train_loader)} loss {loss.item():.4f}")
        train_loss = running_loss / max(len(train_loader), 1)
        dt = time.time() - t0
        print(f"epoch {epoch} done in {dt:.0f}s, train_loss={train_loss:.4f}, lr={opt.param_groups[0]['lr']:.2e}")

        entry = {"epoch": epoch, "train_loss": train_loss, "time_s": dt, "lr": opt.param_groups[0]["lr"]}

        if (epoch + 1) % args.val_every == 0 or epoch == args.epochs - 1:
            val_loss, val_metrics = validate(model, val_loader, device, feat_mean, feat_std, NUM_CLASSES)
            miou = val_metrics["miou"]
            print(f"  val_loss={val_loss:.4f} mIoU={miou:.4f} acc={val_metrics['overall_accuracy']:.4f}")
            print(f"  per_class_iou={val_metrics['per_class_iou']}")
            print(f"  per_class_recall={val_metrics['per_class_recall']}")
            entry.update({"val_loss": val_loss, **val_metrics})

            sched.step(miou)

            if miou > best_miou:
                best_miou = miou
                epochs_since_best = 0
                torch.save({"model_state_dict": model.state_dict(), "epoch": epoch,
                            "miou": miou, "metrics": val_metrics, "dataset_stats": stats},
                           os.path.join(CKPT_DIR, "best.pth"))
                print(f"  new best mIoU {miou:.4f} -> saved best.pth")
            else:
                epochs_since_best += 1
                print(f"  no improvement for {epochs_since_best} validation round(s) (best={best_miou:.4f})")

        history.append(entry)
        torch.save({"model_state_dict": model.state_dict(), "optimizer_state_dict": opt.state_dict(),
                    "scheduler_state_dict": sched.state_dict(), "epoch": epoch, "best_miou": best_miou,
                    "epochs_since_best": epochs_since_best, "history": history}, last_ckpt_path)
        with open(os.path.join(CKPT_DIR, "history.json"), "w") as f:
            json.dump(history, f, indent=2)

        if epochs_since_best >= args.early_stop_patience:
            print(f"early stopping: no val mIoU improvement for {epochs_since_best} rounds "
                  f"(patience={args.early_stop_patience})")
            break

    print(f"training complete. best mIoU: {best_miou:.4f}")


if __name__ == "__main__":
    main()
