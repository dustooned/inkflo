/**
 * The painted flat around a tap: pixels joined to it whose colour is close to the tapped pixel's
 * and that are not clear. Pure (RGBA in, mask out), so the Tone Bucket's Fill source is testable.
 */

export interface AreaMask {
  mask: Uint8Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
}

/** `tolerance` is the largest sum of per-channel differences (0-765) still counted as the same flat. */
export function flatAround(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, x: number, y: number, tolerance = 48): AreaMask | null {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const at = (i: number) => rgba[i * 4 + 3]!;
  const start = y * w + x;
  if (at(start) < 128) return null;
  const sr = rgba[start * 4]!, sg = rgba[start * 4 + 1]!, sb = rgba[start * 4 + 2]!;
  const mask = new Uint8Array(w * h);
  const near = (i: number) => at(i) >= 128 && Math.abs(rgba[i * 4]! - sr) + Math.abs(rgba[i * 4 + 1]! - sg) + Math.abs(rgba[i * 4 + 2]! - sb) <= tolerance;
  const stack = [start];
  mask[start] = 1;
  let x0 = x, x1 = x, y0 = y, y1 = y, count = 0;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    const px = i % w;
    const py = (i - px) / w;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    const visit = (j: number) => { if (!mask[j] && near(j)) { mask[j] = 1; stack.push(j); } };
    if (px > 0) visit(i - 1);
    if (px < w - 1) visit(i + 1);
    if (py > 0) visit(i - w);
    if (py < h - 1) visit(i + w);
  }
  return { mask, x0, y0, x1, y1, count };
}
