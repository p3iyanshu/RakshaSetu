import { CLASS_COLOR } from "../../lib/colors.js";
import { VehicleIcon, HumanIcon, WallIcon, PoleIcon } from "../icons/RoadsideIcons.jsx";

const CLASS_ICON = {
  0: null, // drivable -- no discrete icon, shown as a plain color swatch below
  1: WallIcon,
  2: PoleIcon,
  3: VehicleIcon,
  4: HumanIcon,
  5: null, // unclassified -- plain swatch
};

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[10.5px]">
      <span style={{ color: "var(--ink-faint)" }}>{label}</span>
      <span style={{ color: "var(--ink)" }} className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * SELECTED OBJECT -- every field traces to a real TrackedObject: class,
 * track_id, distance (derived from position), velocity, confidence, and a
 * static/dynamic status badge, plus a small top-down class icon.
 */
export default function SelectedObjectPanel({ obj }) {
  if (!obj) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b" style={{ borderColor: "var(--line)" }}>
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink-dim)" }}>
            Selected Object
          </span>
        </div>
        <span className="font-mono text-[10px]" style={{ color: "var(--ink-faint)" }}>
          Click a marker on the map to inspect it.
        </span>
      </div>
    );
  }

  const color = (CLASS_COLOR[obj.cls] ?? CLASS_COLOR[5]).base;
  const label = (CLASS_COLOR[obj.cls] ?? CLASS_COLOR[5]).label;
  const Icon = CLASS_ICON[obj.cls];
  const distanceM = Math.hypot(obj.position[0], obj.position[1]);
  const speedMps = Math.hypot(obj.velocity[0], obj.velocity[1]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b" style={{ borderColor: "var(--line)" }}>
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink-dim)" }}>
          Selected Object
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-[38px] h-[38px] shrink-0 flex items-center justify-center border"
          style={{ borderColor: "var(--line)", background: "rgba(10,17,16,0.6)" }}
        >
          {Icon ? <Icon size={22} /> : <i className="inline-block h-[14px] w-[14px] rounded-full" style={{ backgroundColor: color }} />}
        </div>
        <div>
          <div className="font-display text-[11.5px] font-semibold" style={{ color }}>{label}</div>
          <div className="font-mono text-[10px]" style={{ color: "var(--ink-faint)" }}>TRACK #{obj.track_id}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Row label="DISTANCE" value={`${distanceM.toFixed(1)} m`} />
        <Row label="VELOCITY" value={`${speedMps.toFixed(1)} m/s`} />
        <Row label="CONFIDENCE" value={`${(obj.confidence * 100).toFixed(0)}%`} />
        <Row label="STATUS" value={obj.is_dynamic ? "DYNAMIC" : "STATIC"} />
      </div>
    </div>
  );
}
