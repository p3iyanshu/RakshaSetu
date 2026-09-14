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

## What's intentionally not here (yet)

- SROS2 keystores for ROS 2 node-to-node traffic -- blocked on Member 4's
  ROS 2 nodes existing (`ros2 security create_keystore` needs a running
  workspace to point at).
- FP16/INT8 TensorRT precision, a Jetson deployment test, the fallback
  demo video -- separate items on Member 6's checklist, not part of this
  pass.
