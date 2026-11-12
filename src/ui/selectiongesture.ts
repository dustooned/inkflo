import type { Pt } from '../doc/model';
import { IDENTITY, type XParams } from '../engine/core/selxform';
import { boxHandles, resizeBox, type Bounds, type ResizeSide } from '../geom/resizebox';

export type SelectionGrab = { kind: 'move' | 'rotate' } | { kind: 'resize'; side: ResizeSide };
export const selectionCenter = (b: Bounds): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
export const selectionCorners = (a: Pt, b: Pt): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
const rotationAt = (b: Bounds, scale: number) => ({ x: (b.x0 + b.x1) / 2, y: b.y0 - 23 / scale });
const handles = (b: Bounds, scale: number) => boxHandles(b).filter((h) => h.x && h.y || ((b.x1 - b.x0) * scale > 34 && (b.y1 - b.y0) * scale > 34));

export function grabSelection(b: Bounds, p: Pt, scale: number, touch: boolean): SelectionGrab | null {
  const reach = (touch ? 13 : 8) / scale;
  const distance = (q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
  if (distance(rotationAt(b, scale)) <= reach) return { kind: 'rotate' };
  const handle = handles(b, scale).sort((a, b) => distance(a.at) - distance(b.at))[0]!;
  if (distance(handle.at) <= reach) return { kind: 'resize', side: handle };
  if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return { kind: 'move' };
  return null;
}

export function selectionTransform(grab: SelectionGrab, b: Bounds, from: Pt, to: Pt, e: Pick<PointerEvent, 'shiftKey' | 'altKey'>, minSize = 0.005): XParams {
  const delta = { x: to.x - from.x, y: to.y - from.y };
  if (grab.kind === 'move') return { ...IDENTITY,
    dx: e.shiftKey && Math.abs(delta.y) > Math.abs(delta.x) ? 0 : delta.x,
    dy: e.shiftKey && Math.abs(delta.x) >= Math.abs(delta.y) ? 0 : delta.y,
  };
  if (grab.kind === 'rotate') {
    const c = selectionCenter(b);
    const angle = (q: Pt) => Math.atan2(q.y - c.y, q.x - c.x);
    const turn = (angle(to) - angle(from)) * 180 / Math.PI;
    return { ...IDENTITY, rotate: e.shiftKey ? Math.round(turn / 15) * 15 : turn };
  }
  if (grab.kind === 'resize') {
    const resize = resizeBox(b, grab.side, delta, { x: minSize, y: minSize }, e.altKey, e.shiftKey);
    return { ...IDENTITY, dx: resize.shift.x, dy: resize.shift.y, sx: resize.width / (b.x1 - b.x0), sy: resize.height / (b.y1 - b.y0) };
  }
  return { ...IDENTITY };
}

export function drawSelectionPath(g: CanvasRenderingContext2D, path: Pt[], scale: number): void {
  g.beginPath();
  path.forEach((p, i) => i ? g.lineTo(p.x * scale, p.y * scale) : g.moveTo(p.x * scale, p.y * scale));
  g.closePath();
  g.stroke();
}

/** The shared on-canvas controls for paint and line selection. */
export function drawSelectionFrame(g: CanvasRenderingContext2D, b: Bounds, scale: number, angle?: number): void {
  g.strokeRect(b.x0 * scale, b.y0 * scale, (b.x1 - b.x0) * scale, (b.y1 - b.y0) * scale);
  g.setLineDash([]);
  g.fillStyle = '#FFFDF7';
  const rotate = rotationAt(b, scale);
  g.beginPath(); g.moveTo(rotate.x * scale, b.y0 * scale); g.lineTo(rotate.x * scale, rotate.y * scale); g.stroke();
  for (const q of [...handles(b, scale).map((h) => h.at), rotate]) {
    g.beginPath(); g.arc(q.x * scale, q.y * scale, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (angle !== undefined) g.fillText(`${Math.round(angle)}°`, rotate.x * scale + 10, rotate.y * scale);
}
