"""Confusion-matrix-based per-class IoU + mIoU, accumulated across batches/scans
so validation isn't biased by per-batch class imbalance."""
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from class_mapping import CLASS_NAMES, NUM_CLASSES, IGNORE


class IoUMeter:
    def __init__(self, num_classes=NUM_CLASSES):
        self.num_classes = num_classes
        self.confusion = torch.zeros(num_classes, num_classes, dtype=torch.int64)

    def update(self, pred: torch.Tensor, target: torch.Tensor):
        """pred, target: any shape, int labels. IGNORE (255) entries in target are dropped."""
        pred = pred.reshape(-1).cpu()
        target = target.reshape(-1).cpu()
        valid = target != IGNORE
        pred, target = pred[valid], target[valid]
        idx = target * self.num_classes + pred
        binc = torch.bincount(idx, minlength=self.num_classes ** 2)
        self.confusion += binc.reshape(self.num_classes, self.num_classes)

    def compute(self):
        """Returns (per_class_iou: dict[name->float], miou: float)."""
        cm = self.confusion.float()
        tp = cm.diag()
        fp = cm.sum(dim=0) - tp
        fn = cm.sum(dim=1) - tp
        denom = tp + fp + fn
        iou = torch.where(denom > 0, tp / denom, torch.full_like(denom, float("nan")))
        per_class = {CLASS_NAMES[c]: (float(iou[c]) if not torch.isnan(iou[c]) else None) for c in range(self.num_classes)}
        valid_iou = iou[~torch.isnan(iou)]
        miou = float(valid_iou.mean()) if len(valid_iou) > 0 else 0.0
        return per_class, miou

    def reset(self):
        self.confusion.zero_()
