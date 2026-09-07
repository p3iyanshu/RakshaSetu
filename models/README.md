# Segmentation Model (Member 1)

Implements the interface contract from `team_tasks/01_data_and_segmentation_model.md`:

```python
classify(points: np.ndarray[N, 4]) -> labels: np.ndarray[N], confidence: np.ndarray[N]
```

`points` is raw `(x, y, z, intensity)`. `labels` are in `{0,1,2}` (drivable /
static_obstacle / dynamic_object -- see `shared/schemas.py`). `confidence` is
`[0.0, 1.0]`. Works on any point count `N`, not just whatever size was used at
training time.

## Two implementations, same signature

- **`placeholder.py`** -- the Day-1 stand-in. A per-scan adaptive ground-height
  threshold (bottom 15th percentile of z, plus a small margin, is "ground").
  Cannot detect dynamic objects at all. Ships with a deliberately low flat
  confidence (0.3) so any consumer doing confidence-based filtering treats it
  as a stand-in. Use this today; swap the import for `pointnet2.classify` once
  a trained checkpoint exists -- nothing else about the call site changes.
- **`pointnet2.py`** -- the real model. See "Architecture" below.

## Architecture

A PointNet++-style encoder-decoder (`PointNet2Seg` in `pointnet2.py`, built from
the layers in `pointnet_utils.py`), implemented in **plain PyTorch with no
compiled CUDA extension**. `spconv`/MinkowskiEngine need a matching nvcc+MSVC
toolchain to build, which is a common source of pain on Windows; this trades a
little raw throughput for "installs anywhere torch+CUDA already works."

- 4 Set Abstraction levels progressively downsample (16384 -> ... -> 32 points)
  and build up features via k-NN grouping + shared MLP + max-pool.
- Downsampling is **random sampling**, not iterative farthest-point sampling.
  FPS is the textbook PointNet++ choice but is O(M·N) per layer; RandLA-Net
  (Hu et al., 2020) showed random sampling gets similar accuracy at O(1) cost,
  which matters more here given the project's whole pitch is compute efficiency.
- 4 Feature Propagation levels upsample back to every input point (inverse-
  distance-weighted interpolation from the 3 nearest sparse points + skip
  connections), ending in a per-point 3-class head.
- ~860K parameters, ~150ms/step at batch size 8 on an 8GB laptop GPU (RTX 4060) --
  small and fast on purpose; a real-time perception stack can't afford a heavy
  segmentation backbone.

## Training

```bash
python train.py --data-root ../data/semantickitti/dataset --epochs 60 --val-every 5 --batch-size 8
```

- Loss: class-weighted cross-entropy (weights are inverse-sqrt-frequency,
  estimated from a training subsample -- SemanticKITTI is heavily road-dominated,
  plain CE would just learn to always predict `drivable`), `ignore_index=255`.
- Mixed precision (`torch.amp`) on by default when CUDA is available.
- `models/checkpoints/` (gitignored) holds `last.pth` (every epoch, for
  `--resume`) and `best.pth` (highest validation mIoU so far -- this is what
  `pointnet2.classify()` loads by default). `history.json` logs per-epoch
  loss/mIoU for a training-curve chart in the pitch deck.
- `--max-train-scans` / `--max-val-scans` cap dataset size for a fast sanity
  run before committing to a multi-hour training run.

## Evaluation

`train.py` reports **per-class IoU + overall mIoU** on sequence 08 every
`--val-every` epochs, using `metrics.py`'s confusion-matrix accumulator (so the
number isn't biased by any single batch's class balance). This is the headline
accuracy number for the pitch.

Note: validation currently scores the same fixed-size random subsample
(`num_points`) each scan uses for training, not the full raw point cloud --
fine for tracking training progress, but for a final reported number consider
adding a whole-cloud (or sliding-window) eval pass before the pitch.

## Next steps (see task brief timeline)

- Cross-check on nuScenes-mini's val split once it's downloaded (`data/README.md`).
- Export `best.pth` to ONNX/TensorRT for Member 6's optimization pass (weeks 4-5).
