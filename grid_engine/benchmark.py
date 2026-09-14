"""
Benchmark: adaptive vs. uniform grid -- Task 6 of team_tasks/02_adaptive_grid_engine.md.

Produces the headline compute/memory savings number from an actual run
against the shared mock scene, not a back-of-envelope estimate. Run with:

    python grid_engine/benchmark.py
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "shared"))

from grid_builder import build_adaptive_grid, build_uniform_grid, fit_ground_plane  # noqa: E402
from mock_data import generate_sequence  # noqa: E402


def run(n_frames=20, seed=0):
    frames = generate_sequence(n_frames=n_frames, seed=seed)

    total_points = 0
    adaptive_cells = 0
    uniform_cells = 0
    adaptive_time = 0.0
    uniform_time = 0.0

    for points, labels, confidence in frames:
        total_points += points.shape[0]
        ground_plane = fit_ground_plane(points[:, :3])

        t0 = time.perf_counter()
        adaptive_grid = build_adaptive_grid(points, labels, confidence, ground_plane=ground_plane)
        adaptive_time += time.perf_counter() - t0

        t0 = time.perf_counter()
        uniform_grid = build_uniform_grid(points, labels, confidence, ground_plane=ground_plane)
        uniform_time += time.perf_counter() - t0

        adaptive_cells += len(adaptive_grid)
        uniform_cells += len(uniform_grid)

    savings_pct = 100.0 * (1.0 - adaptive_cells / uniform_cells) if uniform_cells else 0.0

    print(f"Frames:                 {n_frames}")
    print(f"Total points processed: {total_points}")
    print(f"Occupied cells (uniform, fixed 5cm to 100m): {uniform_cells}")
    print(f"Occupied cells (adaptive, {8}-band):          {adaptive_cells}")
    print(f"Cell-count reduction:   {savings_pct:.1f}%")
    print(f"Adaptive build time:    {adaptive_time * 1000:.2f} ms total ({adaptive_time / n_frames * 1000:.2f} ms/frame)")
    print(f"Uniform build time:     {uniform_time * 1000:.2f} ms total ({uniform_time / n_frames * 1000:.2f} ms/frame)")

    return {
        "n_frames": n_frames,
        "total_points": total_points,
        "uniform_cells": uniform_cells,
        "adaptive_cells": adaptive_cells,
        "savings_pct": savings_pct,
        "adaptive_time_s": adaptive_time,
        "uniform_time_s": uniform_time,
    }


if __name__ == "__main__":
    run()
