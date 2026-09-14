import { Link, useNavigate } from "react-router-dom";
import ConnectionBadge from "./ConnectionBadge.jsx";
import { getRole, getUsername, logout } from "../lib/auth.js";

/** Shared console chrome: cut-corner brand mark + name/tag, a two-way mode
 * switch (car HUD <-> admin console), and live connection status. */
export default function Topbar({ active, status }) {
  const navigate = useNavigate();
  const username = getUsername();
  const role = getRole();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }
  return (
    <header className="relative z-[5] flex items-center justify-between gap-5 px-7 py-4 border-b border-[var(--line)] bg-gradient-to-b from-[rgba(17,28,29,0.9)] to-[rgba(17,28,29,0.55)] backdrop-blur-md flex-wrap">
      <div className="flex items-center gap-3">
        <div
          className="cut-sm w-[38px] h-[38px] flex items-center justify-center font-display font-bold text-[16px]"
          style={{ color: "var(--ground)", background: "linear-gradient(135deg, var(--signal), #1f8fa8)", boxShadow: "0 0 18px var(--signal-glow)" }}
        >
          RS
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display font-bold text-[19px] tracking-[0.06em] text-[var(--ink)]">RAKSHASETU</span>
          <span className="font-mono text-[10.5px] tracking-wide text-[var(--ink-dim)] uppercase">
            Adaptive 2.5D LiDAR Console &middot; SIH PS 26053 &middot; DRDO
          </span>
        </div>
      </div>

      <nav className="flex gap-2">
        <ModeButton to="/car" label="Vehicle HUD" isActive={active === "car"} />
        {role === "admin" && <ModeButton to="/admin" label="Mission Ops" isActive={active === "admin"} />}
      </nav>

      <div className="flex items-center gap-4">
        {username && (
          <span className="font-mono text-[10.5px] text-[var(--ink-dim)] uppercase hidden sm:inline">
            {username} &middot; {role}
          </span>
        )}
        <ConnectionBadge status={status} />
        {username && (
          <button
            onClick={handleLogout}
            className="font-display text-[11px] font-semibold tracking-[0.06em] uppercase px-3 py-1.5 border transition-colors"
            style={{ color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

function ModeButton({ to, label, isActive }) {
  return (
    <Link
      to={to}
      className="font-display text-[12px] font-semibold tracking-[0.08em] uppercase px-4 py-2 border transition-colors"
      style={
        isActive
          ? { color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)", boxShadow: "0 0 16px var(--signal-glow)" }
          : { color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }
      }
    >
      {label}
    </Link>
  );
}
