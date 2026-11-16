import type { Pt, Stroke } from '../doc/model';
import { pointInPoly } from './carve';

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (u: Pt, v: Pt, w: Pt) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  return Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y) &&
    side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0;
}

export function outlinesOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  return pointInPoly(a[0]!, b) || pointInPoly(b[0]!, a) ||
    a.some((p, i) => b.some((q, j) => crosses(p, a[(i + 1) % a.length]!, q, b[(j + 1) % b.length]!)));
}

function distanceSquared(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2;
}

/** A lasso can touch the painted edge of a line without crossing its centreline. */
export function strokeTouchesOutline(stroke: Stroke, outline: readonly Pt[]): boolean {
  const radiusAt = (i: number) => stroke.w * (stroke.pw?.[i] ?? 1) / 2;
  return stroke.pts.some((p, i) => {
    if (pointInPoly(p, outline)) return true;
    const j = Math.max(0, i - 1);
    const prev = stroke.pts[j]!;
    const radius = Math.max(radiusAt(i), radiusAt(j));
    const rr = radius ** 2;
    return outline.some((a, k) => {
      const b = outline[(k + 1) % outline.length]!;
      if (Math.max(p.x, prev.x) + radius < Math.min(a.x, b.x) || Math.min(p.x, prev.x) - radius > Math.max(a.x, b.x) ||
          Math.max(p.y, prev.y) + radius < Math.min(a.y, b.y) || Math.min(p.y, prev.y) - radius > Math.max(a.y, b.y)) return false;
      return crosses(prev, p, a, b) || distanceSquared(p, a, b) <= rr || distanceSquared(prev, a, b) <= rr ||
        distanceSquared(a, prev, p) <= rr || distanceSquared(b, prev, p) <= rr;
    });
  });
}
