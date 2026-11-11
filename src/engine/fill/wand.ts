// Vendored from 2Dope src/fill/wand.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import type { Area } from './fill';

/**
 * Colour selection (a magic wand): the connected pixels whose colour is within `threshold` of the
 * pixel at (sx, sy). `px` is premultiplied-equivalent RGBA from getImageData; empty paper counts as
 * one colour, so a tap on blank paper selects the connected empty area. `threshold` is 0..1: 0
 * takes only the exact colour, 1 everything connected.
 */
export function colorRegion(px: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, threshold: number): Area | null {
  const x = Math.floor(sx), y = Math.floor(sy);
  if (x < 0 || y < 0 || x >= w || y >= h || px.length < w * h * 4) return null;
  const t = Math.round(Math.max(0, Math.min(1, threshold)) * 255);
  const k = (y * w + x) * 4;
  const [r0, g0, b0, a0] = premul(px, k);
  const near = (i: number): boolean => {
    const [r, g, b, a] = premul(px, i * 4);
    return Math.abs(r - r0) <= t && Math.abs(g - g0) <= t && Math.abs(b - b0) <= t && Math.abs(a - a0) <= t;
  };
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  stack[top++] = y * w + x;
  mask[y * w + x] = 1;
  let x0 = x, y0 = y, x1 = x, y1 = y;
  while (top > 0) {
    const i = stack[--top]!;
    const cx = i % w, cy = (i - cx) / w;
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
    if (cx > 0 && !mask[i - 1] && near(i - 1)) { mask[i - 1] = 1; stack[top++] = i - 1; }
    if (cx < w - 1 && !mask[i + 1] && near(i + 1)) { mask[i + 1] = 1; stack[top++] = i + 1; }
    if (cy > 0 && !mask[i - w] && near(i - w)) { mask[i - w] = 1; stack[top++] = i - w; }
    if (cy < h - 1 && !mask[i + w] && near(i + w)) { mask[i + w] = 1; stack[top++] = i + w; }
  }
  return { mask, x0, y0, x1, y1 };
}

/** Colour scaled by its coverage, so faint and empty pixels compare by what you actually see. */
function premul(px: Uint8ClampedArray, k: number): [number, number, number, number] {
  const a = px[k + 3]!;
  return [(px[k]! * a) / 255, (px[k + 1]! * a) / 255, (px[k + 2]! * a) / 255, a];
}
