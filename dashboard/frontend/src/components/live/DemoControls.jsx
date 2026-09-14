/** Play/Pause/Restart + speed, nothing more -- a small transport strip,
 * not a gaming-style control panel. */
export default function DemoControls({ playing, speedMul, onTogglePlay, onRestart, onSetSpeed }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px]">
      <button
        onClick={onTogglePlay}
        className="px-2.5 py-1 border uppercase tracking-wide"
        style={{ borderColor: "var(--line)", color: "var(--ink)", background: "rgba(17,28,29,0.7)" }}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button
        onClick={onRestart}
        className="px-2.5 py-1 border uppercase tracking-wide"
        style={{ borderColor: "var(--line)", color: "var(--ink)", background: "rgba(17,28,29,0.7)" }}
      >
        Restart
      </button>
      <div className="flex border" style={{ borderColor: "var(--line)" }}>
        {[0.5, 1, 2].map((s) => (
          <button
            key={s}
            onClick={() => onSetSpeed(s)}
            className="px-2 py-1 uppercase"
            style={
              speedMul === s
                ? { color: "var(--ground)", background: "var(--signal)" }
                : { color: "var(--ink-dim)", background: "transparent" }
            }
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
