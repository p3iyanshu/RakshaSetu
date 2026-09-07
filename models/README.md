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

- 4 Set Abstraction levels progressively downsample (8192 -> 2048 -> 512 -> 128
  -> 32 points) and build up features via **ball query** (fixed physical
  radius per level: 0.5/1.0/2.0/4.0m, capped at k neighbors, padded by
  repeating the nearest point when a ball has fewer) + shared MLP + max-pool.
  Deliberately *not* plain k-nearest-neighbors: kNN's neighborhood size
  shrinks as point density rises, so a kNN-grouped model trained on a fixed
  point count sees a completely different receptive field on a real full
  scan than it did during training (measured here: 0.91 mIoU at training
  density vs 0.50 mIoU direct on full scans, same weights, before this fix).
- Downsampling itself is **random sampling**, not iterative farthest-point
  sampling. FPS is the textbook PointNet++ choice but is O(M·N) per layer;
  RandLA-Net (Hu et al., 2020) showed random sampling gets similar accuracy
  at O(1) cost, which matters more here given the project's whole pitch is
  compute efficiency.
- 4 Feature Propagation levels upsample back to every input point (inverse-
  distance-weighted interpolation from the 3 nearest sparse points + skip
  connections), ending in a per-point 3-class head.
- ~860K parameters, small and fast on purpose; a real-time perception stack
  can't afford a heavy segmentation backbone.

### Inference: downsample, predict, propagate

Even with ball query fixing the receptive field, feeding a raw ~120k-point
scan straight through a network trained on 8192-point subsamples still loses
accuracy (0.83 vs 0.57 mIoU on an early checkpoint) -- each of the fixed 2048
first-layer centers then covers a much smaller share of the scene than it did
at training density. `classify()` (`pointnet2.py`) handles this by
downsampling to `MAX_INFERENCE_POINTS` (8192) before the forward pass, then
giving every original point its nearest downsampled point's prediction via a
`scipy.spatial.cKDTree` query -- recovers most of that gap (0.75 in the same
test), and is also just the right design for a real-time system: don't run
the heavy network at full raw resolution when the scene doesn't need it
everywhere. The shared logic lives in `predict_with_propagation()` so
`train.py`'s periodic full-scan spot check and `eval.py`'s final report
exercise the exact same path `classify()` does.

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

`train.py` reports **per-class IoU + overall mIoU** on the same fixed-size
subsample used for training, every `--val-every` epochs (fast, good for
tracking training progress) -- plus, every validation round, a slower
**full-scan spot check** (`--full-scan-check-scans`, default 150) that runs
the real `predict_with_propagation()` inference path on complete, untruncated
scans. Watch for these two numbers diverging a lot; that's the density-
sensitivity failure mode described above resurfacing.

For the final headline number, run `eval.py` -- it calls `classify()` itself
over every scan in the val sequence, so it measures exactly what a real
deployment would see:

```bash
python eval.py --checkpoint checkpoints/best.pth --data-root ../data/semantickitti/dataset
```

## Next steps (see task brief timeline)

- Cross-check on nuScenes-mini's val split once it's downloaded (`data/README.md`).
- Export `best.pth` to ONNX/TensorRT for Member 6's optimization pass (weeks 4-5).
