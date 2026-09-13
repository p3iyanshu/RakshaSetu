// Same radial resolution bands as shared/schemas.py RING_BOUNDARIES and the
// backend's mock_generator.py -- keep this the one place the frontend reads
// ring geometry from.
export const RING_BOUNDARIES = [
  { ring: 0, lo: 0, hi: 10, cellSize: 0.05 },
  { ring: 1, lo: 10, hi: 30, cellSize: 0.15 },
  { ring: 2, lo: 30, hi: 60, cellSize: 0.3 },
  { ring: 3, lo: 60, hi: 100, cellSize: 0.5 },
];

export const BINS_PER_RING = 36;
export const DEGREES_PER_BIN = 10;
export const MAX_RANGE_M = 100;
