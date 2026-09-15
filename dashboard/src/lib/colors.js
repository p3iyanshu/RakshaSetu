/**
 * RakshaSetu Semantic Colors and Visual Palette Tokens
 * Matches exact colors from reference screenshots and Member 6 handover.
 */

export const SEMANTIC_COLORS = {
  drivable: '#00e676',       // Bright green for road / drivable corridor
  static_wall: '#ef4444',    // Bright red for static walls / barriers
  static_pole: '#ff5252',    // Coral / Salmon red for static poles
  dynamic_vehicle: '#facc15',// Bright vibrant yellow for dynamic vehicles
  dynamic_human: '#f97316',  // Vivid orange for human / pedestrians
  unclassified: '#64748b',   // Slate gray for unclassified / unknown
  pothole: '#c084fc',        // Purple / Magenta for pothole terrain anomalies
  curb: '#00f2fe',           // Cyan for curb detections
  building_hatch: '#2a374a', // Dark blue-gray for building footprints
};

export const UI_THEME = {
  bg_dark: '#06090e',
  bg_card: '#0a1018',
  bg_card_inner: '#0d1622',
  border_dark: '#142232',
  border_accent: '#00f2fe',
  border_accent_subtle: 'rgba(0, 242, 254, 0.25)',
  text_primary: '#ffffff',
  text_secondary: '#8e9eab',
  text_muted: '#52667a',
  cyan_primary: '#00f2fe',
  cyan_glow: 'rgba(0, 242, 254, 0.4)',
  green_online: '#10b981',
};

export const FOVEATED_RANGES = [
  { range: '0 - 10 m', cellSize: '5 cm', maxDist: 10, sizeM: 0.05 },
  { range: '10 - 30 m', cellSize: '15 cm', maxDist: 30, sizeM: 0.15 },
  { range: '30 - 60 m', cellSize: '30 cm', maxDist: 60, sizeM: 0.30 },
  { range: '60 - 120 m', cellSize: '50 cm', maxDist: 120, sizeM: 0.50 }
];

export const ELEVATION_GRADIENT = [
  { stop: 0.0, color: '#00f2fe', label: '-0.5 m', height: -0.5 },
  { stop: 0.25, color: '#00e676', label: '0 m', height: 0.0 },
  { stop: 0.50, color: '#facc15', label: '0.5 m', height: 0.5 },
  { stop: 0.75, color: '#f97316', label: '1.0 m', height: 1.0 },
  { stop: 1.0, color: '#c084fc', label: '1.5 m', height: 1.5 }
];
