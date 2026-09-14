# RakshaSetu

**SIH 2026 — Problem Statement 26053**: Adaptive Variable-Resolution 2.5D LiDAR Mapping for Dynamic Environment Perception

Team: JanSetu | Theme: Transportation & Logistics | Category: Software

## Start here

New to this repo? Read in this order:

1. [`PROJECT_EXECUTION_PLAN.md`](PROJECT_EXECUTION_PLAN.md) — **binding execution plan**: detailed problem breakdown, solution differentiation, team roles, DevOps/git standards, and the timeline to the internal hackathon. Follow this; changes to scope/roles/deadlines go through it (see its Governance section).
2. [`SIH2026_PS26053_Roadmap.md`](SIH2026_PS26053_Roadmap.md) — original problem research and extended architecture notes
3. [`team_tasks/00_interfaces_and_handoff.md`](team_tasks/00_interfaces_and_handoff.md) — the shared data contract every module builds against, and how to hand off finished work
4. Your own numbered file in [`team_tasks/`](team_tasks/) — your individual task brief

## Repo layout

```
shared/          interface contract (schemas.py) + mock LiDAR data generator + sample data
                 -- start here for a working dataset, no need to wait on real data
data/            Member 1: dataset pipeline (label remapping, cleaning, feature engineering)
models/          Member 1: PointNet++ segmentation model, training, trained checkpoint
grid_engine/     Member 2: adaptive variable-resolution 2.5D grid engine
tracking/        Member 3: clustering + Kalman/SORT tracking, ego-motion compensation
ros2_ws/         Member 4: ROS 2 pipeline contract (interfaces.md) + integration workspace
dashboard/       Member 5: FastAPI backend + React/Tailwind live visualization frontend
team_tasks/      individual task briefs (and post-review corrections) for all 6 members
```

`security/` (Member 6: security/optimization/testing) hasn't started yet — added once that work begins, per `team_tasks/00_interfaces_and_handoff.md`'s intended structure.

## Getting a working dataset immediately

Don't wait on a real trained model or real LiDAR hardware. Use the shared mock data:

```python
import numpy as np
data = np.load("shared/sample_data/npz_frames/frame_0000.npz")
points, labels, confidence = data["points"], data["labels"], data["confidence"]
```

See [`shared/README.md`](shared/README.md) for full usage, including the SemanticKITTI-format version and how to regenerate/extend it.

## Branching

Work on your own `feature/<your-module>` branch, not directly on `main`. See `team_tasks/00_interfaces_and_handoff.md` for the full PR/handoff process.
