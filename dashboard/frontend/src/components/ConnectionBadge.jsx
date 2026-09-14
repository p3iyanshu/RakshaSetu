const STATUS_STYLE = {
  open: { label: "System online", color: "#4ac26b", pulse: true },
  connecting: { label: "Connecting…", color: "#e2a23b", pulse: true },
  closed: { label: "Reconnecting…", color: "#e2a23b", pulse: true },
  error: { label: "Connection error", color: "#e2584f", pulse: false },
  unauthorized: { label: "Session expired", color: "#e2584f", pulse: false },
};

export default function ConnectionBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.connecting;
  return (
    <span
      className="inline-flex items-center gap-2 font-mono text-[11px] tracking-wide px-3 py-1.5 border"
      style={{ color: s.color, backgroundColor: `${s.color}22`, borderColor: `${s.color}59` }}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${s.pulse ? "pulse-dot" : ""}`} style={{ backgroundColor: s.color }} />
      {s.label.toUpperCase()}
    </span>
  );
}
