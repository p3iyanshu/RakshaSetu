import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "../lib/auth.js";

/**
 * The one real thing an admin can do that a viewer can't: force which feed
 * source is served, and reset the mock scene. Both endpoints are
 * admin-only server-side (require_role(auth.ROLE_ADMIN) in main.py) --
 * this panel only renders on /admin, which RequireAuth already restricts
 * to the admin role, so a viewer never even sees it.
 */
export default function AdminControls() {
  const [forcedMode, setForcedMode] = useState(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshHealth() {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      const data = await res.json();
      setForcedMode(data.forced_mode ?? null);
    } catch {
      setForcedMode(null);
    }
  }

  useEffect(() => {
    refreshHealth();
  }, []);

  async function setMode(mode) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/feed-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Request failed");
      const data = await res.json();
      setForcedMode(data.forced_mode ?? null);
      setMessage(`Feed source: ${data.effective_mode}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetMock() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/reset-mock`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Request failed");
      setMessage("Mock scene reset");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cut border p-5" style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface), rgba(17,28,29,0.65))" }}>
      <div className="flex items-center justify-between mb-4 pb-2.5 border-b" style={{ borderColor: "var(--line)" }}>
        <span className="font-display text-[12.5px] font-semibold uppercase tracking-[0.09em] text-[var(--ink)]">Admin controls</span>
        <span className="font-mono text-[10.5px]" style={{ color: "var(--amber)" }}>ADMIN ONLY</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10.5px] text-[var(--ink-dim)] uppercase">Feed source</span>
        <ModeButton label="Auto" active={forcedMode == null} onClick={() => setMode("auto")} disabled={busy} />
        <ModeButton label="Force real" active={forcedMode === "real"} onClick={() => setMode("real")} disabled={busy} />
        <ModeButton label="Force mock" active={forcedMode === "mock"} onClick={() => setMode("mock")} disabled={busy} />

        <span className="w-px self-stretch mx-2" style={{ background: "var(--line)" }} />

        <button
          onClick={resetMock}
          disabled={busy}
          className="font-display text-[11px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-opacity disabled:opacity-40"
          style={{ color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }}
        >
          Reset mock scene
        </button>

        {message && <span className="font-mono text-[10.5px] text-[var(--ink-dim)]">{message}</span>}
      </div>
    </section>
  );
}

function ModeButton({ label, active, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="font-display text-[11px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-opacity disabled:opacity-40"
      style={
        active
          ? { color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)" }
          : { color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }
      }
    >
      {label}
    </button>
  );
}
