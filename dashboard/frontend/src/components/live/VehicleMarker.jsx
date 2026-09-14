/** The ego vehicle -- a recognizable body + a visible LiDAR sensor puck on
 * top, not a bare triangle. Fixed at the scene's anchor point; everything
 * else (road, grid, objects) moves/rotates around it, matching how a real
 * vehicle-relative sensor display works. Heading rotates via CSS
 * transition, not a snap, so the scripted turn reads as steering. */
export default function VehicleMarker({ x, y, headingDeg }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: x,
        top: y,
        transform: `translate(-50%, -50%) rotate(${headingDeg}deg)`,
        transition: "transform 200ms linear",
      }}
    >
      <svg width="30" height="52" viewBox="-15 -26 30 52" style={{ overflow: "visible" }}>
        <ellipse cx="0" cy="20" rx="9" ry="3" fill="rgba(0,0,0,0.35)" />
        <rect x="-8" y="-22" width="16" height="42" rx="4" fill="var(--ink)" stroke="rgba(10,17,16,0.6)" strokeWidth="1" />
        <rect x="-5.5" y="-16" width="11" height="12" rx="1.5" fill="rgba(10,17,16,0.55)" />
        <circle cx="0" cy="-16" r="3" fill="var(--signal)" opacity="0.9" />
      </svg>
    </div>
  );
}
