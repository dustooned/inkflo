// Vendored from 2Dope src/fill/gradient.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/** A gradient fill: from (x0, y0) to (x1, y1) in document pixels; radial = centre to edge. */
export interface Grad {
  kind: 'linear' | 'radial';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a point sits along a gradient, 0 (first colour) .. 1 (second colour), clamped. */
export function gradientAt(g: Grad, x: number, y: number): number {
  const dx = g.x1 - g.x0, dy = g.y1 - g.y0;
  if (g.kind === 'radial') {
    const r = Math.hypot(dx, dy) || 1;
    return Math.min(1, Math.hypot(x - g.x0, y - g.y0) / r);
  }
  const len2 = dx * dx + dy * dy || 1;
  return Math.min(1, Math.max(0, ((x - g.x0) * dx + (y - g.y0) * dy) / len2));
}
