import { CLASS_COLOR } from "../../lib/colors.js";

/** Details for a clicked detection: real cls/track_id/confidence/velocity,
 * nothing invented. With nothing selected it says so plainly. */
export default function SelectedObjectPanel({ obj }) {
  if (!obj) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
          Selected object
        </span>
        <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
          Click a detection to inspect it
        </span>
      </div>
    );
  }
  const info = CLASS_COLOR[obj.cls] || CLASS_COLOR[5];
  const vx = obj.velocity?.[0] || 0;
  const vy = obj.velocity?.[1] || 0;
  const speed = obj.isDynamic ? Math.hypot(vx, vy) : 0;
  const rangeM = Math.hypot(obj.forward, obj.right);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
        Selected object
      </span>
      <div className="flex items-start gap-2">
        <div className="font-mono text-[10.5px] flex-1 flex flex-col gap-0.5" style={{ color: "var(--ink-dim)" }}>
          <span>
            Class <span style={{ color: "var(--ink)" }}>{info.label}</span>
          </span>
          <span>
            Track ID <span style={{ color: "var(--ink)" }}>#{obj.trackId}</span>
          </span>
          <span>
            Distance <span style={{ color: "var(--ink)" }}>{rangeM.toFixed(1)} m</span>
          </span>
          {obj.isDynamic && (
            <span>
              Velocity <span style={{ color: "var(--ink)" }}>{speed.toFixed(1)} m/s</span>
            </span>
          )}
          <span>
            Confidence <span style={{ color: "var(--ink)" }}>{Math.round((obj.confidence || 0) * 100)}%</span>
          </span>
          <span>
            Status{" "}
            <span style={{ color: obj.isDynamic ? "var(--amber)" : "var(--ink)" }}>
              {obj.isDynamic ? "MOVING" : "STATIC"}
            </span>
          </span>
        </div>
        <ClassIcon cls={obj.cls} color={info.base} />
      </div>
    </div>
  );
}

/** Small static top-down illustration for the selected object's class --
 * decorative reference art, not a rendering of the actual detection. */
function ClassIcon({ cls, color }) {
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{ width: 42, height: 42, border: `1px solid ${color}55`, background: "rgba(10,17,16,0.5)" }}
    >
      <svg width="26" height="26" viewBox="-13 -13 26 26">
        {cls === 3 && ( // dynamic: vehicle -- top-down car body
          <g>
            <rect x="-6" y="-10" width="12" height="20" rx="3" fill={color} opacity="0.85" />
            <rect x="-4" y="-6" width="8" height="6" rx="1" fill="rgba(10,17,16,0.6)" />
          </g>
        )}
        {cls === 4 && ( // dynamic: human -- head + shoulders
          <g>
            <circle cx="0" cy="-5" r="3.4" fill={color} />
            <path d="M -5 9 Q 0 -1 5 9 Z" fill={color} opacity="0.85" />
          </g>
        )}
        {cls === 1 && ( // static: wall -- flat barrier segment
          <rect x="-11" y="-3" width="22" height="6" fill={color} opacity="0.85" />
        )}
        {cls === 2 && ( // static: pole -- thin post, seen from above
          <g>
            <circle cx="0" cy="0" r="7" fill="none" stroke={color} strokeWidth="1.2" opacity="0.6" />
            <circle cx="0" cy="0" r="2.4" fill={color} />
          </g>
        )}
        {cls !== 1 && cls !== 2 && cls !== 3 && cls !== 4 && (
          <g>
            <rect x="-8" y="-8" width="16" height="16" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="3 2" />
            <text x="0" y="4" textAnchor="middle" fontSize="10" fill={color} fontFamily="monospace">
              ?
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
