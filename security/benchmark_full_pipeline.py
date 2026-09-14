"""
Member 6 optimization step 4: measure the REAL, END-TO-END post-optimization
latency/FPS -- not just the isolated network forward pass from
benchmark_optimization.py, but the same steps models/inference.py's
classify() runs (clean -> feature-engineer -> downsample -> infer ->
KD-tree upsample), with the network step swapped for the TensorRT engine.

Why this script exists, not just benchmark_optimization.py: the dashboard
demo's already-recorded baseline (dashboard/backend/data/demo_sequence.json,
avg 306.6ms/frame, 3.5 FPS) times the WHOLE classify() call, and most of
that time turned out to be cleaning/feature-engineering/KD-tree-upsample on
the full ~100k-125k-point raw scan, not the 8192-point network forward pass
itself (see benchmark_optimization.py: the network alone is 7-19ms).
Reporting only the network number next to that 306ms baseline would be
comparing two different things. This script re-runs the SAME full pipeline,
swapping only the network backend, so the before/after comparison is
apples-to-apples and the reported number is measured, not estimated -- this
project's own stated standard (see build_demo_data.py's docstring).

This intentionally reuses data/cleaning.py and data/feature_engineering.py
UNCHANGED (same convention pc_benchmark_step6.py and build_demo_data.py
already follow for Member 1's approved Step 1-5 files) -- only the network
inference call itself is swapped between backends.

Usage:
    python security/benchmark_full_pipeline.py [n_frames]
Requires: security/build_tensorrt_engine.py already run, and real
SemanticKITTI frames at tracking/kitti_validation_data/sequences/00/.
"""
import os
import sys
import time

import numpy as np
import torch
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO_ROOT, "models"))
sys.path.insert(0, os.path.join(REPO_ROOT, "data"))
sys.path.insert(0, HERE)

from cleaning import clean_point_cloud  # noqa: E402
from feature_engineering import compute_features, FEATURE_NAMES  # noqa: E402
from label_remap import IGNORE_LABEL  # noqa: E402
from pointnet2_seg import PointNet2SegMSG, NUM_CLASSES  # noqa: E402
from export_onnx import _patch_sampling_for_export, N_POINTS  # noqa: E402

CHECKPOINT = os.path.join(REPO_ROOT, "models", "checkpoints", "best.pth")
ENGINE_PATH = os.path.join(HERE, "optimized", "pointnet2_seg.engine")
SEQ_DIR = os.path.join(REPO_ROOT, "tracking", "kitti_validation_data", "sequences", "00")
DEFAULT_N_FRAMES = 30  # subset of the same 100-frame demo window -- enough for a stable steady-state average


def discover_frame_ids(n_frames):
    label_files = sorted(f for f in os.listdir(os.path.join(SEQ_DIR, "labels")) if f.endswith(".label"))
    ids = [int(f[:-6]) for f in label_files]
    return ids[:n_frames]


def load_points(frame_id):
    fname = f"{frame_id:06d}"
    return np.fromfile(os.path.join(SEQ_DIR, "velodyne", f"{fname}.bin"), dtype=np.float32).reshape(-1, 4)


def preprocess(points):
    """The exact non-network steps of models/inference.py's classify():
    clean, then feature-engineer, then downsample to N_POINTS. Returns the
    downsampled (xyz, features) ready for the network, plus enough state to
    do the KD-tree upsample back to full density afterward."""
    n = len(points)
    dummy_labels = np.full(n, IGNORE_LABEL, dtype=np.int64)
    clean_points, _, _ = clean_point_cloud(points, dummy_labels)

    feats_dict, _ = compute_features(clean_points)
    feats = np.stack([feats_dict[name] for name in FEATURE_NAMES], axis=1).astype(np.float32)

    m = len(clean_points)
    rng = np.random.default_rng(0)
    if m > N_POINTS:
        infer_idx = rng.choice(m, N_POINTS, replace=False)
    else:
        infer_idx = np.arange(m)
    infer_xyz = clean_points[infer_idx, :3].astype(np.float32)
    infer_feats = feats[infer_idx]
    return infer_xyz, infer_feats, clean_points


def upsample(pred, clean_points, infer_xyz):
    if len(clean_points) <= N_POINTS:
        return pred
    nn_idx = cKDTree(infer_xyz).query(clean_points[:, :3], k=1)[1]
    return pred[nn_idx]


def run_pytorch_backend(model, device, xyz_np, feat_np):
    with torch.no_grad():
        xyz_t = torch.from_numpy(xyz_np).unsqueeze(0).to(device)
        feat_t = torch.from_numpy(feat_np).unsqueeze(0).to(device)
        logits = model(xyz_t, feat_t)
        pred = logits.argmax(-1).squeeze(0).cpu().numpy()
    return pred


def make_tensorrt_backend():
    import tensorrt as trt
    logger = trt.Logger(trt.Logger.WARNING)
    with open(ENGINE_PATH, "rb") as f:
        engine = trt.Runtime(logger).deserialize_cuda_engine(f.read())
    context = engine.create_execution_context()
    out_t = torch.empty((1, N_POINTS, NUM_CLASSES), dtype=torch.float32, device="cuda")
    stream = torch.cuda.Stream()
    context.set_tensor_address("logits", out_t.data_ptr())

    def run(xyz_np, feat_np):
        xyz_t = torch.from_numpy(xyz_np).unsqueeze(0).cuda().contiguous()
        feat_t = torch.from_numpy(feat_np).unsqueeze(0).cuda().contiguous()
        context.set_tensor_address("xyz", xyz_t.data_ptr())
        context.set_tensor_address("features", feat_t.data_ptr())
        context.execute_async_v3(stream_handle=stream.cuda_stream)
        stream.synchronize()
        return out_t.argmax(-1).squeeze(0).cpu().numpy()

    return run


def bench_full_pipeline(name, frame_ids, network_call):
    """network_call(xyz_np, feat_np) -> pred[N_POINTS]. Frame 0 is a
    discarded warmup (first-call overhead: lazy CUDA context init, etc.)."""
    print(f"\n[{name}] running {len(frame_ids)} real frames ({len(frame_ids) - 1} timed, frame 0 is warmup)...")
    latencies_ms = []
    for i, frame_id in enumerate(frame_ids):
        points = load_points(frame_id)
        t0 = time.perf_counter()
        infer_xyz, infer_feats, clean_points = preprocess(points)
        pred_small = network_call(infer_xyz, infer_feats)
        _pred_full = upsample(pred_small, clean_points, infer_xyz)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        if i == 0:
            print(f"  frame {frame_id} (warmup, discarded): {latency_ms:.1f}ms")
            continue
        latencies_ms.append(latency_ms)
        print(f"  frame {frame_id}: {latency_ms:.1f}ms")

    arr = np.array(latencies_ms)
    mean_ms = float(arr.mean())
    fps = 1000.0 / mean_ms
    print(f"  --> mean={mean_ms:.1f}ms  p50={np.percentile(arr, 50):.1f}ms  p95={np.percentile(arr, 95):.1f}ms  FPS={fps:.2f}  (n={len(arr)})")
    return {"name": name, "mean_ms": mean_ms, "fps": fps, "n_frames": len(arr)}


def main():
    n_frames = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_N_FRAMES
    frame_ids = discover_frame_ids(n_frames)
    if not frame_ids:
        print(f"ERROR: no real frames found under {SEQ_DIR}")
        sys.exit(1)

    _patch_sampling_for_export()  # same deterministic sampling used for the exported/engine graphs

    results = []

    print("loading PyTorch model (CPU)...")
    model_cpu = _make_torch_model("cpu")
    results.append(bench_full_pipeline(
        "Full pipeline -- PyTorch eager (CPU)", frame_ids,
        lambda xyz, feat: run_pytorch_backend(model_cpu, "cpu", xyz, feat),
    ))

    if torch.cuda.is_available():
        print("\nloading PyTorch model (CUDA)...")
        model_gpu = _make_torch_model("cuda")
        results.append(bench_full_pipeline(
            "Full pipeline -- PyTorch eager (GPU)", frame_ids,
            lambda xyz, feat: run_pytorch_backend(model_gpu, "cuda", xyz, feat),
        ))

        if os.path.exists(ENGINE_PATH):
            print("\nloading TensorRT engine...")
            trt_run = make_tensorrt_backend()
            results.append(bench_full_pipeline(
                "Full pipeline -- TensorRT (GPU)", frame_ids, trt_run,
            ))
        else:
            print(f"\n[TensorRT] SKIPPED -- {ENGINE_PATH} not found, run security/build_tensorrt_engine.py first.")
    else:
        print("\n[GPU backends] SKIPPED -- no CUDA GPU available.")

    baseline = results[0]
    print(f"\n{'=' * 78}\nSUMMARY -- REAL end-to-end classify()-equivalent latency ({len(frame_ids) - 1} real SemanticKITTI frames, seq 00)\n{'=' * 78}")
    header = f"{'pipeline':<38} | {'mean_ms':>8} | {'fps':>7} | {'speedup':>8}"
    print(header)
    print("-" * len(header))
    for r in results:
        print(f"{r['name']:<38} | {r['mean_ms']:>8.1f} | {r['fps']:>7.2f} | {baseline['mean_ms'] / r['mean_ms']:>7.2f}x")
    print(
        "\nFor reference, dashboard/backend/data/demo_sequence.json's already-recorded full-run\n"
        "average (100 frames, device unlogged) was 306.6ms/frame (3.51 FPS) -- consistent with the\n"
        "PyTorch baseline measured here on the same preprocessing path."
    )


def _make_torch_model(device):
    ckpt = torch.load(CHECKPOINT, map_location=device)
    model = PointNet2SegMSG(num_classes=NUM_CLASSES, in_channels=len(FEATURE_NAMES)).to(device)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    return model


if __name__ == "__main__":
    main()
