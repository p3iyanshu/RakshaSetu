"""
Trains PointNet2Seg on SemanticKITTI (sequences 00-07,09-10 train / 08 val --
the standard convention, keeps mIoU comparable to published numbers).

    python train.py --data-root ../data/semantickitti/dataset --epochs 40

Checkpoints go to models/checkpoints/ (gitignored -- never commit weights):
    last.pth  -- every epoch, for resuming (--resume)
    best.pth  -- highest validation mIoU seen so far; this is what
                 models/pointnet2.py's classify() loads by default
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from dataset import make_train_val_datasets, SemanticKITTIDataset, VAL_SEQUENCES
from pointnet2 import PointNet2Seg
from metrics import IoUMeter
from class_mapping import NUM_CLASSES, IGNORE

CKPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checkpoints")


def estimate_class_weights(dataset, num_classes, n_samples=300):
    """Median-frequency-style inverse class weighting from a random subsample of
    scans -- full pass over 19k scans just to count labels isn't worth the time."""
    counts = np.zeros(num_classes, dtype=np.int64)
    rng = np.random.default_rng(0)
    idxs = rng.choice(len(dataset), size=min(n_samples, len(dataset)), replace=False)
    for i in idxs:
        _, labels = dataset[i]
        labels = labels.numpy()
        valid = labels != IGNORE
        binc = np.bincount(labels[valid], minlength=num_classes)
        counts += binc
    freq = counts / counts.sum()
    weights = 1.0 / np.sqrt(freq + 1e-6)
    weights = weights / weights.mean()
    return torch.tensor(weights, dtype=torch.float32)


def validate(model, val_loader, device, num_classes):
    model.eval()
    meter = IoUMeter(num_classes)
    total_loss = 0.0
    n_batches = 0
    crit = nn.CrossEntropyLoss(ignore_index=IGNORE)
    with torch.no_grad():
        for points, labels in val_loader:
            points, labels = points.to(device), labels.to(device)
            logits = model(points)
            loss = crit(logits.reshape(-1, num_classes), labels.reshape(-1))
            total_loss += loss.item()
            n_batches += 1
            preds = logits.argmax(dim=-1)
            meter.update(preds, labels)
    per_class, miou = meter.compute()
    return total_loss / max(n_batches, 1), per_class, miou


def full_scan_spot_check(model, loader, device, num_classes):
    """Runs eval on complete, untruncated scans (batch_size=1, variable N) rather
    than the fixed-size subsample `validate()` uses. Catches a model that only
    works at training-time point density before a full 60-epoch run finishes --
    see pointnet_utils.py's docstring on ball query vs kNN for why that gap
    can otherwise be huge (0.91 vs 0.50 mIoU was observed here once)."""
    model.eval()
    meter = IoUMeter(num_classes)
    with torch.no_grad():
        for points, labels in loader:
            points, labels = points.to(device), labels.to(device)
            preds = model(points).argmax(dim=-1)
            meter.update(preds, labels)
    return meter.compute()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data-root", default=os.path.join("..", "data", "semantickitti", "dataset"))
    p.add_argument("--num-points", type=int, default=8192)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--num-workers", type=int, default=0)
    p.add_argument("--val-every", type=int, default=2)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--amp", action="store_true", default=True)
    p.add_argument("--max-train-scans", type=int, default=None, help="cap train set size for fast iteration/debugging")
    p.add_argument("--max-val-scans", type=int, default=None, help="cap val set size for fast iteration/debugging")
    p.add_argument("--full-scan-check-scans", type=int, default=150,
                   help="each validation round, also spot-check this many COMPLETE untruncated "
                        "scans (not the fixed-size training subsample) to catch a density-sensitive "
                        "model early. 0 disables it.")
    args = p.parse_args()

    os.makedirs(CKPT_DIR, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")

    train_ds, val_ds = make_train_val_datasets(args.data_root, num_points=args.num_points)
    if args.max_train_scans:
        train_ds.samples = train_ds.samples[: args.max_train_scans]
    if args.max_val_scans:
        val_ds.samples = val_ds.samples[: args.max_val_scans]
    print(f"train scans: {len(train_ds)}, val scans: {len(val_ds)}")

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                               num_workers=args.num_workers, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                             num_workers=args.num_workers)

    full_scan_loader = None
    if args.full_scan_check_scans > 0:
        full_scan_ds = SemanticKITTIDataset(args.data_root, VAL_SEQUENCES, num_points=None, augment=False)
        full_scan_ds.samples = full_scan_ds.samples[: args.full_scan_check_scans]
        full_scan_loader = DataLoader(full_scan_ds, batch_size=1, shuffle=False, num_workers=0)

    print("estimating class weights from a training subsample...")
    class_weights = estimate_class_weights(train_ds, NUM_CLASSES).to(device)
    print("class weights:", class_weights.tolist())

    model = PointNet2Seg(num_classes=NUM_CLASSES).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    crit = nn.CrossEntropyLoss(weight=class_weights, ignore_index=IGNORE)
    scaler = torch.amp.GradScaler("cuda", enabled=(args.amp and device == "cuda"))

    start_epoch = 0
    best_miou = 0.0
    history = []
    last_ckpt_path = os.path.join(CKPT_DIR, "last.pth")
    if args.resume and os.path.exists(last_ckpt_path):
        ckpt = torch.load(last_ckpt_path, map_location=device)
        model.load_state_dict(ckpt["model_state_dict"])
        opt.load_state_dict(ckpt["optimizer_state_dict"])
        start_epoch = ckpt["epoch"] + 1
        best_miou = ckpt.get("best_miou", 0.0)
        history = ckpt.get("history", [])
        print(f"resumed from epoch {start_epoch}, best_miou so far {best_miou:.4f}")

    for epoch in range(start_epoch, args.epochs):
        model.train()
        t0 = time.time()
        running_loss = 0.0
        for step, (points, labels) in enumerate(train_loader):
            points, labels = points.to(device), labels.to(device)
            opt.zero_grad()
            with torch.amp.autocast("cuda", enabled=(args.amp and device == "cuda")):
                logits = model(points)
                loss = crit(logits.reshape(-1, NUM_CLASSES), labels.reshape(-1))
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            running_loss += loss.item()
            if step % 100 == 0:
                print(f"  epoch {epoch} step {step}/{len(train_loader)} loss {loss.item():.4f}")
        sched.step()
        train_loss = running_loss / max(len(train_loader), 1)
        dt = time.time() - t0
        print(f"epoch {epoch} done in {dt:.0f}s, train_loss={train_loss:.4f}")

        entry = {"epoch": epoch, "train_loss": train_loss, "time_s": dt}

        if (epoch + 1) % args.val_every == 0 or epoch == args.epochs - 1:
            val_loss, per_class_iou, miou = validate(model, val_loader, device, NUM_CLASSES)
            print(f"  val_loss={val_loss:.4f} mIoU={miou:.4f} per_class={per_class_iou}")
            entry.update({"val_loss": val_loss, "miou": miou, "per_class_iou": per_class_iou})

            if miou > best_miou:
                best_miou = miou
                torch.save({"model_state_dict": model.state_dict(), "epoch": epoch,
                            "miou": miou, "per_class_iou": per_class_iou}, os.path.join(CKPT_DIR, "best.pth"))
                print(f"  new best mIoU {miou:.4f} -> saved best.pth")

            if full_scan_loader is not None:
                fs_per_class, fs_miou = full_scan_spot_check(model, full_scan_loader, device, NUM_CLASSES)
                print(f"  [full-scan spot check, {len(full_scan_loader)} scans] mIoU={fs_miou:.4f} per_class={fs_per_class}")
                entry.update({"full_scan_miou": fs_miou, "full_scan_per_class_iou": fs_per_class})

        history.append(entry)
        torch.save({"model_state_dict": model.state_dict(), "optimizer_state_dict": opt.state_dict(),
                    "epoch": epoch, "best_miou": best_miou, "history": history}, last_ckpt_path)
        with open(os.path.join(CKPT_DIR, "history.json"), "w") as f:
            json.dump(history, f, indent=2)

    print(f"training complete. best mIoU: {best_miou:.4f}")


if __name__ == "__main__":
    main()
