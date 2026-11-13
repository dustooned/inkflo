import type { Pt, SmudgeStroke } from '../doc/model';
import { clipRect, unionRect, type Rect } from '../engine/core/selxform';

type Sample = Pt & { pressure: number };
type Settings = Pick<SmudgeStroke, 'size' | 'strength'>;

/** Mix in premultiplied space so dragging over transparency keeps the pigment's colour. */
export function mixSmudgePixel(out: Uint8ClampedArray, at: number, source: Uint8ClampedArray, from: number, weight: number): void {
  const take = source[from + 3]! * weight;
  const keep = out[at + 3]! * (1 - weight);
  const alpha = take + keep;
  if (alpha < 0.5) { out.fill(0, at, at + 4); return; }
  for (let c = 0; c < 3; c++) out[at + c] = (source[from + c]! * take + out[at + c]! * keep) / alpha;
  out[at + 3] = alpha;
}

/** Pull the previous footprint into the next footprint, with a soft falloff. */
export function smudgeSegment(g: CanvasRenderingContext2D, a: Sample, b: Sample, settings: Settings, dpi: number): Rect | null {
  const radius = Math.max(1, settings.size * dpi / 2);
  const dx = (b.x - a.x) * dpi, dy = (b.y - a.y) * dpi;
  const distance = Math.hypot(dx, dy);
  if (!distance || !settings.strength || !Number.isFinite(distance)) return null;
  const { width, height } = g.canvas;
  const x0 = a.x * dpi, y0 = a.y * dpi;
  // Skip long off-canvas portions before placing samples.
  const count = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.26)));
  const range = (start: number, delta: number, end: number) => {
    const lo = (-radius - start) / delta, hi = (end + radius - start) / delta;
    return delta ? [Math.min(lo, hi), Math.max(lo, hi)] : start >= -radius && start <= end + radius ? [0, 1] : [1, 0];
  };
  const [left, right] = range(x0, dx, width), [top, bottom] = range(y0, dy, height);
  const first = Math.max(1, Math.ceil(Math.max(left!, top!) * count));
  const last = Math.min(count, Math.floor(Math.min(right!, bottom!) * count));
  let dirty: Rect | null = null;
  const sx = dx / count, sy = dy / count;
  const ox = Math.round(sx), oy = Math.round(sy);
  if (!ox && !oy) return null;
  const reach = Math.min(1, Math.hypot(sx, sy) / Math.max(1, radius * 0.26));
  for (let i = first; i <= last; i++) {
    const t = i / count;
    const cx = x0 + dx * t, cy = y0 + dy * t;
    const weight = settings.strength * (a.pressure + (b.pressure - a.pressure) * t) * reach;
    if (weight <= 0) continue;
    const box = clipRect(Math.floor(cx - radius), Math.floor(cy - radius), Math.ceil(cx + radius), Math.ceil(cy + radius), width, height);
    if (!box) continue;
    const { x, y, w, h } = box;
    const previous = g.getImageData(x - ox, y - oy, w, h);
    const next = g.getImageData(x, y, w, h);
    const inputPixels = new Uint32Array(previous.data.buffer);
    const outputPixels = new Uint32Array(next.data.buffer);
    let changed = false;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const r2 = ((x + col + 0.5 - cx) ** 2 + (y + row + 0.5 - cy) ** 2) / (radius * radius);
        const index = row * w + col;
        const old = outputPixels[index];
        if (r2 >= 1 || old === inputPixels[index]) continue;
        mixSmudgePixel(next.data, index * 4, previous.data, index * 4, weight * (1 - r2) ** 2);
        changed ||= old !== outputPixels[index];
      }
    }
    if (!changed) continue;
    g.putImageData(next, x, y);
    dirty = unionRect(dirty, box);
  }
  return dirty;
}
