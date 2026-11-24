import type { LiquifyStroke, Pt } from '../doc/model';
import { clipRect, unionRect, type Rect } from '../engine/core/selxform';

type Sample = Pt & { pressure: number };
type Settings = Pick<LiquifyStroke, 'size' | 'strength' | 'mode'>;

/** Twirl turns by this much at full strength and centre, per dab; Pinch and Bloat scale by this fraction. */
const TWIRL = 0.32;
const SQUEEZE = 0.22;

/**
 * Premultiplied bilinear sample of straight-alpha RGBA at (x, y) in the buffer's own pixel centres,
 * clamped at the edges, written to `out[at…at+3]`.
 */
function sampleInto(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Uint8ClampedArray, at: number): void {
  const u = Math.min(Math.max(x - 0.5, 0), w - 1), v = Math.min(Math.max(y - 0.5, 0), h - 1);
  const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = u - x0, fy = v - y0;
  const wt = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const idx = [(y0 * w + x0) * 4, (y0 * w + x1) * 4, (y1 * w + x0) * 4, (y1 * w + x1) * 4];
  let r = 0, g = 0, b = 0, a = 0;
  for (let k = 0; k < 4; k++) {
    const al = src[idx[k]! + 3]! * wt[k]!;
    a += al;
    r += src[idx[k]!]! * al; g += src[idx[k]! + 1]! * al; b += src[idx[k]! + 2]! * al;
  }
  if (a < 0.5) { out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 0; return; }
  out[at] = r / a; out[at + 1] = g / a; out[at + 2] = b / a; out[at + 3] = a;
}

/**
 * Liquify along a stroke segment: at each dab, pixels inside the brush are re-read from somewhere nearby
 * (pushed along the stroke, turned, drawn inward or pushed outward), with a soft falloff. Pure in the
 * pixels and the points, so the live preview and a replay from a saved file agree exactly.
 */
export function liquifySegment(g: CanvasRenderingContext2D, a: Sample, b: Sample, settings: Settings, dpi: number): Rect | null {
  const radius = Math.max(1, settings.size * dpi / 2);
  const dx = (b.x - a.x) * dpi, dy = (b.y - a.y) * dpi;
  const distance = Math.hypot(dx, dy);
  if (!distance || !settings.strength || !Number.isFinite(distance)) return null;
  const { width, height } = g.canvas;
  const count = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.2)));
  const sx = dx / count, sy = dy / count;
  const pad = Math.ceil(radius * SQUEEZE + Math.hypot(sx, sy) + 2);
  let dirty: Rect | null = null;
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const cx = a.x * dpi + dx * t, cy = a.y * dpi + dy * t;
    const weight = settings.strength * (a.pressure + (b.pressure - a.pressure) * t);
    if (weight <= 0) continue;
    const box = clipRect(Math.floor(cx - radius), Math.floor(cy - radius), Math.ceil(cx + radius), Math.ceil(cy + radius), width, height);
    const read = clipRect(Math.floor(cx - radius) - pad, Math.floor(cy - radius) - pad, Math.ceil(cx + radius) + pad, Math.ceil(cy + radius) + pad, width, height);
    if (!box || !read) continue;
    const src = g.getImageData(read.x, read.y, read.w, read.h);
    const out = g.getImageData(box.x, box.y, box.w, box.h);
    for (let row = 0; row < box.h; row++) {
      for (let col = 0; col < box.w; col++) {
        const px = box.x + col + 0.5, py = box.y + row + 0.5;
        const ox = px - cx, oy = py - cy;
        const r2 = (ox * ox + oy * oy) / (radius * radius);
        if (r2 >= 1) continue;
        const f = (1 - r2) ** 2 * weight;
        let qx: number, qy: number;
        if (settings.mode === 'push') { qx = px - sx * f; qy = py - sy * f; }
        else if (settings.mode === 'twirl') {
          const ang = -f * TWIRL, c = Math.cos(ang), s = Math.sin(ang);
          qx = cx + c * ox - s * oy; qy = cy + s * ox + c * oy;
        } else {
          const k = settings.mode === 'pinch' ? 1 + f * SQUEEZE : 1 - f * SQUEEZE;
          qx = cx + ox * k; qy = cy + oy * k;
        }
        sampleInto(src.data, read.w, read.h, qx - read.x, qy - read.y, out.data, (row * box.w + col) * 4);
      }
    }
    g.putImageData(out, box.x, box.y);
    dirty = unionRect(dirty, box);
  }
  return dirty;
}
