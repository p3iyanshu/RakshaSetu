# RakshaSetu Security Module (Member 6)

Shared auth/RBAC used by the dashboard backend, and TLS material for
running it over `wss://`. Framed honestly per the team's own brief:
**security-by-design for a hackathon prototype**, not a DRDO-certified
auth system.

## What's here

- `auth.py` -- JWT creation/verification (`python-jose`), password hashing
  (`bcrypt` directly -- passlib's bcrypt backend detection is broken on
  bcrypt>=4.1, a known upstream incompatibility), and the two fixed roles: `viewer` (watch only) and
  `admin` (can also force the feed source and reset the mock generator).
  Imported directly by `dashboard/backend/main.py` -- this module owns the
  logic, the dashboard just calls into it, same "wrap, don't reimplement"
  rule the rest of the team follows for cross-module code.
- `generate_certs.sh` -- generates a self-signed dev TLS cert into
  `certs/` (gitignored). Re-run any time to rotate it.
- `.env` -- created automatically on first run if `RAKSHASETU_JWT_SECRET`
  isn't set in the environment, so the secret survives `uvicorn --reload`
  restarts without ever being committed. **Gitignored.**
- `audit.py` -- structured JSON-Lines audit trail (`audit.log`, gitignored
  -- it's runtime data, not source). One line per event: timestamp,
  action, username, role, outcome (`success`/`denied`/`failure`), and a
  free-form `detail` dict. Wired into `dashboard/backend/main.py` at every
  login attempt, every admin action (`feed-mode`, `reset-mock`), and every
  WebSocket connect/reject. Readable by an admin at
  `GET /api/admin/audit-log`, or directly via `tail -f security/audit.log`
  during a demo.

## Demo credentials

| Username | Default password | Role |
|---|---|---|
| `admin` | `admin123` | admin |
| `viewer` | `viewer123` | viewer |

Override before showing this to anyone outside the team:

```bash
export RAKSHASETU_ADMIN_PASSWORD="something-else"
export RAKSHASETU_VIEWER_PASSWORD="something-else"
```

The backend prints a warning on startup for every credential still on its
default value.

## Running the dashboard backend over TLS (wss://)

```bash
bash security/generate_certs.sh   # once, or to rotate the cert
```

Then start uvicorn with the cert (see `dashboard/backend/README.md` for
the full command, or the `rakshasetu-dashboard-backend-secure` launch
config). The frontend's `VITE_WS_URL`/`VITE_API_URL` need to point at
`wss://`/`https://` to match.

**First-connection gotcha:** the cert is self-signed, so the browser will
refuse the WebSocket silently unless it's already told to trust that
host:port. Before connecting the dashboard, open
`https://localhost:8000/api/health` directly in the same browser once and
click through the "not private" warning -- that adds a one-time exception
for this host:port, after which `wss://localhost:8000/...` connects
normally. This is a real gotcha with self-signed dev certs in general, not
something specific to this project.

## Testing

```bash
pytest security/tests/ -v                       # auth.py + audit.py unit tests (20 cases)
pytest dashboard/backend/tests/ -v               # auth/RBAC/input-validation integration tests
                                                  # against the real FastAPI app (28 cases, incl.
                                                  # confirming the real pipeline's precomputed
                                                  # output actually reaches the dashboard -- see
                                                  # the "end-to-end" tests in that file)
```
Both suites run in CI on every push/PR (`.github/workflows/contract-tests.yml`). Every test
uses an isolated JWT secret/credentials/audit-log path (via `monkeypatch` +
module reload) -- none of them touch the real dev `security/.env` or
`security/audit.log`.

## Optimization: ONNX export + TensorRT

Re-benchmarks Member 1's trained segmentation model (`models/checkpoints/best.pth`,
epoch 16, held-out val mIoU 0.8675) after exporting it to ONNX and TensorRT, per
Member 6's brief item 2 ("make the real-time claim actually true").

```bash
python security/export_onnx.py            # models/ -> security/optimized/pointnet2_seg.onnx
python security/build_tensorrt_engine.py   # .onnx -> security/optimized/pointnet2_seg.engine (GPU-specific, not portable)
python security/benchmark_optimization.py  # network forward pass only, 4 backends
python security/benchmark_full_pipeline.py # REAL end-to-end classify()-equivalent latency, 3 backends
```
`security/optimized/` is gitignored (`*.onnx` already was; the `.engine` and
`benchmark_results.json` follow the same "built artifact, not source" rule) --
re-run the scripts above to regenerate it.

**Why two benchmark scripts:** `benchmark_optimization.py` isolates just the
network forward pass (what ONNX/TensorRT actually accelerate).
`benchmark_full_pipeline.py` re-runs the *entire* `classify()`-equivalent
pipeline (clean -> feature-engineer -> downsample -> infer -> KD-tree
upsample) on real SemanticKITTI frames, swapping only the network backend --
this is the number that's actually comparable to the dashboard demo's
already-recorded 306.6ms/frame (3.51 FPS) baseline, and it's a real
measured run, not an estimate (this project's own standard, see
`dashboard/backend/build_demo_data.py`'s docstring).

**Results** (RTX 4060 Laptop GPU, driver 581.86, TensorRT 11.3, N=8192 points,
batch=1, steady-state after warmup -- see each script's own output for
full mean/p50/p95):

| Scope | Backend | Latency | FPS | Speedup |
|---|---|---|---|---|
| Network forward pass only | PyTorch eager (CPU) | 227.1 ms | 4.4 | 1.0x |
| Network forward pass only | PyTorch eager (GPU) | 19.0 ms | 52.6 | 12.0x |
| Network forward pass only | ONNX Runtime (CPU) | 83.3 ms | 12.0 | 2.7x |
| Network forward pass only | **TensorRT (GPU)** | **7.1 ms** | **140.3** | **31.9x** |
| Full `classify()`-equivalent pipeline | PyTorch eager (CPU) | 386.9 ms | 2.6 | 1.0x |
| Full `classify()`-equivalent pipeline | PyTorch eager (GPU) | 173.6 ms | 5.8 | 2.2x |
| Full `classify()`-equivalent pipeline | **TensorRT (GPU)** | **170.9 ms** | **5.9** | **2.3x** |

**The honest headline finding, not the flattering one:** TensorRT makes the
network itself ~32x faster (7ms), but the *full* pipeline barely moves
(2.3x, not 32x) because the network was never the bottleneck once it's on
a GPU at all -- a per-frame `scipy.spatial.cKDTree` rebuild+query that
upsamples predictions from the 8192 sampled points back to the full
~115k-point raw scan costs **~95ms on its own**, more than the optimized
network, feature engineering, or cleaning combined (see
`security/benchmark_full_pipeline.py`'s docstring and the profiling
breakdown that found this). That's flagged as a separate follow-up task
(the KD-tree step, in `models/inference.py`, is Member 1's file) rather
than fixed in this pass -- **cite the full-pipeline number (5.9 FPS,
170.9ms) for the pitch, not the network-only number (140 FPS)**, since the
network-only figure doesn't reflect what a judge's live demo actually
experiences end to end.

**FP16/INT8 was not pursued in this pass:** this TensorRT version (11.3)
removed the old global `BuilderFlag.FP16` toggle in favor of "strongly
typed" networks or explicit per-tensor dtype overrides -- more involved
than this pass's time budget allowed 2 days out from the internal
hackathon. The FP32 engine above already captures TensorRT's layer-fusion
and GPU-specific kernel-autotuning win; FP16 is a real, flagged follow-up,
not a silently skipped one.

**Jetson deployment was not tested** -- no Jetson hardware was available
in this environment. The `.onnx` file is portable to one; the `.engine`
file is **not** (TensorRT engines are tied to the exact GPU/driver/TensorRT
version that built them) and would need rebuilding on the target device.

## SROS2: encrypted, authenticated ROS 2 node-to-node traffic

Was blocked all week on Member 4's ROS 2 nodes existing; they now do
(`ros2_ws/src/rakshasetu/`), so this is done.

```bash
source /opt/ros/humble/setup.bash   # or wherever your ROS 2 Humble install is
bash security/generate_sros2_keystore.sh
```
Creates `security/sros2_keystore/` (gitignored -- real private keys) with one
enclave per pipeline node (`lidar_ingest_node`, `preprocessing_node`,
`ego_odometry_node`, `segmentation_node`, `grid_engine_node`, `tracking_node`,
`fusion_node`) plus `integration_test_harness` for the test below. Prints the
exact `ROS_SECURITY_*` env vars to export before `ros2 launch`.

**A real bug found and fixed while verifying this actually works, not just
that the keystore generates:** on the ROS 2 Humble build this was tested
against, matching a node to its enclave by the node's own fully-qualified
name alone (the normally-documented default) silently did NOT work --
every node resolved to the keystore's ROOT enclave instead (which has no
`cert.pem`/`key.pem` of its own) and failed to start with `rcl`'s generic
`"couldn't find all security files!"` error. Root-caused by running with
`ROS_SECURITY_ENCLAVE_OVERRIDE` explicitly set per node and observing the
`rcl` log line change from `Found security directory: .../enclaves` (wrong
-- the keystore root) to `.../enclaves/<node_name>` (right). Fixed at the
source: `ros2_ws/src/rakshasetu/launch/rakshasetu.launch.py` now sets
`additional_env={"ROS_SECURITY_ENCLAVE_OVERRIDE": f"/{name}"}` on every
`Node` action -- inert when security is off, required when it's on. If you
run a node directly with `ros2 run` instead of through that launch file,
set the same env var yourself (the generation script's own printed output
reminds you).

**Note on the keystore's location:** it lives under `security/` in this
repo for convenience, but if your ROS 2 install's security plugin reports
the same opaque "couldn't find all security files" error even after
setting `ROS_SECURITY_ENCLAVE_OVERRIDE` correctly, regenerate the keystore
onto your OS's native filesystem instead of a Windows-drive/network mount
(e.g. WSL's `/mnt/*` DrvFs) and point `ROS_SECURITY_KEYSTORE` there --
some filesystem/security-plugin combinations behave inconsistently with
keystores on a non-native mount, and this was one of the first things ruled
out while diagnosing the bug above.

## Full ROS 2 pipeline integration test

```bash
source /opt/ros/humble/setup.bash
source ros2_ws/install/setup.bash    # colcon build first if this doesn't exist yet
python3 security/integration_test_ros2_pipeline.py                 # SROS2 enforced (default)
python3 security/integration_test_ros2_pipeline.py --no-security --timeout-s 20
```

Launches the 7 REAL pipeline nodes (no mocks -- the actual
segmentation/grid/tracking/fusion wrappers around Members 1-3's code) as
subprocesses and confirms real, well-formed, NaN/Inf-free frames come out
`/rakshasetu/fusion/output`. `lidar_ingest_node`/`ego_odometry_node`
self-publish from `shared/mock_data.py`'s real 20-frame scene on their own
timers (see those nodes' own "SWAP FOR REAL DATA LATER" docstrings) --
nothing else needs to be injected.

**Status, stated honestly (2026-09-15/16):** the SROS2 keystore +
`ROS_SECURITY_ENCLAVE_OVERRIDE` fix documented above **is verified** --
confirmed working end to end with real pipeline nodes and real data,
security enforced. The script above, in its current form, has **not yet
been cleanly re-verified** against `feature/ros2-integration` specifically:
an earlier version of this test was verified against a since-discovered
*stale, uncommitted* copy of `ros2_ws/src` that turned out to differ from
the canonical branch (different wire-schema module -- `topics.py` vs.
`schemas.py` -- though the same topic names, node names, and JSON-over-
`std_msgs/String` approach). This script has been rewritten to match
`schemas.py`'s actual contract, but a clean confirmation run was
interrupted mid-session by discovering ANOTHER concurrent session's live
CARLA simulation + `carla_ros_bridge` actively running on the same
`ROS_DOMAIN_ID` on this shared machine -- re-running node launches
alongside it risked cross-talk contaminating both runs' results, so
testing was paused to avoid disrupting what may be today's hackathon
rehearsal. **Next step, not yet done:** either re-run this script with
`ROS_DOMAIN_ID` set to something other than the live demo's, or coordinate
a window when the domain is free, then update this section with a real
confirmed pass/fail against `feature/ros2-integration`.

## What's intentionally not here (yet)

- FP16/INT8 TensorRT precision, a Jetson deployment test, the fallback
  demo video -- separate items on Member 6's checklist, not part of this
  pass.
- A live-CARLA run of the integration test above (see that section's
  "scope, stated honestly").
