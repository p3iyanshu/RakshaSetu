/**
 * Shared semantic icon set for roadside props (tree/pole/wall/curb/pothole)
 * and detections (vehicle/human) -- used by both the Top-Down LiDAR sweep
 * and the Vehicle HUD windshield view so the same class always looks like
 * the same glyph in both places. Every icon takes a `size` in px so callers
 * can scale by distance/severity; viewBox stays fixed so strokes don't
 * distort as size changes.
 */

export function TreeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="9" r="7" fill="#4ac26b" fillOpacity="0.85" />
      <rect x="10.5" y="15" width="3" height="7" rx="1" fill="#8a6a4a" />
    </svg>
  );
}

export function PoleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="10.5" y="4" width="3" height="18" rx="1.2" fill="#e2584f" />
      <circle cx="12" cy="4" r="2.5" fill="#e2584f" />
    </svg>
  );
}

export function WallIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="8" width="20" height="9" rx="1" fill="#e2584f" fillOpacity="0.85" />
      <path d="M2 12.5H22M8 8V12.5M16 8V12.5M5 12.5V17M12 12.5V17M19 12.5V17" stroke="#0a1110" strokeWidth="0.8" />
    </svg>
  );
}

export function CurbIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="10" y="3" width="4" height="18" rx="1.5" fill="#b25de0" />
    </svg>
  );
}

/** Pothole severity genuinely changes the rendered size -- `size` should
 * already include the caller's severity scaling, not just distance. */
export function PotholeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="#b25de0" strokeWidth="2.5" />
      <circle cx="12" cy="12" r="9" fill="#b25de0" fillOpacity="0.18" />
    </svg>
  );
}

export function VehicleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="3.5" fill="#1f2937" stroke="#e2a23b" strokeWidth="1.2" />
      <rect x="6" y="9" width="5" height="4" rx="0.8" fill="#7fd4e8" fillOpacity="0.8" />
      <rect x="13" y="9" width="5" height="4" rx="0.8" fill="#7fd4e8" fillOpacity="0.8" />
    </svg>
  );
}

/** The ego vehicle itself -- pale/light so it never gets confused with a
 * detected (dark) vehicle icon. */
export function EgoVehicleIcon({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="2" width="16" height="20" rx="5" fill="#eef5f4" stroke="var(--signal)" strokeWidth="1.2" />
      <rect x="6.5" y="5" width="11" height="6" rx="1.5" fill="#0a1110" fillOpacity="0.35" />
      <rect x="6.5" y="14" width="11" height="5" rx="1.5" fill="#0a1110" fillOpacity="0.25" />
    </svg>
  );
}

export function HumanIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="6" r="3.2" fill="#f4f7f6" />
      <path d="M12 10c-3.3 0-5.5 2-5.5 5.5V21h11v-5.5C17.5 12 15.3 10 12 10Z" fill="#f4f7f6" fillOpacity="0.92" />
    </svg>
  );
}

export const ROADSIDE_ICON = {
  tree: TreeIcon,
  pole: PoleIcon,
  wall: WallIcon,
  curb: CurbIcon,
  pothole: PotholeIcon,
  vehicle: VehicleIcon,
  human: HumanIcon,
  ego: EgoVehicleIcon,
};
