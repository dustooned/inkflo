// Vendored from 2Dope src/core/selxform.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import type { StrokeRecord } from './stroke';
import { transformVector, vectorSelected } from './vectorstyle';

/**
 * Selection transform (pure maths and pixels, no DOM): move, scale, rotate and flip what is inside a
 * lasso selection. A transform is `dx/dy` (document px), `scale` (1 = same size), `rotate` (degrees)
 * and flips, all about the selection's centre; flips apply first, then scale, then rotate, then move.
 */
export interface XParams {
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  /** Freeform: extra stretch across and down (1 = none), on top of the uniform scale. */
  sx?: number;
  sy?: number;
}

export const IDENTITY: XParams = { dx: 0, dy: 0, scale: 1, rotate: 0, flipH: false, flipV: false };

/** x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = readonly [number, number, number, number, number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Interpolation = 'nearest' | 'bilinear' | 'bicubic';
export type InverseSample = (x: number, y: number) => [number, number] | null;

function cubic(x: number): number {
  const t = Math.abs(x);
  if (t <= 1) return (1.5 * t - 2.5) * t * t + 1;
  return t < 2 ? ((-0.5 * t + 2.5) * t - 4) * t + 2 : 0;
}

export function isIdentity(p: XParams): boolean {
  return p.dx === 0 && p.dy === 0 && p.scale === 1 && p.rotate === 0 && !p.flipH && !p.flipV && (p.sx ?? 1) === 1 && (p.sy ?? 1) === 1;
}

export function matrixFor(p: XParams, cx: number, cy: number): Mat {
  const r = (p.rotate * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const sx = p.scale * (p.sx ?? 1) * (p.flipH ? -1 : 1);
  const sy = p.scale * (p.sy ?? 1) * (p.flipV ? -1 : 1);
  // rotate · scale/flip, about (cx, cy), then move
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a, b, c, d, cx + p.dx - (a * cx + c * cy), cy + p.dy - (b * cx + d * cy)];
}

/** The overall size change (for line widths), counting a freeform stretch. */
export function overallScale(p: XParams): number {
  return p.scale * Math.sqrt(Math.abs((p.sx ?? 1) * (p.sy ?? 1)));
}

export function applyPoint(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** The pixel rectangle (clipped to the plane) that a transformed box can touch, with a 2 px margin. */
export function transformedRect(m: Mat, box: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[box.x0, box.y0], [box.x1 + 1, box.y0], [box.x0, box.y1 + 1], [box.x1 + 1, box.y1 + 1]] as const) {
    const [tx, ty] = applyPoint(m, x, y);
    x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
  }
  return clipRect(Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1) + 2, Math.ceil(y1) + 2, w, h);
}

export function clipRect(x0: number, y0: number, x1: number, y1: number, w: number, h: number): Rect | null {
  const ax = Math.max(0, x0), ay = Math.max(0, y0), bx = Math.min(w, x1), by = Math.min(h, y1);
  return bx > ax && by > ay ? { x: ax, y: ay, w: bx - ax, h: by - ay } : null;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * New pixels for `region` of a plane: the selected pixels are lifted out (their old place is cleared)
 * and drawn back through `m` with bilinear sampling, over whatever stays. `src` is the untouched
 * plane (straight-alpha RGBA, `w` × `h`); the result is `region.w` × `region.h`.
 */
export function transformRegion(
  src: Uint8ClampedArray, w: number, h: number, mask: Uint8Array, m: Mat, region: Rect,
  interpolation: Interpolation = 'bilinear', inverseSample?: InverseSample,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(region.w * region.h * 4);
  const inv = invert(m);
  // the lifted layer, premultiplied, sampled at a source pixel
  const lifted = (px: number, py: number, k: 0 | 1 | 2 | 3): number => {
    if (px < 0 || py < 0 || px >= w || py >= h) return 0;
    const i = py * w + px;
    if (!mask[i]) return 0;
    const o = i * 4;
    const a = src[o + 3]! / 255;
    return k === 3 ? a : (src[o + k]! / 255) * a;
  };
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const gx = region.x + x, gy = region.y + y;
      const si = (gy * w + gx) * 4;
      // what stays: unselected pixels, premultiplied
      let r = 0, g = 0, b = 0, a = 0;
      if (!mask[gy * w + gx]) {
        a = src[si + 3]! / 255;
        r = (src[si]! / 255) * a; g = (src[si + 1]! / 255) * a; b = (src[si + 2]! / 255) * a;
      }
      const point = inverseSample?.(gx + 0.5, gy + 0.5);
      if (inverseSample ? point : inv) {
        // pixel centre -> source position -> the four neighbouring source pixels
        const u = (point?.[0] ?? (inv![0] * (gx + 0.5) + inv![2] * (gy + 0.5) + inv![4])) - 0.5;
        const v = (point?.[1] ?? (inv![1] * (gx + 0.5) + inv![3] * (gy + 0.5) + inv![5])) - 0.5;
        const u0 = Math.floor(u), v0 = Math.floor(v);
        const fu = u - u0, fv = v - v0;
        if (interpolation === 'nearest') {
          const px = Math.round(u), py = Math.round(v), la = lifted(px, py, 3), keep = 1 - la;
          r = lifted(px, py, 0) + r * keep; g = lifted(px, py, 1) + g * keep;
          b = lifted(px, py, 2) + b * keep; a = la + a * keep;
        } else if (interpolation === 'bicubic' && u0 >= -2 && v0 >= -2 && u0 <= w && v0 <= h) {
          let lr = 0, lg = 0, lb = 0, la = 0;
          for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
            const weight = cubic(i - fu) * cubic(j - fv), px = u0 + i, py = v0 + j;
            lr += lifted(px, py, 0) * weight; lg += lifted(px, py, 1) * weight;
            lb += lifted(px, py, 2) * weight; la += lifted(px, py, 3) * weight;
          }
          la = Math.max(0, Math.min(1, la));
          const keep = 1 - la;
          r = Math.max(0, Math.min(la, lr)) + r * keep; g = Math.max(0, Math.min(la, lg)) + g * keep;
          b = Math.max(0, Math.min(la, lb)) + b * keep; a = la + a * keep;
        } else if (u0 >= -1 && v0 >= -1 && u0 < w && v0 < h) {
          const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
          const la = lifted(u0, v0, 3) * w00 + lifted(u0 + 1, v0, 3) * w10 + lifted(u0, v0 + 1, 3) * w01 + lifted(u0 + 1, v0 + 1, 3) * w11;
          if (la > 0) {
            const lr = lifted(u0, v0, 0) * w00 + lifted(u0 + 1, v0, 0) * w10 + lifted(u0, v0 + 1, 0) * w01 + lifted(u0 + 1, v0 + 1, 0) * w11;
            const lg = lifted(u0, v0, 1) * w00 + lifted(u0 + 1, v0, 1) * w10 + lifted(u0, v0 + 1, 1) * w01 + lifted(u0 + 1, v0 + 1, 1) * w11;
            const lb = lifted(u0, v0, 2) * w00 + lifted(u0 + 1, v0, 2) * w10 + lifted(u0, v0 + 1, 2) * w01 + lifted(u0 + 1, v0 + 1, 2) * w11;
            // source-over: the moved art sits on top of what stayed
            const keep = 1 - la;
            r = lr + r * keep; g = lg + g * keep; b = lb + b * keep; a = la + a * keep;
          }
        }
      }
      const o = (y * region.w + x) * 4;
      if (a > 0) {
        out[o] = (r / a) * 255; out[o + 1] = (g / a) * 255; out[o + 2] = (b / a) * 255; out[o + 3] = a * 255;
      }
    }
  }
  return out;
}

/** Vector strokes whose points all lie inside the selection move with it; the rest stay put. */
export function transformVectors(vectors: StrokeRecord[], mask: Uint8Array, w: number, h: number, m: Mat, scale: number): { vectors: StrokeRecord[]; moved: number } {
  let moved = 0;
  const out = vectors.map((v) => {
    if (!vectorSelected(v,mask,w,h)) return v;
    moved++;
    return transformVector(v,m,scale);
  });
  return { vectors: moved ? out : vectors, moved };
}

/** Where a selection mask lands under the transform (keeps an exact selection exact after Apply). */
export function transformMask(mask: Uint8Array, w: number, h: number, m: Mat, region: Rect, inverseSample?: InverseSample): Uint8Array {
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < mask.length; i++) if (mask[i]) src[i * 4 + 3] = 255;
  const moved = transformRegion(src, w, h, mask, m, region, 'bilinear', inverseSample);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < region.h; y++)
    for (let x = 0; x < region.w; x++) if (moved[(y * region.w + x) * 4 + 3]! >= 128) out[(region.y + y) * w + region.x + x] = 1;
  return out;
}
