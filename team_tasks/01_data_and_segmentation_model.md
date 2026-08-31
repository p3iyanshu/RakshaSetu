# Member 1 — Data Pipeline & Segmentation Model Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** turns raw LiDAR points into per-point class labels. This is the foundation everyone else's module builds on top of.

---

## Your mission

Build the data pipeline (SemanticKITTI, nuScenes, CARLA) and train the deep learning model that answers, for every single LiDAR point: *is this drivable terrain, a static obstacle, or a dynamic object?*

## Why this matters first

Members 2 and 3 (grid engine, tracking) both consume your output. You are the first link in the chain — so your top priority in week 1 is not the final trained model, it's shipping a **placeholder** fast so nobody downstream is blocked.

---

## Task breakdown

### 1. Get the datasets
- **SemanticKITTI**: register at semantic-kitti.org, download the Velodyne point clouds + label data. Expected structure:
  ```
  semantickitti/dataset/sequences/00/velodyne/*.bin
  semantickitti/dataset/sequences/00/labels/*.label
  ```
- **nuScenes-lidarseg**: register at nuscenes.org, start with the **Mini** split (small, free, has lidarseg labels included) — don't pull the full trainval set unless you need more data later.
- **CARLA**: install a precompiled release (pin one version, e.g. 0.9.15) and `pip install carla==<same version>`. Set up a `sensor.lidar.ray_cast_semantic` blueprint on a vehicle — this gives you `(x, y, z, cos_angle, object_idx, semantic_tag)` per point with zero manual labeling.

### 2. Build the class-remapping layer
All three sources use different raw class taxonomies (19–34 classes). Collapse them all into your 4 target classes: `0 = drivable`, `1 = static_obstacle`, `2 = dynamic_object`, `255 = ignore`.

```python
# class_mapping.py
SEMANTICKITTI_MAP = {
    40: 0, 44: 0, 48: 0,                        # road, parking, sidewalk
    50: 1, 51: 1, 70: 1, 80: 1,                  # building, fence, vegetation, pole
    10: 2, 11: 2, 15: 2, 30: 2, 31: 2, 32: 2,    # car, bicycle, motorcycle, person, bicyclist, motorcyclist
    0: 255, 1: 255,                              # unlabeled, outlier
}

def remap_labels(raw_labels, mapping):
    lut = np.full(max(mapping.keys()) + 1, 255, dtype=np.uint8)
    for k, v in mapping.items():
        lut[k] = v
    return lut[raw_labels]
```
Do the same mapping table for nuScenes' and CARLA's tag sets — same idea, different source IDs.

### 3. Build the dataloader
```python
class SemanticKITTIDataset(Dataset):
    def __init__(self, root, sequences, mapping):
        self.samples = []
        for seq in sequences:
            velo_dir = f"{root}/sequences/{seq:02d}/velodyne"
            label_dir = f"{root}/sequences/{seq:02d}/labels"
            for fname in sorted(os.listdir(velo_dir)):
                idx = fname.split(".")[0]
                self.samples.append((f"{velo_dir}/{idx}.bin", f"{label_dir}/{idx}.label"))
        self.mapping = mapping

    def __getitem__(self, i):
        velo_path, label_path = self.samples[i]
        points = np.fromfile(velo_path, dtype=np.float32).reshape(-1, 4)   # x,y,z,intensity
        raw_labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF     # lower 16 bits
        labels = remap_labels(raw_labels, self.mapping)
        return points, labels

    def __len__(self):
        return len(self.samples)
```

### 4. Train the segmentation model
- Model choice: PointNet++ or a Sparse Convolutional Network (`spconv` / MinkowskiEngine). Start with PointNet++ — simpler to get training end-to-end, swap to SparseConv later if you need more speed/accuracy.
- **Split**: train on sequences 00–07, 09–10; validate on **sequence 08** (the standard SemanticKITTI convention — keeps your numbers comparable to published results).
- Report per-class IoU and overall **mIoU** — this is your headline accuracy number for the pitch.
- Cross-check on nuScenes-mini's val split to show the model generalizes beyond one sensor/geography.

### 5. Ship a Day-1 placeholder
Before the real model is trained, give Members 2 & 3 something to build against immediately:
```python
def placeholder_classify(points):
    z = points[:, 2]
    labels = np.where(z < -1.3, 0, 1)  # crude ground-height threshold
    return labels
```
This unblocks the whole team in week 1 while your real model trains in the background.

---

## Interface contract (what you deliver)

**Function signature:** `classify(points: np.ndarray[N, 4]) -> labels: np.ndarray[N], confidence: np.ndarray[N]`

- Input: raw points `(x, y, z, intensity)`
- Output: per-point class (`0/1/2`) + a confidence score per point (`0.0–1.0`)

Tell Member 4 (Systems Integration) this exact signature in week 1 — they'll wrap it as a ROS 2 node.

## Tools
PyTorch, `spconv` or MinkowskiEngine, Open3D, SemanticKITTI/nuScenes/CARLA, scikit-learn (for metrics).

## Timeline
- **Week 1**: datasets downloaded, placeholder classifier shipped, dataloader working
- **Weeks 2–3**: train the real model, iterate on mIoU
- **End of Week 3**: hand off your trained model's inference function to Member 4 for integration
- **Week 4–5**: help Member 6 with TensorRT/ONNX export of your model

## Deliverables checklist
- [ ] SemanticKITTI + nuScenes-mini + CARLA all set up and readable
- [ ] Class-remapping table for all 3 sources
- [ ] Working dataloader
- [ ] Day-1 placeholder classifier shipped to the team
- [ ] Trained model with reported mIoU (val on seq 08)
- [ ] Exported checkpoint (`.pth` and later `.onnx`)
