import { CLASS_COLOR } from "../../lib/colors.js";
import { projectPoint } from "../../lib/perception/fanProjection.js";

const MAX_CARDS = 6;
const CARD_W = 96;
const CARD_H = 32;
const GAP_ABOVE_MARKER = 12;

/**
 * Floating per-object detail cards, DOM-overlaid on top of FanCanvas. This
 * data runs dense (60-120+ tracked objects/frame, mostly fragmented static
 * wall clusters -- tracking/README.md) -- FanCanvas already draws a marker
 * for every one of them, but rendering 100+ text labels at once would bury
 * the screen. This caps to a small top-N: the selected object always gets
 * one, then dynamic objects before static, nearest before farthest, and a
 * simple bounding-box collision check so cards never stack illegibly.
 */
export default function DetectionCards({ objects = [], layout, selectedTrackId, onSelect }) {
  if (!layout) return null;

  const candidates = objects
    .map((obj) => {
      const p = projectPoint(obj.position[0], obj.position[1], layout);
      const rangeM = Math.hypot(obj.position[0], obj.position[1]);
      return { obj, sx: p.x, sy: p.y, rangeM };
    })
    .filter((d) => d.sx > -40 && d.sx < layout.width + 40 && d.sy > -40 && d.sy < layout.height + 40)
    .sort((a, b) => {
      if (a.obj.track_id === selectedTrackId) return -1;
      if (b.obj.track_id === selectedTrackId) return 1;
      if (a.obj.is_dynamic !== b.obj.is_dynamic) return a.obj.is_dynamic ? -1 : 1;
      return a.rangeM - b.rangeM;
    });

  const placedBoxes = [];
  const shown = [];
  for (const d of candidates) {
    const isSelected = d.obj.track_id === selectedTrackId;
    if (shown.length >= MAX_CARDS && !isSelected) break;
    const box = {
      left: d.sx - CARD_W / 2,
      right: d.sx + CARD_W / 2,
      top: d.sy - GAP_ABOVE_MARKER - CARD_H,
      bottom: d.sy - GAP_ABOVE_MARKER,
    };
    const collides = placedBoxes.some((b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top);
    if (collides && !isSelected) continue;
    placedBoxes.push(box);
    shown.push(d);
  }

  return (
    <>
      {shown.map(({ obj, sx, sy }) => {
        const color = (CLASS_COLOR[obj.cls] ?? CLASS_COLOR[5]).base;
        const label = (CLASS_COLOR[obj.cls] ?? CLASS_COLOR[5]).label;
        const isSelected = obj.track_id === selectedTrackId;
        return (
          <button
            key={obj.track_id}
            onClick={() => onSelect?.(obj.track_id)}
            className="absolute font-mono text-[9px] uppercase tracking-wide px-1.5 py-1 border text-left leading-tight whitespace-nowrap"
            style={{
              left: sx,
              top: sy - GAP_ABOVE_MARKER,
              transform: "translate(-50%, -100%)",
              color: "#f4f7f6",
              background: "rgba(10,17,16,0.85)",
              borderColor: isSelected ? "#f4f7f6" : color,
              boxShadow: isSelected ? "0 0 8px rgba(244,247,246,0.55)" : "none",
            }}
          >
            <div style={{ color }}>{label}</div>
            <div style={{ color: "#dce9e7" }}>
              #{obj.track_id} &middot; {(obj.confidence * 100).toFixed(0)}%
            </div>
          </button>
        );
      })}
    </>
  );
}
