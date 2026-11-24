import type { Pt, SelectionStep } from '../doc/model';
import { polygonMask } from '../engine/fill/fill';

/** A selection as 0–255 coverage over a whole plane: 0 not selected, 255 fully, between where it is feathered. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

export interface MaskBounds { x0: number; y0: number; x1: number; y1: number }

const blank = (w: number, h: number): Mask => ({ w, h, data: new Uint8Array(w * h) });

export function maskBounds(m: Mask): MaskBounds | null {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) {
    const row = y * m.w;
    for (let x = 0; x < m.w; x++) {
      if (!m.data[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** The pixels inside a polygon given in plane pixels (pixel centres, hard edge). */
export function polygonCoverage(points: readonly (readonly [number, number])[], w: number, h: number): Mask {
  const m = blank(w, h);
  const area = polygonMask(points, w, h);
  if (area) for (let i = 0; i < m.data.length; i++) if (area.mask[i]) m.data[i] = 255;
  return m;
}

/**
 * Pixels like the one at (x, y): every channel within `tolerance` (0–1) of it. Contiguous spreads only
 * through touching pixels (like a paint bucket); otherwise every matching pixel on the plane counts.
 */
export function colourCoverage(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, tolerance: number, contiguous: boolean): Mask {
  const m = blank(w, h);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return m;
  const t = Math.round(Math.min(Math.max(tolerance, 0), 1) * 255);
  const at = (y * w + x) * 4;
  const r = rgba[at]!, g = rgba[at + 1]!, b = rgba[at + 2]!, a = rgba[at + 3]!;
  const like = (i: number) => {
    const o = i * 4;
    // transparent pixels all look alike, whatever colour they hold
    if (a === 0 || rgba[o + 3] === 0) return a === rgba[o + 3];
    return Math.abs(rgba[o]! - r) <= t && Math.abs(rgba[o + 1]! - g) <= t && Math.abs(rgba[o + 2]! - b) <= t && Math.abs(rgba[o + 3]! - a) <= t;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (like(i)) m.data[i] = 255;
    return m;
  }
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop()!, sx0 = stack.pop()!;
    let lx = sx0;
    if (m.data[sy * w + lx] || !like(sy * w + lx)) continue;
    while (lx > 0 && !m.data[sy * w + lx - 1] && like(sy * w + lx - 1)) lx--;
    let up = false, down = false;
    for (let cx = lx; cx < w && !m.data[sy * w + cx] && like(sy * w + cx); cx++) {
      m.data[sy * w + cx] = 255;
      if (sy > 0) {
        const ok = !m.data[(sy - 1) * w + cx] && like((sy - 1) * w + cx);
        if (ok && !up) stack.push(cx, sy - 1);
        up = ok;
      }
      if (sy < h - 1) {
        const ok = !m.data[(sy + 1) * w + cx] && like((sy + 1) * w + cx);
        if (ok && !down) stack.push(cx, sy + 1);
        down = ok;
      }
    }
  }
  return m;
}

/** Combine `shape` into `into`: replace, add (the larger coverage) or subtract (what the shape does not cover). */
export function combine(into: Mask | null, shape: Mask, op: 'replace' | 'add' | 'subtract'): Mask {
  if (op === 'replace' || !into) return op === 'subtract' && !into ? blank(shape.w, shape.h) : shape;
  const out = into;
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = op === 'add' ? Math.max(out.data[i]!, shape.data[i]!) : Math.round(out.data[i]! * (255 - shape.data[i]!) / 255);
  }
  return out;
}

export function invertMask(m: Mask): Mask {
  for (let i = 0; i < m.data.length; i++) m.data[i] = 255 - m.data[i]!;
  return m;
}

/** Soften the edge: three box blurs approximate a Gaussian of roughly `radius` pixels. */
export function featherMask(m: Mask, radius: number): Mask {
  const r = Math.round(radius / 2);
  const b = maskBounds(m);
  if (r < 1 || !b) return m;
  // only the neighbourhood of the selection can change
  const x0 = Math.max(0, b.x0 - 3 * r), y0 = Math.max(0, b.y0 - 3 * r), x1 = Math.min(m.w - 1, b.x1 + 3 * r), y1 = Math.min(m.h - 1, b.y1 + 3 * r);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  let a = new Float32Array(w * h), c = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = m.data[(y + y0) * m.w + x + x0]!;
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w, stride = horizontal ? 1 : w, step = horizontal ? w : 1;
    const norm = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * step;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[base + Math.min(len - 1, Math.max(0, k)) * stride]!;
      for (let k = 0; k < len; k++) {
        dst[base + k * stride] = sum * norm;
        sum += src[base + Math.min(len - 1, k + r + 1) * stride]! - src[base + Math.max(0, k - r) * stride]!;
      }
    }
  };
  for (let i = 0; i < 3; i++) { pass(a, c, true); pass(c, a, false); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.data[(y + y0) * m.w + x + x0] = Math.round(a[y * w + x]!);
  return m;
}

/**
 * Replay a selection recipe into a mask over a `w` × `h` plane. `pixels` supplies the plane's RGBA, and is
 * only called if a colour step needs it. Null when the recipe selects nothing.
 */
export function buildMask(steps: readonly SelectionStep[], w: number, h: number, dpi: number, pixels: () => Uint8ClampedArray): Mask | null {
  let mask: Mask | null = null;
  let rgba: Uint8ClampedArray | null = null;
  for (const step of steps) {
    if (step.op === 'invert') { mask = invertMask(mask ?? blank(w, h)); continue; }
    if (step.op === 'feather') { if (mask) featherMask(mask, step.radius * dpi); continue; }
    const shape = step.shape.kind === 'polygon'
      ? polygonCoverage(step.shape.pts.map((p: Pt) => [p.x * dpi, p.y * dpi] as const), w, h)
      : colourCoverage(rgba ??= pixels(), w, h, step.shape.at.x * dpi, step.shape.at.y * dpi, step.shape.tolerance, step.shape.contiguous);
    mask = combine(mask, shape, step.op);
  }
  return mask && maskBounds(mask) ? mask : null;
}
