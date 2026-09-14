# Member 6 — Security, Optimization, Testing & Pitch Lead

**Project:** RakshaSetu — Adaptive Variable-Resolution 2.5D LiDAR Mapping (SIH PS 26053)
**Your module:** hardens the system, makes it fast enough to actually be "real-time," proves it works end-to-end, and gets the team ready to present it.

---

## Your mission

Your work is cross-cutting — it applies on top of what everyone else builds, so most of your heavy lifting starts once the other members' pieces exist (weeks 3–5). In the early weeks, you're the team's floating resource: help wherever there's a bottleneck (usually Member 1's model training, which is the slowest single piece).

---

## Setup — get your environment ready

```bash
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS/Linux:            source .venv/bin/activate

pip install "python-jose[cryptography]" fastapi-users pytest onnx onnxruntime
```
`openssl` is needed for the TLS cert command in your brief below — it ships with Git Bash on Windows, or install via `choco install openssl` if it's not already on your PATH. Verify with `openssl version`.

TensorRT itself is NVIDIA-GPU- and driver-version-specific to install — follow NVIDIA's current install guide for your exact CUDA version rather than a generic `pip install`; budget real time for this, it is rarely a five-minute install.

**While you're floating in weeks 1–2:** don't wait for a formal assignment to help — proactively check in on whichever of Member 2 (grid engine) or Member 4 (ROS 2 integration) is furthest behind, since those two are the current critical-path risk (see `PROJECT_EXECUTION_PLAN.md` §7), and start the security architecture doc in parallel.

---

## Task breakdown

### 1. Security — set this up early enough to not be an afterthought

**Dashboard auth (TLS + JWT):**
- Generate a cert (`openssl req -x509 -newkey rsa:4096 ...`), run the FastAPI server over `wss://` not `ws://`
- JWT-based auth via `python-jose` or `fastapi-users` — require a valid token before the WebSocket handshake completes
- Basic RBAC: viewer role (watch only) vs. admin role (can reconfigure/restart the pipeline)

**ROS 2 internal security (SROS2):**
```bash
ros2 security create_keystore <keystore_dir>
ros2 security create_key <keystore_dir> /rakshasetu/segmentation_node
```
Set `ROS_SECURITY_ENABLE=true` and `ROS_SECURITY_STRATEGY=Enforce` — this gives authenticated, encrypted node-to-node traffic essentially for free.

**Input validation:**
- Reject NaN/Inf coordinates or implausible point counts before they reach the model
- Pydantic models on every FastAPI endpoint

**Audit logging:**
- Structured JSON logs (timestamp, user, action, detection ID) to a local file or SQLite table

**Framing for the pitch:** present this as "security-by-design," not "DRDO-certified" — full defense certification is a real, months-long process outside hackathon scope. Being honest about that distinction is more credible than overclaiming.

### 2. Optimization — make the real-time claim actually true
- Export Member 1's trained model to ONNX, then to a TensorRT engine
- Re-benchmark latency/FPS after optimization — this number needs to come from an actual run, not an estimate
- If a Jetson board is available, test deployment there to back up the "power-constrained embedded hardware" claim

### 3. Testing
- Integration test: run the full pipeline end-to-end on a scripted CARLA scenario, confirm output reaches the dashboard correctly
- Sanity-check Member 2's grid engine benchmark and Member 3's tracking accuracy against their own reported numbers — an outside pair of eyes here catches mistakes the module owner won't notice in their own work

### 4. Metrics collection
Pull together the final numbers everyone will quote in the pitch, from actual runs, not placeholders:
- Segmentation mIoU (Member 1)
- Grid compute/memory savings % (Member 2)
- Tracking accuracy (Member 3)
- End-to-end latency + FPS (post-optimization, yours)

Make sure these numbers are **internally consistent** — e.g., if you report 42 FPS, the corresponding latency should be ~24ms (1000/42), not some unrelated number. Judges do check this arithmetic.

### 5. Demo safety net
Record a pre-recorded fallback video of a full successful run. If the live demo breaks during judging, you have something to fall back to instead of an awkward silence.

### 6. Pitch coordination
- Keep the PPT content in sync with what's actually been built (don't let the deck claim something the prototype doesn't yet do)
- Rehearse the pitch with the team using the real, working prototype as soon as it exists — not just the slides

---

## Interface contract

**You receive from:** everyone — you're the last stop before the demo, so your job touches all five other modules
**You deliver to:** the finished, hardened, benchmarked, demo-ready system

## Tools
TensorRT, ONNX Runtime, SROS2, `python-jose`/`fastapi-users`, `pytest`, a screen recorder (OBS or similar) for the fallback video.

## Common pitfalls

- **A hardcoded JWT secret committed to the repo.** Use an environment variable (`.env`, already `.gitignore`-able — check it's actually listed) — a secret in git history is compromised even if you remove it in a later commit.
- **Wiring in TLS/SROS2 in the last week "once things are stable."** By then nobody has tested against it, and it becomes the thing that breaks the demo. Get it in early enough (week 3 per your timeline below) that every subsequent PR is already running against it.
- **Benchmarking latency including one-time model load time.** Loading a model/engine happens once at startup; if it's included in your per-frame latency measurement, your reported FPS will be wrong (too low) and won't match reality — measure steady-state per-frame latency after warmup, separately from cold-start time.
- **Reporting metrics that don't arithmetically agree with each other.** If FPS is reported as 42, latency should be ~24ms (`1000/42`) — judges do check this; pull every final number from the same benchmark run rather than combining numbers measured under different conditions.
- **A fallback video that's out of date.** Re-record it whenever the pipeline changes meaningfully — a fallback showing an old, less complete version of the system undersells the actual work if it ever has to be shown.

## Timeline
- **Weeks 1–2**: float and help wherever the team is bottlenecked (likely Member 1's training); start drafting the security architecture doc in parallel
- **Week 3**: begin wiring in TLS/JWT/SROS2 as the pipeline stabilizes
- **Week 4**: TensorRT/ONNX optimization pass, re-benchmark
- **Week 5**: full integration testing, record fallback demo video, finalize all reported metrics, rehearse the pitch with the team

## Deliverables checklist
- [ ] TLS + JWT auth on the dashboard
- [ ] SROS2 keystores set up for ROS 2 traffic
- [ ] Input validation + audit logging in place
- [ ] Model exported to TensorRT/ONNX, re-benchmarked
- [ ] Full end-to-end integration test passing
- [ ] All final metrics collected from real runs and internally consistent
- [ ] Fallback demo video recorded
- [ ] Team rehearsed on the real prototype before presenting
