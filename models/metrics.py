"""Confusion-matrix-based per-class IoU/recall + mIoU + overall accuracy,
accumulated across batches/scans so validation isn't biased by any single
batch's class distribution. Uses label_remap.py's approved 6-class scheme
and IGNORE_LABEL (-1) convention -- see Member1_HANDOVER_REPORT.md step 5's
metrics requirement (per-class IoU, mIoU, overall accuracy, per-class
recall; IGNORE excluded from all of them)."""
import os
import sys

import torch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
from label_remap import RAKSHASETU_CLASS_NAMES, IGNORE_LABEL

NUM_CLASSES = len(RAKSHASETU_CLASS_NAMES)


class IoUMeter:
    def __init__(self, num_classes=NUM_CLASSES, ignore_index=IGNORE_LABEL):
        self.num_classes = num_classes
        self.ignore_index = ignore_index
        self.confusion = torch.zeros(num_classes, num_classes, dtype=torch.int64)

    def update(self, pred: torch.Tensor, target: torch.Tensor):
        """pred, target: any shape, int labels. ignore_index entries in target are dropped."""
        pred = pred.reshape(-1).cpu()
        target = target.reshape(-1).cpu()
        valid = target != self.ignore_index
        pred, target = pred[valid], target[valid]
        idx = target * self.num_classes + pred
        binc = torch.bincount(idx, minlength=self.num_classes ** 2)
        self.confusion += binc.reshape(self.num_classes, self.num_classes)

    def compute(self):
        """Returns a dict: per_class_iou, per_class_recall (both name->float or
        None if the class had zero support), miou, overall_accuracy."""
        cm = self.confusion.float()
        tp = cm.diag()
        fp = cm.sum(dim=0) - tp
        fn = cm.sum(dim=1) - tp
        support = cm.sum(dim=1)  # true count per class

        iou = torch.where((tp + fp + fn) > 0, tp / (tp + fp + fn), torch.full_like(tp, float("nan")))
        recall = torch.where(support > 0, tp / support, torch.full_like(tp, float("nan")))

        def _named(vec):
            return {RAKSHASETU_CLASS_NAMES[c]: (float(vec[c]) if not torch.isnan(vec[c]) else None)
                    for c in range(self.num_classes)}

        valid_iou = iou[~torch.isnan(iou)]
        miou = float(valid_iou.mean()) if len(valid_iou) > 0 else 0.0
        overall_accuracy = float(tp.sum() / cm.sum()) if cm.sum() > 0 else 0.0

        return {
            "per_class_iou": _named(iou),
            "per_class_recall": _named(recall),
            "miou": miou,
            "overall_accuracy": overall_accuracy,
        }

    def reset(self):
        self.confusion.zero_()
