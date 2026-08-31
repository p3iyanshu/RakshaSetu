# Shared Mock LiDAR Data

Fake data matching exactly what Member 1's real segmentation model will eventually output (see `schemas.py`). Use this now — don't wait for the real model or real dataset. When the real thing is ready later, only the data *source* changes; your code doesn't, as long as you built against this shape.

## What's here

- `schemas.py` — the interface contract (data shapes every module reads/writes)
- `mock_data.py` — the generator (ground plane + walls + poles + pedestrians + a vehicle, realistic distance-based point density, 2 dynamic objects that actually move across frames)
- `sample_data/npz_frames/` — 20 pre-generated frames, easiest way to load
- `sample_data/kitti_format/sequences/00/` — the same 20 frames saved in the actual SemanticKITTI `.bin`/`.label` file layout

## Quick start — load a frame

**Easiest (npz):**
```python
import numpy as np
data = np.load("sample_data/npz_frames/frame_0000.npz")
points, labels, confidence = data["points"], data["labels"], data["confidence"]
# points: (N,4) x,y,z,intensity | labels: (N,) 0=drivable 1=static_obstacle 2=dynamic_object
```

**Or via the loader helpers:**
```python
from mock_data import load_npz, load_kitti_format

points, labels, confidence = load_npz("sample_data/npz_frames/frame_0005.npz")

# same data, real-dataset file format -- useful for testing a SemanticKITTI-style dataloader
points, labels = load_kitti_format("sample_data/kitti_format/sequences/00", frame_id=5)
```

## Regenerate or make more frames
```bash
python mock_data.py                       # regenerates the 20-frame sample_data/ folder
```
```python
from mock_data import generate_sequence
frames = generate_sequence(n_frames=50, seed=1)   # more frames, different seed
```

## Important notes

- **Labels are already remapped** to our 4-class scheme (0/1/2/255), not raw SemanticKITTI class IDs. Member 1's real `class_mapping.py` is what performs that remapping on the real dataset — this mock skips that step by generating pre-remapped labels directly, since everyone downstream of segmentation only ever needs the simplified scheme.
- **Point density falls off with distance** (denser near the vehicle, sparser far away), matching real LiDAR — useful for testing the adaptive-resolution grid engine and distance-scaled clustering `eps` realistically, not against uniform toy density.
- **Two dynamic objects move** across the 20-frame sequence (2 pedestrians + 1 vehicle, each with its own velocity) — enough motion to build and test the Kalman filter / tracking logic against.
- **Class distribution is realistic**: ~99% drivable, ~1% obstacles — matches what a real scan looks like (mostly ground), so don't be surprised your obstacle-only pipeline stages see far fewer points than the raw frame total.

## When the real dataset/model is ready
Swap the data source only:
```python
# before:
points, labels, confidence = load_npz("sample_data/npz_frames/frame_0000.npz")
# after:
points = read_real_lidar_frame(...)
labels, confidence = trained_model.classify(points)
```
Everything downstream (grid engine, clustering, tracking, dashboard) shouldn't need to change, because it was built against `schemas.py`'s shapes, not against this mock's specific implementation.
