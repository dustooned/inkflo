import type { Pt } from '../doc/model';

/**
 * Knife angles, as a reader sees them: 0° is level, 90° is upright, measured anticlockwise on the
 * page (y grows downward, so it is flipped). A cut has no direction, so angles fold into 0–180°.
 */
export function cutAngle(a: Pt, b: Pt): number {
  const deg = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
  return ((deg % 180) + 180) % 180;
}

/** Angles a straight cut clicks to without Shift: level, upright, and the two diagonals. */
const MAGNETS = [0, 45, 90, 135, 180];

/**
 * Snap the end of a straight cut. Within `magnet` degrees of level, upright or diagonal it clicks
 * there; with `step` (Shift) it moves in that many degrees. Length is kept.
 */
export function snapCutEnd(a: Pt, b: Pt, step = 0, magnet = 3): { end: Pt; angle: number; snapped: boolean } {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const raw = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
  let target: number | null = null;
  if (step > 0) target = Math.round(raw / step) * step;
  else {
    const folded = ((raw % 180) + 180) % 180;
    const near = MAGNETS.find((m) => Math.abs(folded - m) <= magnet);
    if (near !== undefined) target = raw + (near - folded);
  }
  if (target === null || len === 0) return { end: b, angle: cutAngle(a, b), snapped: false };
  const r = target * Math.PI / 180;
  const end = { x: a.x + Math.cos(r) * len, y: a.y - Math.sin(r) * len };
  return { end, angle: cutAngle(a, end), snapped: true };
}

/** "37°", with level and upright named, for the on-canvas readout. */
export function angleLabel(angle: number): string {
  const d = Math.round(angle) % 180;
  return d === 0 ? '0° level' : d === 90 ? '90° upright' : d + '°';
}
