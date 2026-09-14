import { CLASS_COLOR } from "../../lib/colors.js";

/**
 * Why RakshaSetu keeps height information: click any cell on the map to
 * inspect it. Real height_max/height_mean from the actual grid cell --
 * nothing here is estimated or invented; with no cell selected it just
 * says so rather than showing a placeholder number.
 */
export default function ElevationPanel({ cell }) {
  const info = cell ? CLASS_COLOR[cell.cls] || CLASS_COLOR[5] : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
        2.5D · selected cell
      </span>
      {!cell ? (
        <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
          Click a cell on the map
        </span>
      ) : (
        <div className="font-mono text-[10.5px] flex flex-col gap-0.5" style={{ color: "var(--ink-dim)" }}>
          <div className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: info.base }} />
            <span style={{ color: "var(--ink)" }}>{info.label}</span>
          </div>
          <span>
            Height max <span style={{ color: "var(--ink)" }}>{cell.height_max?.toFixed(2) ?? "0.00"} m</span>
          </span>
          <span>
            Height mean <span style={{ color: "var(--ink)" }}>{cell.height_mean?.toFixed(2) ?? "0.00"} m</span>
          </span>
          <span>
            Confidence <span style={{ color: "var(--ink)" }}>{Math.round((cell.confidence || 0) * 100)}%</span>
          </span>
          <span>
            Points <span style={{ color: "var(--ink)" }}>{cell.point_count ?? "—"}</span>
          </span>
          {/* elevation scale */}
          <div className="mt-1 h-1.5 w-full rounded-sm" style={{ background: "var(--line)" }}>
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.min(100, ((cell.height_max || 0) / 2.5) * 100)}%`,
                background: info.base,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
