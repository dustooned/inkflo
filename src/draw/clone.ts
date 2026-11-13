import type { CloneStroke } from '../doc/model';
import { clipRect, unionRect, type Rect } from '../engine/core/selxform';

type Sample = CloneStroke['points'][number];

/** Copy from a fixed layer snapshot so a stroke cannot recursively copy itself. */
export function cloneSegment(g: CanvasRenderingContext2D, source: CanvasRenderingContext2D, a: Sample, b: Sample, edit: CloneStroke, dpi: number): Rect | null {
  const radius = Math.max(1, edit.size * dpi / 2);
  const dx = (b.x - a.x) * dpi, dy = (b.y - a.y) * dpi;
  const count = Math.max(1, Math.min(2048, Math.ceil(Math.hypot(dx, dy) / Math.max(1, radius * 0.24))));
  const sx = Math.round(edit.offset.x * dpi), sy = Math.round(edit.offset.y * dpi);
  let dirty: Rect | null = null;
  for (let step = 1; step <= count; step++) {
    const t = step / count;
    const cx = a.x * dpi + dx * t, cy = a.y * dpi + dy * t;
    const rect = clipRect(Math.floor(cx - radius), Math.floor(cy - radius), Math.ceil(cx + radius), Math.ceil(cy + radius), g.canvas.width, g.canvas.height);
    if (!rect) continue;
    const { x, y, w, h } = rect;
    const patch = source.getImageData(x + sx, y + sy, w, h);
    const dest = g.getImageData(x, y, w, h);
    const power = edit.strength * (a.pressure + (b.pressure - a.pressure) * t);
    let touched = false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      const r = Math.hypot(x + i + 0.5 - cx, y + j + 0.5 - cy) / radius;
      if (r >= 1 || !patch.data[k + 3]) continue;
      const take = patch.data[k + 3]! * power * Math.min(1, (1 - r) * 3);
      const keep = dest.data[k + 3]! * (1 - take / 255);
      const alpha = take + keep;
      if (!take || !alpha) continue;
      for (let c = 0; c < 3; c++) dest.data[k + c] = (patch.data[k + c]! * take + dest.data[k + c]! * keep) / alpha;
      dest.data[k + 3] = alpha;
      touched = true;
    }
    if (touched) { g.putImageData(dest, x, y); dirty = unionRect(dirty, rect); }
  }
  return dirty;
}
