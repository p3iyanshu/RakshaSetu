"""
SemanticKITTI dataloader. Reads raw .bin/.label files, remaps raw class ids
to RakshaSetu's 4-class scheme via class_mapping.py, and returns fixed-size
point sets ready for the model in models/pointnet2.py.

Split follows the standard SemanticKITTI odometry convention (matches
published benchmark numbers): train on 00-07,09-10, validate on 08.
"""
import os
import sys
import numpy as np
import torch
from torch.utils.data import Dataset

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from class_mapping import SEMANTICKITTI_MAP, SEMANTICKITTI_LABEL_MASK, remap_labels, IGNORE

TRAIN_SEQUENCES = ["00", "01", "02", "03", "04", "05", "06", "07", "09", "10"]
VAL_SEQUENCES = ["08"]


class SemanticKITTIDataset(Dataset):
    """
    root: path to .../semantickitti/dataset  (containing sequences/00, 01, ...)
    num_points: each __getitem__ returns exactly this many points -- randomly
        subsampled (without replacement) if the raw scan has more, and
        subsampled *with* replacement (repeated) if it has fewer, so batches
        can be stacked into a single tensor without ragged-length handling.
    augment: light train-time jitter + random yaw rotation (no-op at eval).
    """

    def __init__(self, root, sequences, num_points=16384, augment=False, mapping=None):
        self.root = root
        self.num_points = num_points
        self.augment = augment
        self.mapping = mapping if mapping is not None else SEMANTICKITTI_MAP

        self.samples = []
        for seq in sequences:
            velo_dir = os.path.join(root, "sequences", seq, "velodyne")
            label_dir = os.path.join(root, "sequences", seq, "labels")
            if not os.path.isdir(velo_dir):
                raise FileNotFoundError(f"missing sequence dir: {velo_dir}")
            for fname in sorted(os.listdir(velo_dir)):
                if not fname.endswith(".bin"):
                    continue
                idx = fname[:-4]
                label_path = os.path.join(label_dir, idx + ".label")
                self.samples.append((os.path.join(velo_dir, fname), label_path))

        if not self.samples:
            raise RuntimeError(f"no samples found under {root} for sequences {sequences}")

    def __len__(self):
        return len(self.samples)

    def _load_raw(self, i):
        velo_path, label_path = self.samples[i]
        points = np.fromfile(velo_path, dtype=np.float32).reshape(-1, 4)  # x,y,z,intensity
        if os.path.exists(label_path):
            raw = np.fromfile(label_path, dtype=np.uint32) & SEMANTICKITTI_LABEL_MASK
            labels = remap_labels(raw, self.mapping)
        else:
            labels = np.full(len(points), IGNORE, dtype=np.uint8)
        return points, labels

    def _fixed_size_sample(self, points, labels, rng):
        n = len(points)
        if n >= self.num_points:
            choice = rng.choice(n, self.num_points, replace=False)
        else:
            choice = rng.choice(n, self.num_points, replace=True)
        return points[choice], labels[choice]

    def _augment(self, points, rng):
        theta = rng.uniform(0, 2 * np.pi)
        c, s = np.cos(theta), np.sin(theta)
        rot = np.array([[c, -s], [s, c]], dtype=np.float32)
        points = points.copy()
        points[:, :2] = points[:, :2] @ rot.T
        points[:, :3] += rng.normal(0.0, 0.02, size=(1, 3)).astype(np.float32)
        return points

    def __getitem__(self, i):
        points, labels = self._load_raw(i)
        rng = np.random.default_rng()
        points, labels = self._fixed_size_sample(points, labels, rng)
        if self.augment:
            points = self._augment(points, rng)
        return torch.from_numpy(points.astype(np.float32)), torch.from_numpy(labels.astype(np.int64))


def make_train_val_datasets(root, num_points=16384):
    train_ds = SemanticKITTIDataset(root, TRAIN_SEQUENCES, num_points=num_points, augment=True)
    val_ds = SemanticKITTIDataset(root, VAL_SEQUENCES, num_points=num_points, augment=False)
    return train_ds, val_ds


if __name__ == "__main__":
    import sys
    root = sys.argv[1] if len(sys.argv) > 1 else "semantickitti/dataset"
    train_ds, val_ds = make_train_val_datasets(root)
    print(f"train: {len(train_ds)} scans, val: {len(val_ds)} scans")
    pts, lbl = train_ds[0]
    print("sample points:", pts.shape, pts.dtype, "labels:", lbl.shape, lbl.dtype)
    uniq, counts = torch.unique(lbl, return_counts=True)
    print("label distribution:", dict(zip(uniq.tolist(), counts.tolist())))
