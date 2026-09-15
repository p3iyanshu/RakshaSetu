/** Compact panel section used inside the Live Perception side columns --
 * six of these stack in two narrow asides, so this stays terser than the
 * app's other "cut border" cards (AdminView/StatTile) by design. */
export default function Panel({ title, right, children }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b" style={{ borderColor: "var(--line)" }}>
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink-dim)" }}>
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}
