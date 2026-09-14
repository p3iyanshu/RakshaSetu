"""
Loader/validator for the real demo sequence a teammate produces by running
the trained segmentation model + tracker on real SemanticKITTI frames.

Expected file: dashboard/backend/data/demo_sequence.json, shape:
{
  "meta": {"source": str, "checkpoint": str, "num_frames": int, "generated_at": str},
  "frames": [ {"timestamp": float, "grid": [...], "objects": [...], "metrics": {...}}, ... ]
}

If the file is missing, unreadable, or doesn't match this shape, callers
should fall back to the mock generator -- see main.py.
"""
import json
import os

REQUIRED_FRAME_KEYS = ("timestamp", "grid", "objects", "metrics")
REQUIRED_METRIC_KEYS = ("fps", "latency_ms", "miou", "compute_savings_pct")


def try_load_real_sequence(path):
    """Returns {"meta": dict, "frames": list} if `path` holds a valid
    sequence, else None. Never raises."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(data, dict):
        return None
    frames = data.get("frames")
    if not isinstance(frames, list) or len(frames) == 0:
        return None

    f0 = frames[0]
    if not isinstance(f0, dict) or not all(k in f0 for k in REQUIRED_FRAME_KEYS):
        return None
    if not isinstance(f0.get("grid"), list) or not isinstance(f0.get("objects"), list):
        return None
    metrics = f0.get("metrics")
    if not isinstance(metrics, dict) or not all(k in metrics for k in REQUIRED_METRIC_KEYS):
        return None

    meta = data.get("meta")
    if not isinstance(meta, dict):
        meta = {}

    return {"meta": meta, "frames": frames}
