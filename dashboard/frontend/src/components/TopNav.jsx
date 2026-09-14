import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { getRole, logout } from "../lib/auth.js";

const NAV_ITEMS = [
  { to: "/dashboard/car", label: "Vehicle HUD" },
  { to: "/dashboard/lidar", label: "Top-Down LiDAR" },
  { to: "/dashboard/live", label: "Live Perception" },
  { to: "/dashboard/admin", label: "Web Command Deck", role: "admin" },
];

const STATUS_STYLE = {
  open: { label: "System online", color: "#4ac26b" },
  connecting: { label: "Connecting…", color: "#e2a23b" },
  closed: { label: "Reconnecting…", color: "#e2a23b" },
  error: { label: "Connection error", color: "#e2584f" },
  unauthorized: { label: "Session expired", color: "#e2584f" },
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Horizontal top bar matching the RakshaSetu Console reference: brand mark
 * left, section tabs centered, connection status + clock right. Replaces
 * the old per-view Topbar/Sidebar -- one persistent piece of chrome for the
 * whole dashboard. */
export default function TopNav({ status }) {
  const navigate = useNavigate();
  const role = getRole();
  const now = useClock();
  const s = STATUS_STYLE[status] || STATUS_STYLE.connecting;

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header
      className="relative z-[5] flex items-center justify-between gap-4 px-6 py-3 border-b flex-wrap"
      style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.95)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="cut-sm w-[34px] h-[34px] flex items-center justify-center font-display font-bold text-[14px] shrink-0"
          style={{ color: "var(--ground)", background: "linear-gradient(135deg, var(--signal), #1f8fa8)", boxShadow: "0 0 18px var(--signal-glow)" }}
        >
          RS
        </div>
        <span className="font-display font-bold text-[17px] tracking-[0.06em] text-[var(--ink)]">RAKSHASETU</span>
      </div>

      <nav className="flex gap-2">
        {NAV_ITEMS.filter((item) => !item.role || role === item.role).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="font-display text-[11.5px] font-semibold tracking-[0.06em] uppercase px-4 py-2 border transition-colors"
            style={({ isActive }) =>
              isActive
                ? { color: "var(--ground)", background: "var(--signal)", borderColor: "var(--signal)", boxShadow: "0 0 16px var(--signal-glow)" }
                : { color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center gap-2 font-mono text-[10.5px] tracking-wide px-3 py-1.5 border"
          style={{ color: s.color, backgroundColor: `${s.color}22`, borderColor: `${s.color}59` }}
        >
          <span className={`h-[7px] w-[7px] rounded-full ${status === "open" ? "pulse-dot" : ""}`} style={{ backgroundColor: s.color }} />
          {s.label.toUpperCase()}
        </span>
        <span className="font-mono text-[13px] font-semibold text-[var(--ink)] tabular-nums">
          {now.toLocaleTimeString("en-GB", { hour12: false })}
        </span>
        {role && (
          <button
            onClick={handleLogout}
            className="font-display text-[10.5px] font-semibold tracking-[0.06em] uppercase px-2.5 py-1.5 border transition-colors"
            style={{ color: "var(--ink-dim)", background: "var(--surface)", borderColor: "var(--line)" }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
