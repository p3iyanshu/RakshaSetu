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

## What's intentionally not here (yet)

- SROS2 keystores for ROS 2 node-to-node traffic -- blocked on Member 4's
  ROS 2 nodes existing (`ros2 security create_keystore` needs a running
  workspace to point at).
- Audit logging, ONNX/TensorRT optimization, integration testing, the
  fallback demo video -- separate items on Member 6's checklist, not part
  of this pass.
