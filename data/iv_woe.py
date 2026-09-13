"""
iv_woe.py
RakshaSetu (PS 26053) — Member 1: Data Pipeline & Segmentation Model
Step 3b: Information Value / Weight of Evidence feature selection.

METHODOLOGY (explicit, per the requirement not to silently assume a
multiclass approach):

This is a 6-class problem, and IV/WoE is inherently a binary-target
technique. The approach used here is ONE-VS-REST (OvR): for each of the
6 RakshaSetu classes c, define a binary "event" indicator
    y_c = 1  if the point's true class == c
    y_c = 0  otherwise (any of the other 5 classes)
and compute a separate IV value for every (feature, class) pair. This
gives 6 IV values per feature, not one — deliberately, because a single
averaged IV would hide whether a feature is powerful for a specific
(possibly rare-but-important) class.

Points with the IGNORE_LABEL (excluded raw classes: unlabeled/outlier)
are dropped before this analysis — they are not part of the 6-class
problem at all, so they'd be undefined "events" under every one-vs-rest
split.

BINNING: continuous features are binned into up to N_BINS quantile
(equal-frequency) bins via pandas.qcut. Equal-frequency binning is used
specifically because it guarantees every bin has comparable POPULATION
support even when the feature distribution is skewed (true for range,
density, etc.) — the alternative (equal-width bins) can produce
near-empty bins in the tails of a skewed distribution. When a feature
has fewer than N_BINS distinct values in a region (causing duplicate bin
edges), qcut's duplicates='drop' merges those bins — the ACTUAL number
of bins used is reported per feature, not assumed to always be N_BINS.

MINIMUM-SUPPORT / ZERO-CELL HANDLING: with a class as rare as
dynamic_pedestrian (a few hundred points out of ~500k in this sample),
many bins will have ZERO points of that class. A raw WoE for such a bin
is ln(0) = -inf, which is meaningless. The standard remedy (used here) is
a continuity correction: add a small constant (SMOOTHING = 0.5, following
the conventional "add-half" correction) to every event/non-event count
before computing proportions. This makes WoE well-defined everywhere,
at the cost of slightly damping IV for extremely sparse classes — an
honest trade-off, not a way to manufacture significance.

IV INTERPRETATION SCALE (standard convention, not invented for this
project — from the widely used credit-scoring rule of thumb,
Siddiqi 2006 "Credit Risk Scorecards"):
    IV < 0.02            : not useful for prediction
    0.02 <= IV < 0.1      : weak predictive power
    0.1  <= IV < 0.3      : medium predictive power
    0.3  <= IV < 0.5      : strong predictive power
    IV >= 0.5             : suspiciously high — check for leakage/overfit
"""

from __future__ import annotations

import numpy as np
import pandas as pd

N_BINS: int = 10
SMOOTHING: float = 0.5  # "add-half" continuity correction


def iv_interpretation(iv: float) -> str:
    if iv < 0.02:
        return "not useful"
    if iv < 0.1:
        return "weak"
    if iv < 0.3:
        return "medium"
    if iv < 0.5:
        return "strong"
    return "SUSPICIOUSLY HIGH (check leakage)"


def compute_woe_iv_binary(
    feature_values: np.ndarray,
    binary_target: np.ndarray,
    n_bins: int = N_BINS,
    smoothing: float = SMOOTHING,
) -> tuple[float, pd.DataFrame, int]:
    """
    Compute IV and the per-bin WoE table for one feature against one
    binary (one-vs-rest) target.

    Returns:
        iv: float, total Information Value.
        bin_table: DataFrame with columns
            [bin, n_total, n_event, n_nonevent, dist_event, dist_nonevent, woe]
        n_bins_used: actual number of bins after duplicate-edge merging
                     (<= n_bins, per pandas.qcut's duplicates='drop').
    """
    s = pd.Series(feature_values)
    try:
        bins = pd.qcut(s, q=n_bins, duplicates="drop")
    except ValueError:
        # Fewer distinct values than would support even 2 bins.
        bins = pd.Series(["single_bin"] * len(s))

    df = pd.DataFrame({"bin": bins, "event": binary_target.astype(int)})
    total_event = df["event"].sum()
    total_nonevent = len(df) - total_event

    grouped = df.groupby("bin", observed=True)["event"].agg(n_total="count", n_event="sum")
    grouped["n_nonevent"] = grouped["n_total"] - grouped["n_event"]

    n_bins_used = len(grouped)

    grouped["dist_event"] = (grouped["n_event"] + smoothing) / (total_event + n_bins_used * smoothing)
    grouped["dist_nonevent"] = (grouped["n_nonevent"] + smoothing) / (total_nonevent + n_bins_used * smoothing)
    grouped["woe"] = np.log(grouped["dist_event"] / grouped["dist_nonevent"])
    grouped["iv_contribution"] = (grouped["dist_event"] - grouped["dist_nonevent"]) * grouped["woe"]

    iv = float(grouped["iv_contribution"].sum())
    bin_table = grouped.reset_index()
    return iv, bin_table, n_bins_used


def one_vs_rest_iv_table(
    features: dict[str, np.ndarray],
    labels: np.ndarray,
    class_names: dict[int, str],
) -> pd.DataFrame:
    """
    Compute the full (feature x class) one-vs-rest IV matrix.

    Args:
        features: dict of feature_name -> (N,) array (valid points only —
                  caller must have already excluded IGNORE_LABEL points).
        labels: (N,) int array of true class ids (0-5 only, no -1).
        class_names: {0: 'drivable_terrain', ...} for readable output.

    Returns:
        DataFrame with one row per (feature, class), columns:
        [feature, class_id, class_name, class_support, iv, n_bins_used, interpretation]
    """
    rows = []
    class_ids = sorted(class_names.keys())
    for feature_name, values in features.items():
        for class_id in class_ids:
            binary_target = (labels == class_id).astype(int)
            support = int(binary_target.sum())
            iv, _bin_table, n_bins_used = compute_woe_iv_binary(values, binary_target)
            rows.append({
                "feature": feature_name,
                "class_id": class_id,
                "class_name": class_names[class_id],
                "class_support": support,
                "iv": iv,
                "n_bins_used": n_bins_used,
                "interpretation": iv_interpretation(iv),
            })
    return pd.DataFrame(rows)
