import type { Pt } from '../doc/model';

export interface Bounds { x0: number; y0: number; x1: number; y1: number }
export interface ResizeSide { x: -1 | 0 | 1; y: -1 | 0 | 1 }

const SIDES: ResizeSide[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 },
  { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 },
];

export function rotateAround(p: Pt, center: Pt, degrees: number): Pt {
  if (!degrees) return p;
  const r = degrees * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const x = p.x - center.x;
  const y = p.y - center.y;
  return { x: center.x + c * x - s * y, y: center.y + s * x + c * y };
}

export function boxHandles(b: Bounds): (ResizeSide & { at: Pt })[] {
  return SIDES.map((side) => ({ ...side, at: {
    x: side.x < 0 ? b.x0 : side.x > 0 ? b.x1 : (b.x0 + b.x1) / 2,
    y: side.y < 0 ? b.y0 : side.y > 0 ? b.y1 : (b.y0 + b.y1) / 2,
  } }));
}

export function resizeBox(b: Bounds, side: ResizeSide, delta: Pt, minimum: Pt, center: boolean, proportional: boolean) {
  const width = b.x1 - b.x0;
  const height = b.y1 - b.y0;
  const mult = center ? 2 : 1;
  let w = Math.max(minimum.x, width + side.x * delta.x * mult);
  let h = Math.max(minimum.y, height + side.y * delta.y * mult);
  if (proportional) {
    const sx = w / width;
    const sy = h / height;
    const dominant = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    const scale = Math.max(dominant, minimum.x / width, minimum.y / height);
    w = width * scale;
    h = height * scale;
  }
  return { width: w, height: h, shift: center ? { x: 0, y: 0 } : { x: side.x * (w - width) / 2, y: side.y * (h - height) / 2 } };
}
