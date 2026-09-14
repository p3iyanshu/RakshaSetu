import { CLASS_COLOR } from "../lib/colors.js";

function ClassBadge({ cls }) {
  const c = CLASS_COLOR[cls] || CLASS_COLOR[5]; // 5 = "unclassified", the correct fallback for an unrecognized cls value
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
      style={{ backgroundColor: `${c.base}22`, color: c.base }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.base }} />
      {c.label}
    </span>
  );
}

function MotionBadge({ isDynamic }) {
  // 3 = dynamic_vehicle's amber -- this badge just needs "the" caution/dynamic
  // accent color, not a specific object's actual class.
  const color = isDynamic ? CLASS_COLOR[3].base : "var(--ink-dim)";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
      style={{ backgroundColor: isDynamic ? `${CLASS_COLOR[3].base}22` : "rgba(125,154,151,0.12)", color }}
    >
      {isDynamic ? "Dynamic" : "Static"}
    </span>
  );
}

export default function ObjectsTable({ objects }) {
  if (!objects || objects.length === 0) {
    return <div className="font-mono text-xs text-[var(--ink-faint)] py-8 text-center uppercase tracking-wide">No tracked objects in this frame</div>;
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12.5px] border-collapse font-mono">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] border-b" style={{ borderColor: "var(--line)" }}>
            <th className="py-2 px-2 font-medium">Track</th>
            <th className="py-2 px-2 font-medium">Class</th>
            <th className="py-2 px-2 font-medium">State</th>
            <th className="py-2 px-2 font-medium">Position (m)</th>
            <th className="py-2 px-2 font-medium">Velocity (m/s)</th>
            <th className="py-2 px-2 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {objects.map((o) => (
            <tr key={o.track_id} className="border-b" style={{ borderColor: "rgba(36,57,59,0.6)" }}>
              <td className="py-2 px-2 text-[var(--ink)]">#{o.track_id}</td>
              <td className="py-2 px-2">
                <ClassBadge cls={o.cls} />
              </td>
              <td className="py-2 px-2">
                <MotionBadge isDynamic={o.is_dynamic} />
              </td>
              <td className="py-2 px-2 text-[var(--ink-dim)]">
                {o.position[0].toFixed(1)}, {o.position[1].toFixed(1)}
              </td>
              <td className="py-2 px-2 text-[var(--ink-dim)]">
                {o.velocity[0].toFixed(1)}, {o.velocity[1].toFixed(1)}
              </td>
              <td className="py-2 px-2 text-[var(--signal)]">{Math.round(o.confidence * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
