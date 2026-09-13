"""
run_iv_analysis.py -- produces the feature_iv_report.csv deliverable from
team_tasks/01_data_and_segmentation_model.md step 3.3.

The handover's IV/WoE run (iv_woe.py) was only ever exercised on the 4-frame
verification subset ("results are exploratory/provisional, not used to drop
any feature" -- HANDOVER_REPORT.md section 2, Step 3). This script runs the
same, unchanged one_vs_rest_iv_table() against a real sample pooled across
multiple train sequences, per the brief's "5,000-10,000 points drawn across
multiple sequences" guidance -- an exploratory, one-time analysis, not a
per-batch operation.

Note: pointnet2_seg.PointNet2SegMSG (the approved Step 5 model) hardcodes
feature_dim=7 and raises if given anything else, so this report is
informational -- it documents which features carry real signal, but doesn't
by itself change the model's input channels. Dropping a feature would be an
input-shape change requiring the same team sign-off as any other contract
change (see 01_data_and_segmentation_model.md step 3.3's last paragraph).
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from label_remap import remap_label_file, IGNORE_LABEL, RAKSHASETU_CLASS_NAMES
from cleaning import clean_point_cloud
from feature_engineering import compute_features, FEATURE_NAMES
from iv_woe import one_vs_rest_iv_table

DATA_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "semantickitti", "dataset")
# Spread across sequences with different characteristics (urban/residential/highway-ish)
# rather than clustering all sample frames in one sequence.
SAMPLE_FRAMES = [
    ("00", ["000000", "002000", "004000"]),
    ("02", ["000000", "002000", "004000"]),
    ("05", ["000000", "001500"]),
    ("07", ["000000", "000800"]),
    ("09", ["000000", "001000"]),
]
TARGET_POOL_SIZE = 10000
SEED = 0


def load_frame_features_and_labels(seq, frame_id):
    velo_path = os.path.join(DATA_ROOT, "sequences", seq, "velodyne", f"{frame_id}.bin")
    label_path = os.path.join(DATA_ROOT, "sequences", seq, "labels", f"{frame_id}.label")
    points = np.fromfile(velo_path, dtype=np.float32).reshape(-1, 4)
    raw_labels = np.fromfile(label_path, dtype=np.uint32)

    six_class_labels = remap_label_file(raw_labels)
    clean_points, clean_labels, _ = clean_point_cloud(points, six_class_labels)
    feats_dict, _ = compute_features(clean_points)
    feats = np.stack([feats_dict[name] for name in FEATURE_NAMES], axis=1)
    return feats, clean_labels


def main():
    rng = np.random.default_rng(SEED)
    all_feats, all_labels = [], []
    frames_used = []

    for seq, frame_ids in SAMPLE_FRAMES:
        for frame_id in frame_ids:
            velo_path = os.path.join(DATA_ROOT, "sequences", seq, "velodyne", f"{frame_id}.bin")
            if not os.path.exists(velo_path):
                print(f"  skipping {seq}:{frame_id} (not found)")
                continue
            feats, labels = load_frame_features_and_labels(seq, frame_id)
            all_feats.append(feats)
            all_labels.append(labels)
            frames_used.append(f"{seq}:{frame_id}")
            print(f"  loaded {seq}:{frame_id} -> {len(labels)} cleaned points")

    feats = np.concatenate(all_feats, axis=0)
    labels = np.concatenate(all_labels, axis=0)

    # Drop IGNORE_LABEL points -- not part of the 6-class problem (iv_woe.py's own precondition)
    valid = labels != IGNORE_LABEL
    feats, labels = feats[valid], labels[valid]
    print(f"\npooled {len(labels)} valid (non-ignore) points from {len(frames_used)} frames: {frames_used}")

    # Subsample down to the target pool size for the exploratory analysis
    if len(labels) > TARGET_POOL_SIZE:
        idx = rng.choice(len(labels), size=TARGET_POOL_SIZE, replace=False)
        feats, labels = feats[idx], labels[idx]
    print(f"analyzing {len(labels)} sampled points")

    class_dist = {RAKSHASETU_CLASS_NAMES[c]: int((labels == c).sum()) for c in sorted(RAKSHASETU_CLASS_NAMES)}
    print("class distribution in sample:", class_dist)

    features_dict = {name: feats[:, i] for i, name in enumerate(FEATURE_NAMES)}
    iv_table = one_vs_rest_iv_table(features_dict, labels, RAKSHASETU_CLASS_NAMES)

    # Per-feature decision: KEEP if it clears the >=0.02 "not useful" threshold
    # for AT LEAST one class split (a feature only needs to matter for one
    # class to be worth keeping -- brief step 3.3, point 2).
    best_per_feature = iv_table.groupby("feature")["iv"].max()
    decision = {f: ("KEEP" if best_per_feature[f] >= 0.02 else "DROP") for f in FEATURE_NAMES}
    iv_table["feature_decision"] = iv_table["feature"].map(decision)

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feature_iv_report.csv")
    iv_table.to_csv(out_path, index=False)
    print(f"\nsaved {len(iv_table)} rows to {out_path}")

    print("\nBest (max-over-class) IV per feature, and decision:")
    for f in FEATURE_NAMES:
        print(f"  {f:22s} max_iv={best_per_feature[f]:.4f}  -> {decision[f]}")

    suspicious = iv_table[iv_table["iv"] >= 0.5]
    if len(suspicious):
        print("\nSUSPICIOUSLY HIGH IV (>=0.5) -- check for leakage before trusting:")
        print(suspicious[["feature", "class_name", "iv"]].to_string(index=False))


if __name__ == "__main__":
    main()
