"""
pc_benchmark_step6.py
RakshaSetu (PS 26053) — Member 1: Step 6 — standalone PC hardware benchmark.

Purpose: measure REAL forward + backward timing and peak process RAM for
the approved Step 5 PointNet2SegMSG model, on YOUR training PC, at three
candidate point counts (N=2048, 4096, 8192), using ONLY real SemanticKITTI
frames already on disk. This does NOT train anything — no optimizer step
is ever created or called. It exists purely to gather real numbers so the
CPU-training practicality decision can be made from evidence, not guesses.

REQUIREMENTS TO RUN THIS ON YOUR PC:
  - Python 3.10+ (3.12 recommended, matches the sandbox this was built in)
  - pip install torch numpy pandas psutil
      (psutil is optional but strongly recommended — without it, only a
       weaker Python-allocation-only memory reading is available)
  - The following UNCHANGED Step 1-5 files must sit in the SAME folder as
    this script (copy them as-is, do not edit them):
        label_remap.py
        cleaning.py
        feature_engineering.py
        dataset.py
        pointnet2_utils.py
        pointnet2_seg.py
  - Real SemanticKITTI .bin/.label frames on disk (see --data-root below
    for the expected layout). NO synthetic/random data is used anywhere
    in this script — if no real frames are found, it reports that and
    exits rather than fabricating input.

USAGE (see the end of this file / the chat message for exact commands):
    python pc_benchmark_step6.py --data-root "C:\\path\\to\\rakshasetu_data"

This script performs NO training: no optimizer is instantiated, no
optimizer.step() is called, and no checkpoint is written. It only runs
forward() and loss.backward() to produce real gradients for timing, then
discards them.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import platform

import torch
from torch.utils.data import DataLoader

# These must be the UNCHANGED Step 1-5 files, placed alongside this script.
from dataset import SemanticKITTIDataset, TRAIN_SEQUENCES, VAL_SEQUENCES, discover_frames
from pointnet2_seg import PointNet2SegMSG, build_loss, NUM_CLASSES

# Official documented SemanticKITTI split size (sequences [0-7,9-10] train,
# 8 val) - an EXTERNAL reference figure, not counted from local files.
# Cited from MMDetection3D's SemanticKITTI dataset docs: "about 19k
# training samples". Used only for the optional epoch-time extrapolation
# printed at the end - always clearly labeled as external, not measured.
OFFICIAL_APPROX_TRAIN_FRAMES = 19000

N_VALUES_TO_BENCHMARK = [2048, 4096, 8192]
WARMUP_ITERATIONS = 1
MEASURED_ITERATIONS = 3
BATCH_SIZE = 1


def get_peak_rss_mb(process) -> float:
    """Peak resident set size in MB, via psutil if available."""
    if process is None:
        return float("nan")
    try:
        # peak_wset (Windows) / rss as fallback (other platforms)
        mem = process.memory_info()
        if hasattr(mem, "peak_wset"):
            return mem.peak_wset / (1024 ** 2)
        return mem.rss / (1024 ** 2)
    except Exception:
        return float("nan")


def benchmark_one_n(data_root: str, n_points: int, process) -> dict:
    """
    Build a fresh Dataset/DataLoader/model at this N, run WARMUP_ITERATIONS
    warm-up iterations (discarded) then MEASURED_ITERATIONS measured
    forward+backward iterations (no optimizer step), and return the raw
    timing/memory numbers. Uses ONLY real frames from data_root.
    """
    print(f"\n{'=' * 78}")
    print(f"Benchmarking N = {n_points}  (batch_size={BATCH_SIZE}, warmup={WARMUP_ITERATIONS}, "
          f"measured_iters={MEASURED_ITERATIONS})")
    print(f"{'=' * 78}")

    ds = SemanticKITTIDataset(data_root, TRAIN_SEQUENCES, num_points_per_sample=n_points, seed=42)
    loader = DataLoader(ds, batch_size=BATCH_SIZE, shuffle=True)

    torch.manual_seed(0)
    model = PointNet2SegMSG(num_classes=NUM_CLASSES, in_channels=7)
    model.train()
    criterion = build_loss(class_weights=None)  # unweighted: this is a TIMING test, not a training run

    data_iter = iter(loader)

    def next_batch():
        nonlocal data_iter
        try:
            return next(data_iter)
        except StopIteration:
            data_iter = iter(loader)
            return next(data_iter)

    # --- Warm-up (discarded; lets any lazy init / first-call overhead happen off the clock) ---
    for w in range(WARMUP_ITERATIONS):
        batch = next_batch()
        model.zero_grad()
        logits = model(batch["xyz"], batch["features"])
        loss = criterion(logits.reshape(-1, NUM_CLASSES), batch["labels"].reshape(-1))
        loss.backward()
        print(f"  [warm-up {w + 1}/{WARMUP_ITERATIONS}] done (not timed)")

    # --- Measured iterations ---
    forward_times, backward_times, total_times = [], [], []
    peak_rss_readings = []

    for i in range(MEASURED_ITERATIONS):
        batch = next_batch()
        model.zero_grad()

        t0 = time.perf_counter()
        logits = model(batch["xyz"], batch["features"])
        t1 = time.perf_counter()

        loss = criterion(logits.reshape(-1, NUM_CLASSES), batch["labels"].reshape(-1))
        loss.backward()
        t2 = time.perf_counter()

        fwd_s, bwd_s, total_s = t1 - t0, t2 - t1, t2 - t0
        forward_times.append(fwd_s)
        backward_times.append(bwd_s)
        total_times.append(total_s)
        peak_rss_readings.append(get_peak_rss_mb(process))

        print(f"  iter {i + 1}/{MEASURED_ITERATIONS}  [{batch['seq'][0]}:{batch['frame_id'][0]}]  "
              f"forward={fwd_s:.3f}s  backward={bwd_s:.3f}s  total={total_s:.3f}s  loss={loss.item():.4f}")

    result = {
        "n_points": n_points,
        "forward_times": forward_times,
        "backward_times": backward_times,
        "total_times": total_times,
        "peak_rss_mb": max(peak_rss_readings) if peak_rss_readings and peak_rss_readings[0] == peak_rss_readings[0] else float("nan"),
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="RakshaSetu Step 6 - real-data-only PC benchmark (no training).")
    parser.add_argument(
        "--data-root", required=True,
        help=(
            "Path to the SemanticKITTI data root. Must contain "
            "<data-root>/sequences/<seq>/velodyne/*.bin and "
            "<data-root>/sequences/<seq>/labels/*.label for at least one "
            "of the TRAIN_SEQUENCES (00-07, 09, 10). Example (Windows): "
            r'C:\Users\you\rakshasetu_data'
        ),
    )
    args = parser.parse_args()
    data_root = args.data_root

    try:
        import psutil
        process = psutil.Process(os.getpid())
        have_psutil = True
    except ImportError:
        process = None
        have_psutil = False

    print(f"Platform: {platform.platform()}")
    print(f"Python: {platform.python_version()}")
    print(f"PyTorch: {torch.__version__}")
    print(f"PyTorch CPU threads available: {torch.get_num_threads()}")
    print(f"CUDA available (should be False on this PC per its spec): {torch.cuda.is_available()}")
    if not have_psutil:
        print("\nWARNING: psutil not installed - peak RAM will be reported as N/A. "
              "Install with: pip install psutil")

    train_entries = discover_frames(data_root, TRAIN_SEQUENCES)
    val_entries = discover_frames(data_root, VAL_SEQUENCES)
    if len(train_entries) == 0:
        print(f"\nNo real training frames found under {data_root}.")
        print("This benchmark requires real SemanticKITTI .bin/.label files at the path above "
              "- it will NOT run against synthetic/random data. Check --data-root and the "
              "expected <data-root>/sequences/<seq>/velodyne|labels/ layout, then re-run.")
        return 1

    print(f"\nReal frames found: {len(train_entries)} train, {len(val_entries)} val, under {data_root}")

    all_results = []
    for n_points in N_VALUES_TO_BENCHMARK:
        result = benchmark_one_n(data_root, n_points, process)
        all_results.append(result)

    # --- Summary table ---
    print(f"\n{'=' * 90}")
    print("SUMMARY - raw measurements per N (batch_size=1, no optimizer step, real data only)")
    print(f"{'=' * 90}")
    header = f"{'N':>6} | {'fwd_mean_s':>10} | {'fwd_min_s':>9} | {'fwd_max_s':>9} | " \
             f"{'bwd_mean_s':>10} | {'total_mean_s':>12} | {'peak_RSS_MB':>11}"
    print(header)
    print("-" * len(header))
    for r in all_results:
        fwd = r["forward_times"]
        bwd = r["backward_times"]
        tot = r["total_times"]
        rss = r["peak_rss_mb"]
        rss_str = f"{rss:.1f}" if rss == rss else "N/A"  # NaN check
        print(f"{r['n_points']:>6} | {sum(fwd)/len(fwd):>10.3f} | {min(fwd):>9.3f} | {max(fwd):>9.3f} | "
              f"{sum(bwd)/len(bwd):>10.3f} | {sum(tot)/len(tot):>12.3f} | {rss_str:>11}")

    # --- Epoch-time extrapolation, per N, clearly labeled as external/arithmetic ---
    print(f"\n{'=' * 90}")
    print("EPOCH-TIME EXTRAPOLATION (arithmetic only - NOT a practicality verdict)")
    print(f"{'=' * 90}")
    print(f"Local real train frames found: {len(train_entries)}")
    print(f"External reference full-split size (NOT locally verified, cited from "
          f"MMDetection3D's SemanticKITTI docs): ~{OFFICIAL_APPROX_TRAIN_FRAMES:,} frames\n")
    for r in all_results:
        mean_total = sum(r["total_times"]) / len(r["total_times"])
        local_epoch_s = mean_total * len(train_entries)
        full_epoch_s = mean_total * OFFICIAL_APPROX_TRAIN_FRAMES
        print(f"  N={r['n_points']:>5}: mean iter = {mean_total:.3f}s  ->  "
              f"local ({len(train_entries)} frames) epoch = {local_epoch_s:.1f}s  |  "
              f"~{OFFICIAL_APPROX_TRAIN_FRAMES:,}-frame epoch = "
              f"{full_epoch_s/60:.1f} min ({full_epoch_s/3600:.2f} hr)")
    print("\nCaveats (stated, not hidden):")
    print("  - Linear scaling assumed; real epoch time also includes DataLoader I/O and the")
    print("    per-frame remap/clean/feature pipeline (dataset.py's real per-item work).")
    print("  - The ~19k figure is an external documented approximation, not a locally verified count.")
    print("  - No optimizer step was run anywhere in this script - these are timing measurements only.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
