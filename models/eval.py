"""
Final evaluation: runs the exact `classify()` inference path (see
pointnet2.py -- downsample to training density, predict, propagate back to
every original point) over the FULL, untruncated sequence-08 point clouds and
reports per-class IoU + mIoU. This is the number to put in the pitch deck,
since it measures the same code path a real deployment calls, not a
synthetic direct-forward-pass shortcut.

    python eval.py --checkpoint checkpoints/best.pth --data-root ../data/semantickitti/dataset
"""
import argparse
import json
import os
import sys
import time

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from dataset import SemanticKITTIDataset, VAL_SEQUENCES
from pointnet2 import classify
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

    ds = SemanticKITTIDataset(args.data_root, args.sequences, num_points=None, augment=False)
    if args.max_scans:
        ds.samples = ds.samples[: args.max_scans]
    print(f"evaluating on {len(ds)} full scans from sequences {args.sequences}")
    print(f"checkpoint: {args.checkpoint}")

    meter = IoUMeter(NUM_CLASSES)
    t0 = time.time()
    for i in range(len(ds)):
        points, labels = ds[i]
        pred_labels, _ = classify(points.numpy(), checkpoint_path=args.checkpoint)
        meter.update(torch.from_numpy(pred_labels.astype("int64")), labels)
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
