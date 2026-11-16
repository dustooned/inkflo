import type { Pt } from '../doc/model';
import type { CaptionTail } from '../engine/lettering/spec';

/**
 * Tail curves for the Caption desk (2Dope's controls): each tail has a tip that aims it and a
 * bend point that curves it. Pure, in page points.
 */

/** Where a tail leaves the balloon: the outline point most in line with the tip, seen from the centre. */
export function tailBase(outline: readonly Pt[], centre: Pt, tip: Pt): Pt {
  const dx = tip.x - centre.x, dy = tip.y - centre.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let best = outline[0] ?? centre, score = -Infinity;
  for (const p of outline) {
    const vx = p.x - centre.x, vy = p.y - centre.y, d = Math.hypot(vx, vy) || 1;
    const s = (vx * ux + vy * uy) / d; // cosine to the tip direction
    if (s > score) { score = s; best = p; }
  }
  return best;
}

/** The curve handle: the stored bend, or halfway along a straight tail. */
export function bendHandle(base: Pt, tail: Pick<CaptionTail, 'x' | 'y' | 'bend'>): Pt {
  return tail.bend ? { x: tail.bend[0], y: tail.bend[1] } : { x: (base.x + tail.x) / 2, y: (base.y + tail.y) / 2 };
}

/** Which way a tail curves, seen from the balloon looking at the tip: −1 left, 0 straight, 1 right. */
export function curveSide(base: Pt, tail: Pick<CaptionTail, 'x' | 'y' | 'bend'>): -1 | 0 | 1 {
  if (!tail.bend) return 0;
  const cross = (tail.x - base.x) * (tail.bend[1] - base.y) - (tail.y - base.y) * (tail.bend[0] - base.x);
  const len = Math.hypot(tail.x - base.x, tail.y - base.y) || 1;
  if (Math.abs(cross) / len < len * 0.04) return 0;
  return cross > 0 ? 1 : -1;
}

/** A tail curved to one side (by `amount` of its length), or straightened (side 0). */
export function curveTail<T extends CaptionTail>(base: Pt, tail: T, side: -1 | 0 | 1, amount = 0.28): T {
  if (!side) { const { bend: _b, ...rest } = tail; return rest as T; }
  const dx = tail.x - base.x, dy = tail.y - base.y, len = Math.hypot(dx, dy) || 1;
  // perpendicular, pointing right of the direction balloon → tip (page y runs down)
  const px = -dy / len, py = dx / len;
  const mid = { x: (base.x + tail.x) / 2, y: (base.y + tail.y) / 2 };
  return { ...tail, bend: [mid.x + px * len * amount * side, mid.y + py * len * amount * side] };
}

/** Move a tail's tip: its bend follows half way, so the curve keeps its shape (as in 2Dope). */
export function moveTip<T extends CaptionTail>(tail: T, dx: number, dy: number): T {
  return { ...tail, x: tail.x + dx, y: tail.y + dy, ...(tail.bend ? { bend: [tail.bend[0] + dx / 2, tail.bend[1] + dy / 2] as [number, number] } : {}) };
}

/** The balloon moved while its tips stay on the speakers: each bend follows half way. */
export function followBody<T extends CaptionTail>(tail: T, dx: number, dy: number): T {
  return tail.bend ? { ...tail, bend: [tail.bend[0] + dx / 2, tail.bend[1] + dy / 2] } : tail;
}
