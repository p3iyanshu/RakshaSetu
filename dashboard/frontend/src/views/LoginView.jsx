import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../lib/auth.js";

/**
 * Gate in front of both consoles. Demo credentials live in
 * security/auth.py (admin/admin123, viewer/viewer123 by default) -- see
 * security/README.md to override them before showing this outside the team.
 */
export default function LoginView() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const redirectTo = location.state?.from ?? "/car";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center" style={{ background: "var(--ground)" }}>
      <div className="console-field" />
      <div className="console-scanlines" />
      <form
        onSubmit={handleSubmit}
        className="cut relative z-[2] w-full max-w-[360px] mx-4 border p-7 flex flex-col gap-5"
        style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface), rgba(17,28,29,0.65))" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="cut-sm w-[38px] h-[38px] flex items-center justify-center font-display font-bold text-[16px] shrink-0"
            style={{ color: "var(--ground)", background: "linear-gradient(135deg, var(--signal), #1f8fa8)", boxShadow: "0 0 18px var(--signal-glow)" }}
          >
            RS
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display font-bold text-[17px] tracking-[0.06em] text-[var(--ink)]">RAKSHASETU</span>
            <span className="font-mono text-[10px] tracking-wide text-[var(--ink-dim)] uppercase">Console access</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Username">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-transparent border px-3 py-2 font-mono text-[13px] outline-none"
              style={{ borderColor: "var(--line)", color: "var(--ink)" }}
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border px-3 py-2 font-mono text-[13px] outline-none"
              style={{ borderColor: "var(--line)", color: "var(--ink)" }}
              autoComplete="current-password"
            />
          </Field>
        </div>

        {error && (
          <div className="font-mono text-[11px] px-3 py-2 border" style={{ color: "var(--danger)", borderColor: "rgba(226,88,79,0.4)", backgroundColor: "var(--danger-soft)" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="font-display text-[12px] font-semibold tracking-[0.08em] uppercase px-4 py-2.5 border transition-opacity disabled:opacity-40"
          style={{ color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)", boxShadow: "0 0 16px var(--signal-glow)" }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="font-mono text-[10px] text-[var(--ink-faint)] leading-relaxed">
          Viewer role watches the live feed only; admin role can also force the feed source and reset the demo scene from Mission Ops.
        </p>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-wide text-[var(--ink-dim)] uppercase">{label}</span>
      {children}
    </label>
  );
}
