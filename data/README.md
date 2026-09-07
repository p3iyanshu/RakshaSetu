# Data Pipeline (Member 1)

Turns raw LiDAR points into the fixed-size, class-remapped tensors the segmentation
model trains on. See `team_tasks/01_data_and_segmentation_model.md` for the full brief
and `shared/schemas.py` for the interface every downstream module reads.

## Files

- `class_mapping.py` -- collapses each source dataset's raw taxonomy down to our
  4-class scheme (`0=drivable, 1=static_obstacle, 2=dynamic_object, 255=ignore`).
  `SEMANTICKITTI_MAP` is complete and used for real training. `CARLA_MAP` is ready
  for when the CARLA `sensor.lidar.ray_cast_semantic` pipeline is set up.
  `NUSCENES_NAME_MAP` + `build_nuscenes_index_map()` are ready for nuScenes-lidarseg,
  but map by category **name** rather than a hardcoded int, since nuScenes assigns
  lidarseg indices per dataset version -- resolve the concrete LUT once you have a
  loaded `NuScenes` object.
- `dataset.py` -- `SemanticKITTIDataset`, a PyTorch `Dataset` over the real,
  extracted SemanticKITTI odometry sequences. Returns a fixed-size point sample
  per scan (`num_points`, default 16384 outside training / 8192 in `train.py`),
  remapped labels, ready to batch. `TRAIN_SEQUENCES` / `VAL_SEQUENCES` follow the
  standard SemanticKITTI convention (train 00-07,09-10; val 08) so mIoU numbers
  are comparable to published results.

## Getting the real data locally

The three official zips (`data_odometry_calib.zip`, `data_odometry_labels.zip`,
`data_odometry_velodyne.zip` from semantic-kitti.org) live at the repo root and are
gitignored -- never commit them. Only sequences **00-10** have ground-truth labels
(11-21 are the unlabeled benchmark test set, not useful for training/validating
locally), so extraction should skip them to save ~20GB and a lot of time. See git
history for the one-off selective-extraction script used to populate
`data/semantickitti/dataset/sequences/00..10/` (also gitignored -- ~44GB on disk).

## nuScenes-mini / CARLA -- not wired up yet

Both need action only a human can take before any code here is useful:
- **nuScenes-mini**: register at nuscenes.org and download the Mini split +
  lidarseg labels.
- **CARLA**: install a pinned release (e.g. 0.9.15) + matching `pip install carla`.

`class_mapping.py`'s maps for both are ready; once the data/devkit exist, add
`NuScenesDataset` / `CARLADataset` classes here mirroring `SemanticKITTIDataset`'s
shape (return `(points[N,4], labels[N])`) so `train.py` needs no changes to
consume them.

## Quick checks

```bash
python dataset.py ../data/semantickitti/dataset   # loads a sample, prints shapes + label distribution
```
