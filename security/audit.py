"""
RakshaSetu audit logging -- structured JSON Lines log of who did what.

Per Member 6's brief: "Structured JSON logs (timestamp, user, action,
detection ID) to a local file or SQLite table." A flat JSON-Lines file was
chosen over SQLite -- one `json.dumps` per line, append-only, no schema
migrations, and a judge or teammate can `tail`/`cat` it directly to see
what happened during a demo run without any tooling.

Every event has the same envelope (timestamp, username, role, action,
outcome) plus a free-form `detail` dict for action-specific fields (e.g.
detection/track IDs, the requested feed mode). `outcome` is always
"success" or "denied"/"failure" so a reviewer can grep for what didn't
work without parsing detail.

Never raises into the caller: a logging failure (e.g. disk full, path
unwritable) prints a warning and drops the event rather than taking down
an auth or admin request over an audit-trail write.
"""
import json
import os
import threading
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LOG_PATH = os.path.join(HERE, "audit.log")

_lock = threading.Lock()
_log_path = os.environ.get("RAKSHASETU_AUDIT_LOG_PATH", DEFAULT_LOG_PATH)


def log_action(action: str, username: str = None, role: str = None,
                outcome: str = "success", detail: dict = None) -> None:
    """Appends one structured audit event. Fields:
      timestamp -- UTC ISO 8601
      action    -- short verb-phrase, e.g. "login", "admin.feed_mode", "ws.connect"
      username  -- the acting principal, or None for unauthenticated attempts
      role      -- "viewer"/"admin"/None
      outcome   -- "success" | "denied" | "failure"
      detail    -- action-specific structured fields (JSON-serializable)
    """
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "username": username,
        "role": role,
        "outcome": outcome,
        "detail": detail or {},
    }
    line = json.dumps(event, sort_keys=True)
    try:
        with _lock:
            with open(_log_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except OSError as e:
        print(f"[security.audit] WARNING: failed to write audit log entry ({e}): {line}")


def read_recent(limit: int = 100) -> list:
    """Returns up to the last `limit` audit events, oldest first. Used by
    the admin-only /api/admin/audit-log endpoint and by tests. Tolerates a
    missing file (no events logged yet) and skips any corrupt line rather
    than failing the whole read."""
    if not os.path.exists(_log_path):
        return []
    events = []
    with open(_log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events[-limit:]
