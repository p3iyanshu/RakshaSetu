import { CLASS_COLOR } from "../lib/colors.js";

export default function ClassLegend({ compact = false }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-wide text-[var(--ink-dim)] ${compact ? "" : "justify-center"}`}>
      {Object.entries(CLASS_COLOR).map(([cls, c]) => (
        <span key={cls} className="flex items-center gap-1.5">
          <i className="inline-block h-[8px] w-[8px] rounded-full" style={{ backgroundColor: c.base }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}
