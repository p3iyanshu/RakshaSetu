"""
Final evaluation: runs a trained checkpoint over the FULL, untruncated
sequence-08 point clouds (not the fixed-size random subsample train.py uses
for fast periodic validation) and reports per-class IoU + mIoU. This is the
number to put in the pitch deck.

    python eval.py --checkpoint checkpoints/best.pth --data-root ../data/semantickitti/dataset
"""
import argparse
import json
import os
import sys
import time

import torch
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from dataset import SemanticKITTIDataset, VAL_SEQUENCES
from pointnet2 import PointNet2Seg
from metrics import IoUMeter
from class_mapping import NUM_CLASSES


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data-root", default=os.path.join("..", "data", "semantickitti", "dataset"))
    p.add_argument("--checkpoint", default=os.path.join("checkpoints", "best.pth"))
    p.add_argument("--sequences", nargs="+", default=VAL_SEQUENCES)
    p.add_argument("--max-scans", type=int, default=None, help="cap number of scans for a quick check")
    p.add_argument("--out", default=os.path.join("checkpoints", "eval_report.json"))
    args = p.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ds = SemanticKITTIDataset(args.data_root, args.sequences, num_points=None, augment=False)
    if args.max_scans:
        ds.samples = ds.samples[: args.max_scans]
    loader = DataLoader(ds, batch_size=1, shuffle=False, num_workers=0)
    print(f"evaluating on {len(ds)} full scans from sequences {args.sequences}")

    model = PointNet2Seg(num_classes=NUM_CLASSES).to(device)
    ckpt = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(ckpt.get("model_state_dict", ckpt))
    model.eval()
    print(f"loaded {args.checkpoint} (trained to epoch {ckpt.get('epoch', '?')}, "
          f"train-time subsampled mIoU {ckpt.get('miou', '?')})")

    meter = IoUMeter(NUM_CLASSES)
    t0 = time.time()
    with torch.no_grad():
        for i, (points, labels) in enumerate(loader):
            points, labels = points.to(device), labels.to(device)
            logits = model(points)
            preds = logits.argmax(dim=-1)
            meter.update(preds, labels)
            if i % 500 == 0:
                print(f"  {i}/{len(ds)} scans ({time.time()-t0:.0f}s elapsed)")

    per_class, miou = meter.compute()
    dt = time.time() - t0
    print(f"\nFull-scan evaluation on {args.sequences} ({len(ds)} scans, {dt:.0f}s):")
    for name, iou in per_class.items():
        print(f"  {name:16s}: {iou:.4f}" if iou is not None else f"  {name:16s}: n/a (no points seen)")
    print(f"  {'mIoU':16s}: {miou:.4f}")

    report = {"sequences": args.sequences, "num_scans": len(ds), "per_class_iou": per_class,
              "miou": miou, "checkpoint": args.checkpoint, "eval_time_s": dt}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"report saved to {args.out}")


if __name__ == "__main__":
    main()
