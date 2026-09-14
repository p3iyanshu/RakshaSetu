import { ROADSIDE_ICON } from "./icons/RoadsideIcons.jsx";

/**
 * One detection/prop marker: icon + label pill, absolutely positioned by
 * the caller's own projection math (screen-space x/y already computed) so
 * the exact same marker looks identical whether it's placed by the polar
 * Top-Down LiDAR sweep or the forward-perspective Vehicle HUD.
 */
export default function SemanticMarker({ type, label, x, y, size = 20, dim = false, labelAbove = true }) {
  const Icon = ROADSIDE_ICON[type];
  if (!Icon) return null;

  return (
    <div
      className="absolute flex flex-col items-center gap-1 pointer-events-none select-none"
      style={{
        left: x,
        top: y,
        transform: labelAbove ? "translate(-50%, -50%)" : "translate(-50%, -50%)",
        opacity: dim ? 0.55 : 1,
      }}
    >
      {labelAbove && label && (
        <span
          className="font-display text-[9.5px] font-semibold tracking-[0.04em] uppercase px-1.5 py-[1px] whitespace-nowrap"
          style={{ color: "#f4f7f6", background: "rgba(10,17,16,0.82)" }}
        >
          {label}
        </span>
      )}
      <Icon size={size} />
    </div>
  );
}
