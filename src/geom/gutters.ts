import type { Page, Pt } from '../doc/model';
import { gutterPaths, layoutOf } from './carve';

/**
 * The gutter area of a page: a band `gutter` wide along every cut (the same band the renderer
 * paints as gutter paper). Panels tile the page and the bands sit over their shared edges, so
 * "the gutters" is this band set, not "outside the panels". Pure.
 */

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Is `p` (inches) inside a gutter band? */
export function inGutter(page: Page, p: Pt): boolean {
  const half = layoutOf(page).gutter / 2;
  if (half <= 0 || p.x < 0 || p.y < 0 || p.x > page.widthIn || p.y > page.heightIn) return false;
  for (const { points: path } of gutterPaths(page)) {
    for (let i = 1; i < path.length; i++) if (segDist(p, path[i - 1]!, path[i]!) <= half) return true;
  }
  return false;
}

/** The gutter bands as a pixel mask (1 = gutter), w × h at `dpi`. */
export function gutterMask(page: Page, dpi: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const half = layoutOf(page).gutter / 2;
  if (half <= 0) return out;
  for (const { points: path } of gutterPaths(page)) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - half) * dpi));
      const x1 = Math.min(w - 1, Math.ceil((Math.max(a.x, b.x) + half) * dpi));
      const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - half) * dpi));
      const y1 = Math.min(h - 1, Math.ceil((Math.max(a.y, b.y) + half) * dpi));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = y * w + x;
          if (out[k]) continue;
          if (segDist({ x: (x + 0.5) / dpi, y: (y + 0.5) / dpi }, a, b) <= half) out[k] = 1;
        }
      }
    }
  }
  return out;
}
