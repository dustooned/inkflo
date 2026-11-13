import type { Pt } from '../doc/model';
import { applyPoint, invert, type Mat } from '../engine/core/selxform';

/**
 * Where a layer's art is shown on the page. A moved, rotated or scaled panel keeps its pixels and
 * strokes in the original (source) position and draws them through `m`. Tools hit-test and edit
 * in source space, so they map the pointer through `inv` first.
 */
export interface Placement {
  m: Mat;
  inv: Mat;
  /** Linear scale of `m` (1 for moves and rotations). */
  k: number;
}

export function placementOf(m: Mat | null | undefined): Placement | null {
  if (!m) return null;
  const inv = invert(m);
  if (!inv) return null;
  return { m, inv, k: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1 };
}

/** Page point → the layer's source space. */
export function toSource(pl: Placement | null, p: Pt): Pt {
  if (!pl) return p;
  const [x, y] = applyPoint(pl.inv, p.x, p.y);
  return { x, y };
}

/** Draw in source space on an overlay whose units are page inches × `scale` pixels. */
export function withPlacement(g: CanvasRenderingContext2D, pl: Placement | null, scale: number, draw: (scale: number, k: number) => void): void {
  g.save();
  if (pl) {
    const [a, b, c, d, e, f] = pl.m;
    g.transform(a, b, c, d, e * scale, f * scale);
    g.lineWidth /= pl.k;
  }
  draw(scale, pl?.k ?? 1);
  g.restore();
}
