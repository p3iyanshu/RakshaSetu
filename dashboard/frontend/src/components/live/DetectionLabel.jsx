import { CLASS_COLOR } from "../../lib/colors.js";

/**
 * One tracked object's compact annotation: a small marker (dot for static,
 * diamond for dynamic) plus -- only when not `compact` -- a tight card:
 * class, track_id, confidence, and (dynamic objects only) compensated
 * speed with a direction arrow. All from real frame fields
 * (cls/track_id/confidence/velocity); nothing here is a placeholder.
 *
 * `compact` drops the card to just the marker dot -- with a real scene
 * carrying 80+ static tracks, a full card on every single one is exactly
 * the "giant cards over the map" clutter the design brief forbids. Distant
 * static occupancy already reads from the grid itself.
 */
export default function DetectionLabel({
  x,
  y,
  cls,
  trackId,
  confidence,
  isDynamic,
  velocity,
  rangeM,
  alpha,
  scanIn,
  compact = false,
  selected = false,
  onSelect,
}) {
  const info = CLASS_COLOR[cls] || CLASS_COLOR[5];
  const vx = velocity?.[0] || 0;
  const vy = velocity?.[1] || 0;
  const speed = isDynamic ? Math.hypot(vx, vy) : 0;
  const headingDeg = isDynamic ? (Math.atan2(vy, vx) * 180) / Math.PI : 0;

  return (
    <div
      className="absolute flex flex-col items-center"
      style={{
        left: x,
        top: y,
        transform: `translate(-50%, -100%) translateY(${(1 - scanIn) * 10}px)`,
        opacity: alpha,
        pointerEvents: "auto",
        cursor: "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(trackId);
      }}
    >
      {!compact && (
        <div
          className="font-mono flex flex-col items-center px-1.5 py-1 mb-1 border leading-tight"
          style={{
            fontSize: 9,
            letterSpacing: "0.03em",
            color: "var(--ink)",
            background: "rgba(8,13,14,0.86)",
            borderColor: "rgba(220,233,231,0.12)",
            borderLeft: `2px solid ${info.base}`,
          }}
        >
          <span className="uppercase" style={{ color: info.base }}>
            {info.label}
          </span>
          <span style={{ color: "var(--ink-dim)" }}>
            #{trackId} · {rangeM != null ? `${rangeM.toFixed(1)}m` : "—"} · {Math.round((confidence || 0) * 100)}%
          </span>
          {speed > 0.3 && (
            <span className="flex items-center gap-1" style={{ color: info.base }}>
              {speed.toFixed(1)} m/s
              <svg width="10" height="10" viewBox="-5 -5 10 10" style={{ transform: `rotate(${headingDeg}deg)` }}>
                <line x1="0" y1="3" x2="0" y2="-3" stroke={info.base} strokeWidth="1.4" />
                <polygon points="0,-4.5 2,-1.5 -2,-1.5" fill={info.base} />
              </svg>
            </span>
          )}
        </div>
      )}
      <div
        style={{
          width: isDynamic ? 8 : 6,
          height: isDynamic ? 8 : 6,
          background: info.base,
          borderRadius: isDynamic ? 2 : "50%",
          transform: isDynamic ? "rotate(45deg)" : "none",
          opacity: 0.92,
          boxShadow: selected ? `0 0 0 4px ${info.base}55, 0 0 0 1px ${info.base}` : "none",
        }}
      />
    </div>
  );
}
