# Member 3 — Corrections Needed Before Final Submission

**Read alongside [`03_clustering_and_tracking.md`](03_clustering_and_tracking.md) — that's your original brief; this is a punch list found by actually merging your latest `tracking/` work against Member 2's now-finalized grid resolution bands and re-running the test suite, not by re-describing anything you already know.**

Good news first: the class-mapping fix (`ca61a74`) and the wall/pole `is_dynamic` fix (`48fc12f`) are both real, verified improvements — the wall/pole fix alone took real validation accuracy from 0.361 to 0.819 on sequence 00. Nothing below undoes that. This is one new structural gap plus one still-open number worth tracking.

---

## 1. [HIGH] Per-ring clustering silently splits objects that straddle a ring boundary — exposed by Member 2's finalized bands, but the bug is older than that

`tracking/clustering.py::cluster_obstacles()` runs DBSCAN **independently per radial ring** (`for lo, hi, cell_size in RING_BOUNDARIES: ring_mask = ...; db = DBSCAN(eps=..., ...).fit(ring_points)`), with **no step that reconciles clusters across adjacent rings**. Two points from the same physical object that land on opposite sides of a ring boundary can never be assigned the same cluster ID — not because they're far apart, but because they're never even considered in the same DBSCAN call.

This has always been possible, but Member 2's grid engine (`grid_engine/grid_builder.py`) finalized `RING_BOUNDARIES` at 8 bands (`0, 2, 5, 10, 20, 35, 55, 80, 100`m) instead of the old 4 (`0, 10, 30, 60, 100`m) — 5 near-field boundaries instead of 1. More boundaries in the 0–20m range means any real near-field object of nontrivial size has a meaningfully higher chance of straddling one. Concretely:

```
tracking/tests/test_clustering.py::test_cluster_obstacles_separates_distinct_objects
  -- PASSES against the old 4-band RING_BOUNDARIES
  -- FAILS against the new 8-band RING_BOUNDARIES
```
The test's `blob_a` fixture sits at `(5.0, 0.0, 1.0)` with std 0.05 — its 30 points' radii range 4.88–5.09m, split almost evenly (15/15) across the new boundary at exactly r=5.0m. Under the old scheme this blob sat safely inside a single [0,10) ring; under the new scheme it's split into two independent DBSCAN runs and comes back as 2 cluster IDs instead of 1.

**This is not a call to revert Member 2's bands** — reproduce it yourself and you'll see the near-field eps values (0.05m cell → eps 0.3m) are actually unchanged for r<10m in the new scheme; the failure is purely from the extra boundaries, not different eps values. The real fix is making ring-based clustering boundary-safe, since finer adaptive bands are the whole point of this project and more of them may show up later.

**Suggested fixes (pick one):**
- **Stitching pass (recommended):** after per-ring DBSCAN, for every pair of clusters in adjacent rings, check if their nearest points are within `min(eps_ring_a, eps_ring_b)` (or an agreed merge threshold) — if so, union their IDs. A small, bounded post-process, keeps the range-adaptive eps benefit.
- **Overlap buffer:** include points within one `eps` beyond each ring's boundary when clustering that ring, then merge any cluster IDs that end up sharing points in the overlap zone.
- **Not recommended:** a single global eps across all ranges — this reintroduces the exact pitfall your own brief already warns about ("a fixed eps across all ranges... will over-cluster... or under-cluster depending on which range it was tuned on").

## 2. [MEDIUM, partially fixed, still open] Dynamic-decision precision is still low

Real validation against `tracking/kitti_validation_data/sequences/00` (20 frames), current state:
```
tp=14  fp=205  tn=934  fn=5
precision (dynamic): 0.064
recall (dynamic):    0.737
accuracy:            0.819
```
The wall/pole fix (`48fc12f`) already fixed the dominant source of false positives — accuracy went from 0.361→0.819 and `tn` from 233→934 in the same commit's own re-validation. But precision is still only ~0.06–0.11 depending on frame range, meaning the large majority of remaining "dynamic" calls are still false positives — now presumably concentrated in `dynamic_vehicle`/`dynamic_pedestrian` (the classes that genuinely can be either), not `wall`/`pole` anymore.

**Worth investigating, not necessarily fixing blind:**
- Is `velocity_threshold=0.3` (m/s) too low relative to real residual noise in the ego-motion-compensated velocity estimate?
- Is DBSCAN cluster-boundary instability on vehicle/pedestrian objects (occlusion, partial visibility from frame to frame) injecting centroid jitter that reads as apparent motion?
- Does this improve at all once item #1's boundary-splitting is fixed — a track whose detections keep getting reassigned a new cluster ID at a ring boundary would look like noisy/discontinuous motion to the Kalman filter.

Not blocking in the way #1 is, but worth a real look before claiming this number in the pitch.

---

## How to confirm you're done

1. Get `feature/grid-engine`'s `shared/schemas.py` (or just its `RING_BOUNDARIES` value) merged/rebased into your branch, then re-run `pytest tracking/tests/test_clustering.py -v` — `test_cluster_obstacles_separates_distinct_objects` must pass against the **new** 8-band `RING_BOUNDARIES`, not just the old one.
2. Re-run `python validate_semantic_kitti.py kitti_validation_data/sequences/00` and report the new precision/recall/accuracy — see if #1's fix moves precision at all.
3. Re-run `pytest tests/test_contracts.py tracking/tests/ -v` in full — should stay green.
