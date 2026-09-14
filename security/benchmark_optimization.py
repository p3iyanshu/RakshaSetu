"""
Member 6 optimization step 3: re-benchmark inference latency/FPS after
ONNX/TensorRT optimization, against the same PyTorch-eager baseline, on the
same real SemanticKITTI input, at the same fixed shape (N=8192, batch=1)
the model always runs at (models/inference.py's MAX_INFERENCE_POINTS).

Scope: this benchmarks the NEURAL NETWORK FORWARD PASS ONLY (model(xyz,
features) -> logits) across four backends -- PyTorch eager (CPU and GPU),
ONNX Runtime (CPU), and TensorRT (GPU) -- since that is the compute-bound
part ONNX/TensorRT actually accelerate; the surrounding cleaning/feature-
engineering/KD-tree-upsample steps in classify() are plain NumPy/SciPy and
identical regardless of which backend runs the network. See this script's
printed summary for how that maps onto a full classify()-call latency.

Per Member 6's brief, explicitly avoiding the two stated pitfalls:
  - one-time model/engine LOAD is measured and reported SEPARATELY from
    steady-state per-frame latency, never folded into it;
  - every backend is benchmarked on the SAME real input, WARMUP_ITERS
    discarded before MEASURED_ITERS are timed, so first-call/JIT/kernel-
    autotune overhead never leaks into the reported number.

Usage:
    python security/benchmark_optimization.py
Requires: security/export_onnx.py and security/build_tensorrt_engine.py
already run (their outputs are read from security/optimized/).
"""
import json
import os
import sys
import time

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO_ROOT, "models"))
sys.path.insert(0, os.path.join(REPO_ROOT, "data"))
sys.path.insert(0, HERE)

from pointnet2_seg import PointNet2SegMSG, NUM_CLASSES  # noqa: E402
from feature_engineering import FEATURE_NAMES  # noqa: E402
from export_onnx import _patch_sampling_for_export, _real_or_random_input, N_POINTS, FEATURE_DIM  # noqa: E402

CHECKPOINT = os.path.join(REPO_ROOT, "models", "checkpoints", "best.pth")
ONNX_PATH = os.path.join(HERE, "optimized", "pointnet2_seg.onnx")
ENGINE_PATH = os.path.join(HERE, "optimized", "pointnet2_seg.engine")
RESULTS_PATH = os.path.join(HERE, "optimized", "benchmark_results.json")

WARMUP_ITERS = 5
MEASURED_ITERS = 30


def _load_torch_model(device):
    ckpt = torch.load(CHECKPOINT, map_location=device)
    model = PointNet2SegMSG(num_classes=NUM_CLASSES, in_channels=FEATURE_DIM).to(device)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    return model


def _time_calls(fn, warmup=WARMUP_ITERS, measured=MEASURED_ITERS, sync_fn=None):
    """Runs fn() warmup times (discarded), then measured times, timing each
    call individually. sync_fn (e.g. torch.cuda.synchronize) is called
    before each timer stop, since GPU kernel launches are async and an
    un-synchronized timer would under-report GPU latency."""
    for _ in range(warmup):
        fn()
    if sync_fn:
        sync_fn()

    times_ms = []
    for _ in range(measured):
        t0 = time.perf_counter()
        fn()
        if sync_fn:
            sync_fn()
        times_ms.append((time.perf_counter() - t0) * 1000.0)
    return times_ms


def _summarize(name, load_s, times_ms):
    arr = np.array(times_ms)
    mean_ms = float(arr.mean())
    p50 = float(np.percentile(arr, 50))
    p95 = float(np.percentile(arr, 95))
    fps = 1000.0 / mean_ms
    print(f"\n[{name}]")
    print(f"  one-time load/init: {load_s * 1000:.1f} ms  (NOT included in per-frame latency below)")
    print(f"  steady-state latency: mean={mean_ms:.2f}ms  p50={p50:.2f}ms  p95={p95:.2f}ms  (n={len(arr)}, after {WARMUP_ITERS} discarded warmup calls)")
    print(f"  steady-state FPS (1000/mean_latency_ms): {fps:.2f}")
    return {"name": name, "load_s": load_s, "mean_ms": mean_ms, "p50_ms": p50, "p95_ms": p95, "fps": fps}


def bench_pytorch(device, xyz_np, feat_np):
    t0 = time.perf_counter()
    _patch_sampling_for_export()  # same deterministic sampling as the ONNX/TensorRT graphs, for a fair comparison
    model = _load_torch_model(device)
    xyz = torch.from_numpy(xyz_np).to(device)
    feat = torch.from_numpy(feat_np).to(device)
    load_s = time.perf_counter() - t0

    sync_fn = torch.cuda.synchronize if device == "cuda" else None

    def call():
        with torch.no_grad():
            model(xyz, feat)

    times_ms = _time_calls(call, sync_fn=sync_fn)
    return _summarize(f"PyTorch eager ({device})", load_s, times_ms)


def bench_onnxruntime(xyz_np, feat_np):
    import onnxruntime as ort
    t0 = time.perf_counter()
    sess = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])
    load_s = time.perf_counter() - t0

    def call():
        sess.run(["logits"], {"xyz": xyz_np, "features": feat_np})

    times_ms = _time_calls(call)
    return _summarize("ONNX Runtime (CPU)", load_s, times_ms)


def bench_tensorrt(xyz_np, feat_np):
    import tensorrt as trt

    logger = trt.Logger(trt.Logger.WARNING)
    t0 = time.perf_counter()
    with open(ENGINE_PATH, "rb") as f:
        engine = trt.Runtime(logger).deserialize_cuda_engine(f.read())
    context = engine.create_execution_context()
    load_s = time.perf_counter() - t0

    xyz_t = torch.from_numpy(xyz_np).cuda().contiguous()
    feat_t = torch.from_numpy(feat_np).cuda().contiguous()
    out_shape = (1, N_POINTS, NUM_CLASSES)
    out_t = torch.empty(out_shape, dtype=torch.float32, device="cuda").contiguous()

    context.set_tensor_address("xyz", xyz_t.data_ptr())
    context.set_tensor_address("features", feat_t.data_ptr())
    context.set_tensor_address("logits", out_t.data_ptr())
    stream = torch.cuda.Stream()

    def call():
        context.execute_async_v3(stream_handle=stream.cuda_stream)

    def sync():
        stream.synchronize()

    times_ms = _time_calls(call, sync_fn=sync)

    # parity spot-check against PyTorch (same deterministic-sampling model), while we're here
    _patch_sampling_for_export()
    torch_model = _load_torch_model("cuda")
    with torch.no_grad():
        torch_logits = torch_model(xyz_t, feat_t).cpu().numpy()
    agreement = float((torch_logits.argmax(-1) == out_t.cpu().numpy().argmax(-1)).mean())
    print(f"  (parity spot-check: TensorRT vs PyTorch-GPU label agreement = {agreement * 100:.2f}%)")

    return _summarize("TensorRT (GPU, FP32 engine)", load_s, times_ms)


def main():
    if not os.path.exists(ONNX_PATH):
        print(f"ERROR: {ONNX_PATH} missing -- run `python security/export_onnx.py` first.")
        sys.exit(1)

    print("loading benchmark input (real SemanticKITTI frame if available)...")
    xyz_np, feat_np = _real_or_random_input()

    results = []
    results.append(bench_pytorch("cpu", xyz_np, feat_np))

    if torch.cuda.is_available():
        results.append(bench_pytorch("cuda", xyz_np, feat_np))
    else:
        print("\n[PyTorch eager (cuda)] SKIPPED -- no CUDA GPU available on this machine.")

    results.append(bench_onnxruntime(xyz_np, feat_np))

    if os.path.exists(ENGINE_PATH):
        if torch.cuda.is_available():
            results.append(bench_tensorrt(xyz_np, feat_np))
        else:
            print("\n[TensorRT] SKIPPED -- engine present but no CUDA GPU available on this machine.")
    else:
        print(f"\n[TensorRT] SKIPPED -- {ENGINE_PATH} not found. Run `python security/build_tensorrt_engine.py` first.")

    baseline = next(r for r in results if r["name"].startswith("PyTorch eager"))
    print(f"\n{'=' * 78}\nSUMMARY (network forward pass only, N={N_POINTS} points, batch=1, steady-state)\n{'=' * 78}")
    header = f"{'backend':<32} | {'mean_ms':>8} | {'fps':>7} | {'speedup_vs_pytorch_cpu':>22}"
    print(header)
    print("-" * len(header))
    cpu_baseline_ms = next(r["mean_ms"] for r in results if r["name"] == "PyTorch eager (cpu)")
    for r in results:
        speedup = cpu_baseline_ms / r["mean_ms"]
        print(f"{r['name']:<32} | {r['mean_ms']:>8.2f} | {r['fps']:>7.2f} | {speedup:>21.2f}x")

    os.makedirs(os.path.dirname(RESULTS_PATH), exist_ok=True)
    with open(RESULTS_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "n_points": N_POINTS, "batch": 1,
            "warmup_iters": WARMUP_ITERS, "measured_iters": MEASURED_ITERS,
            "scope": "network forward pass only (model(xyz, features) -> logits); "
                     "excludes cleaning/feature-engineering/KD-tree-upsample, which are "
                     "identical NumPy/SciPy work regardless of backend",
            "results": results,
        }, f, indent=2)
    print(f"\nwrote {RESULTS_PATH}")


if __name__ == "__main__":
    main()
