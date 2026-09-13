"""
run_cleaning_report.py -- produces the per-sequence cleaning drop-rate
report required by team_tasks/01_data_and_segmentation_model.md step 3.1:
"Run this over the full dataset once, log the drop rate per sequence, and
sanity-check it -- a sequence dropping more than a few percent of its points
is worth a manual look before you trust it."

The handover (HANDOVER_REPORT.md) only ever ran this over a 4-frame
verification subset. This runs remap+clean (feature engineering is skipped
-- irrelevant to this report and far more expensive) over EVERY scan in
both TRAIN_SEQUENCES and VAL_SEQUENCES.
"""
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from label_remap import remap_label_file
from cleaning import clean_point_cloud
from dataset import discover_frames, TRAIN_SEQUENCES, VAL_SEQUENCES

DATA_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "semantickitti", "dataset")


def main():
    all_sequences = TRAIN_SEQUENCES + VAL_SEQUENCES
    entries = discover_frames(DATA_ROOT, all_sequences)
    print(f"scanning {len(entries)} frames across sequences {all_sequences}...")

    rows = []
    t0 = time.time()
    for i, entry in enumerate(entries):
        raw_points = np.fromfile(entry.bin_path, dtype=np.float32).reshape(-1, 4)
        raw_labels_u32 = np.fromfile(entry.label_path, dtype=np.uint32)
        six_class_labels = remap_label_file(raw_labels_u32)
        _, _, report = clean_point_cloud(raw_points, six_class_labels)
        report["seq"] = entry.seq
        report["frame_id"] = entry.frame_id
        rows.append(report)
        if i % 2000 == 0:
            print(f"  {i}/{len(entries)}  ({time.time()-t0:.0f}s elapsed)")

    df = pd.DataFrame(rows)
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cleaning_drop_rate_report.csv")
    df.to_csv(out_path, index=False)
    print(f"\nsaved {len(df)} per-frame rows to {out_path}")

    per_seq = df.groupby("seq").agg(
        n_frames=("frame_id", "count"),
        total_input_points=("input_points", "sum"),
        total_removed=("total_removed", "sum"),
        total_nonfinite=("nonfinite_removed", "sum"),
        total_too_near=("too_near_removed", "sum"),
        total_too_far=("too_far_removed", "sum"),
        max_frame_drop_pct=("drop_rate_pct", "max"),
    )
    per_seq["drop_rate_pct"] = 100.0 * per_seq["total_removed"] / per_seq["total_input_points"]
    per_seq = per_seq[["n_frames", "total_input_points", "total_removed", "drop_rate_pct",
                        "max_frame_drop_pct", "total_nonfinite", "total_too_near", "total_too_far"]]

    per_seq_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cleaning_drop_rate_by_sequence.csv")
    per_seq.to_csv(per_seq_path)
    print(f"saved per-sequence summary to {per_seq_path}\n")
    print(per_seq.to_string())

    overall_drop_pct = 100.0 * df["total_removed"].sum() / df["input_points"].sum()
    print(f"\nOVERALL drop rate across all {len(df)} frames: {overall_drop_pct:.6f}%")
    flagged = per_seq[per_seq["drop_rate_pct"] > 1.0]
    if len(flagged):
        print(f"\nSequences dropping >1% of points (worth a manual look):\n{flagged}")
    else:
        print("No sequence drops more than 1% of its points -- matches the handover's "
              "4-frame finding (this filter essentially never triggers on real KITTI data).")


if __name__ == "__main__":
    main()
