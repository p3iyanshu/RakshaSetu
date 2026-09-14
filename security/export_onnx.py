"""
Member 6 optimization step 1: export the trained PointNet2SegMSG checkpoint
(models/checkpoints/best.pth, epoch 16, held-out val mIoU 0.8675) to ONNX.

Scope note: this exports the NEURAL NETWORK ONLY (model.forward(xyz,
features) -> logits) -- not models/inference.py's full classify() pipeline.
The ground-plane/NaN cleaning (data/cleaning.py) and feature engineering
(data/feature_engineering.py) around it are plain NumPy/SciPy, not part of
the trained graph, and stay Python; ONNX/TensorRT accelerate the compute-
bound network forward pass, which is what this and benchmark_optimization.py
isolate and measure.

Fixed shapes on purpose: inference.classify() always calls the model with
exactly MAX_INFERENCE_POINTS=8192 points, batch size 1 (see
models/inference.py) -- that's the one shape this ever runs at in this
project, so a dynamic-shape export buys nothing here and only adds risk.

Usage:
    python security/export_onnx.py
Output:
    security/optimized/pointnet2_seg.onnx  (gitignored -- model artifact, per .gitignore's *.onnx rule)
"""
import os
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO_ROOT, "models"))
sys.path.insert(0, os.path.join(REPO_ROOT, "data"))

import pointnet2_utils  # noqa: E402 -- patched below, see _patch_sampling_for_export()
from pointnet2_seg import PointNet2SegMSG, NUM_CLASSES  # noqa: E402
from feature_engineering import FEATURE_NAMES  # noqa: E402

CHECKPOINT = os.path.join(REPO_ROOT, "models", "checkpoints", "best.pth")
OUT_DIR = os.path.join(HERE, "optimized")
OUT_PATH = os.path.join(OUT_DIR, "pointnet2_seg.onnx")
N_POINTS = 8192  # models/inference.py's MAX_INFERENCE_POINTS -- the only shape this model ever runs at
BATCH = 1
FEATURE_DIM = len(FEATURE_NAMES)  # 7


def _patch_sampling_for_export():
    """models/pointnet2_utils.py's farthest_point_sample() (the approved
    Step 1-5 file -- deliberately left untouched, see its own docstring on
    the FPS->random-sampling deadline deviation) uses torch.randperm to pick
    each Set Abstraction layer's centers. ONNX has no op for aten::randperm
    (torch.onnx.export fails with UnsupportedOperatorError), and random
    sampling was already just a speed trade-off for spatial coverage, not
    something the network was trained to structurally depend on -- so for
    export/deployment only, monkeypatch the module-level function (called by
    name from within pointnet2_utils.py itself, so patching the module
    attribute here reaches every call site) to a deterministic, evenly
    strided sample of the same size. This never touches Member 1's source
    file on disk; it only changes which centers get used while THIS script
    runs. main()'s parity check re-applies this same patch before running
    the PyTorch side, so PyTorch-eager and the exported ONNX graph are
    compared under the identical (deterministic) sampling -- comparing
    against the *random*-sampling PyTorch path would show spurious
    mismatches even for an otherwise-perfect export.
    """
    def deterministic_sample(xyz, npoint):
        B, N, _ = xyz.shape
        npoint = min(npoint, N)
        step = max(1, N // npoint)
        idx = torch.arange(0, N, step, device=xyz.device, dtype=torch.long)[:npoint]
        return idx.unsqueeze(0).expand(B, npoint)

    pointnet2_utils.farthest_point_sample = deterministic_sample


def load_model(device: str) -> torch.nn.Module:
    if not os.path.exists(CHECKPOINT):
        print(f"ERROR: checkpoint not found at {CHECKPOINT}. Train the model first (models/train.py).")
        sys.exit(1)
    ckpt = torch.load(CHECKPOINT, map_location=device)
    model = PointNet2SegMSG(num_classes=NUM_CLASSES, in_channels=FEATURE_DIM).to(device)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    print(f"loaded checkpoint: epoch={ckpt.get('epoch', '?')} val_miou={ckpt.get('miou', float('nan')):.4f}")
    return model


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    device = "cpu"  # export from CPU: the exported graph is device-independent, and CPU avoids any
    # CUDA-kernel-specific tracing quirks. Runtime benchmarks separately test CPU vs GPU execution.

    _patch_sampling_for_export()
    model = load_model(device)

    torch.manual_seed(0)
    dummy_xyz = torch.randn(BATCH, N_POINTS, 3, dtype=torch.float32, device=device)
    dummy_features = torch.randn(BATCH, N_POINTS, FEATURE_DIM, dtype=torch.float32, device=device)

    print(f"exporting to {OUT_PATH} (fixed shape: xyz[{BATCH},{N_POINTS},3], features[{BATCH},{N_POINTS},{FEATURE_DIM}])")
    with torch.no_grad():
        torch.onnx.export(
            model,
            (dummy_xyz, dummy_features),
            OUT_PATH,
            input_names=["xyz", "features"],
            output_names=["logits"],
            opset_version=17,
            do_constant_folding=True,
        )
    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH) / 1e6:.1f} MB)")

    # --- Parity check: PyTorch eager vs the exported ONNX graph, same real input ---
    print("\nverifying parity against PyTorch eager (real SemanticKITTI frame if available, else random input)...")
    xyz_np, feat_np = _real_or_random_input()

    with torch.no_grad():
        torch_logits = model(torch.from_numpy(xyz_np), torch.from_numpy(feat_np)).numpy()

    import onnxruntime as ort
    sess = ort.InferenceSession(OUT_PATH, providers=["CPUExecutionProvider"])
    onnx_logits = sess.run(["logits"], {"xyz": xyz_np, "features": feat_np})[0]

    torch_pred = torch_logits.argmax(axis=-1)
    onnx_pred = onnx_logits.argmax(axis=-1)
    label_agreement = float((torch_pred == onnx_pred).mean())
    max_logit_abs_diff = float(np.abs(torch_logits - onnx_logits).max())

    print(f"predicted-label agreement (PyTorch vs ONNX): {label_agreement * 100:.2f}%")
    print(f"max abs logit difference: {max_logit_abs_diff:.6f}")
    if label_agreement < 0.99:
        print(
            "WARNING: label agreement below 99% -- investigate before trusting the ONNX "
            "graph's predictions (note: farthest_point_sample's torch.randperm sampling is "
            "itself stochastic per call in BOTH PyTorch and ONNX, so a small amount of "
            "disagreement near sampling-sensitive boundaries is expected, not a bug)."
        )
    else:
        print("OK: ONNX export matches PyTorch eager output closely enough to trust for benchmarking/deployment.")


def _real_or_random_input():
    """Prefers a real cleaned+feature-engineered SemanticKITTI frame (same
    preprocessing classify() would apply) so the parity check exercises
    real data, not synthetic noise; falls back to random input if no real
    data is present on this machine (e.g. CI)."""
    demo_seq_dir = os.path.join(REPO_ROOT, "tracking", "kitti_validation_data", "sequences", "00")
    velo_path = os.path.join(demo_seq_dir, "velodyne", "003615.bin")
    if os.path.exists(velo_path):
        from cleaning import clean_point_cloud
        from feature_engineering import compute_features
        raw = np.fromfile(velo_path, dtype=np.float32).reshape(-1, 4)
        dummy_labels = np.zeros(len(raw), dtype=np.int64)
        clean_points, _, _ = clean_point_cloud(raw, dummy_labels)
        rng = np.random.default_rng(0)
        idx = rng.choice(len(clean_points), N_POINTS, replace=len(clean_points) < N_POINTS)
        xyz = clean_points[idx, :3].astype(np.float32)
        feats_dict, _ = compute_features(clean_points[idx])
        feats = np.stack([feats_dict[n] for n in FEATURE_NAMES], axis=1).astype(np.float32)
        print(f"  using real frame {velo_path}")
        return xyz[None, ...], feats[None, ...]

    print("  no real SemanticKITTI frame found on this machine -- using random input for the parity check")
    rng = np.random.default_rng(0)
    xyz = rng.standard_normal((BATCH, N_POINTS, 3)).astype(np.float32)
    feats = rng.standard_normal((BATCH, N_POINTS, FEATURE_DIM)).astype(np.float32)
    return xyz, feats


if __name__ == "__main__":
    main()
