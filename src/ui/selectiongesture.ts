import type { Pt } from '../doc/model';
import { IDENTITY, type XParams } from '../engine/core/selxform';
import { boxHandles as sideHandles, resizeBox, type Bounds, type ResizeSide } from '../geom/resizebox';
import { boxCorners, boxFrame, boxHandles, boxPoint, rotateKnob, type OBox } from '../geom/xformbox';

export type SelectionGrab = { kind: 'move' | 'rotate' } | { kind: 'resize'; side: ResizeSide };
export const selectionCenter = (b: Bounds): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
export const selectionCorners = (a: Pt, b: Pt): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
/** A small mark still needs room between the centre and corner handles on a touch screen. */
export function selectionFrame(b: Bounds, scale: number): Bounds {
  const x = Math.max(0, 28 / scale - (b.x1 - b.x0)) / 2;
  const y = Math.max(0, 28 / scale - (b.y1 - b.y0)) / 2;
  return { x0: b.x0 - x, y0: b.y0 - y, x1: b.x1 + x, y1: b.y1 + y };
}
const rotationAt = (b: Bounds, scale: number) => ({ x: (b.x0 + b.x1) / 2, y: b.y0 - 23 / scale });
const handles = (b: Bounds, scale: number) => sideHandles(b).filter((h) => h.x && h.y || ((b.x1 - b.x0) * scale > 34 && (b.y1 - b.y0) * scale > 34));

export function grabSelection(b: Bounds, p: Pt, scale: number, touch: boolean, rotation = true, reachPx = touch ? 13 : 8): SelectionGrab | null {
  const reach = reachPx / scale;
  const distance = (q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
  if (rotation && distance(rotationAt(b, scale)) <= reach) return { kind: 'rotate' };
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
export function drawSelectionFrame(g: CanvasRenderingContext2D, b: Bounds, scale: number, angle?: number, rotation = true, radius = 4, screenScale = scale): void {
  g.strokeRect(b.x0 * scale, b.y0 * scale, (b.x1 - b.x0) * scale, (b.y1 - b.y0) * scale);
  g.setLineDash([]);
  g.fillStyle = '#FFFDF7';
  const rotate = rotationAt(b, screenScale);
  if (rotation) {
    g.beginPath(); g.moveTo(rotate.x * scale, b.y0 * scale); g.lineTo(rotate.x * scale, rotate.y * scale); g.stroke();
  }
  const points = handles(b, screenScale).map((h) => h.at);
  if (rotation) points.push(rotate);
  for (const q of points) {
    g.beginPath(); g.arc(q.x * scale, q.y * scale, radius, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (angle !== undefined) g.fillText(`${Math.round(angle)}°`, rotate.x * scale + 10, rotate.y * scale);
}

export interface TransformBoxStyle {
  /** Pixels per document unit as drawn (the canvas scale). */
  scale: number;
  /** Extra zoom from a moved panel's placement: drawn sizes divide by it so handles keep their screen size. */
  k?: number;
  rotation?: boolean;
  pivot?: Pt | null;
  /** A short label that follows the gesture ("32°", "120%"), drawn at `at`. */
  readout?: { text: string; at: Pt } | null;
  /** Snap guides to draw, in document units. */
  guides?: { x?: number; y?: number } | null;
  extent?: { w: number; h: number };
}

const ACCENT = '#2F7FD8';

/** The Procreate-style box: it turns with the art, with corner and side handles and a rotate knob on a stem. */
export function drawTransformBox(g: CanvasRenderingContext2D, box: OBox, o: TransformBoxStyle): void {
  const { scale } = o, k = o.k ?? 1;
  const frame = boxFrame(box, scale * k);
  const px = (n: number) => n / k;
  const at = (p: Pt): [number, number] => [p.x * scale, p.y * scale];
  g.save();
  g.setLineDash([]);
  g.strokeStyle = ACCENT;
  if (o.guides && o.extent) {
    g.save();
    g.strokeStyle = '#E0457B'; g.lineWidth = px(1); g.setLineDash([px(4), px(3)]);
    const big = 1e4;
    if (o.guides.x !== undefined) { g.beginPath(); g.moveTo(o.guides.x * scale, -big); g.lineTo(o.guides.x * scale, big); g.stroke(); }
    if (o.guides.y !== undefined) { g.beginPath(); g.moveTo(-big, o.guides.y * scale); g.lineTo(big, o.guides.y * scale); g.stroke(); }
    g.restore();
  }
  // outline
  g.lineWidth = px(1.5);
  g.beginPath();
  boxCorners(frame).forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))));
  g.closePath();
  g.stroke();
  // knob on a stem from the top edge
  const knob = rotateKnob(frame, scale * k);
  if (o.rotation !== false) {
    g.beginPath(); g.moveTo(...at(boxPoint(frame, 0, -frame.h / 2))); g.lineTo(...at(knob)); g.stroke();
  }
  g.fillStyle = '#FFFDF7';
  const dot = (p: Pt, r: number) => { g.beginPath(); g.arc(...at(p), px(r), 0, Math.PI * 2); g.fill(); g.stroke(); };
  for (const handle of boxHandles(frame, scale * k)) dot(handle.at, handle.sx && handle.sy ? 5.5 : 4);
  if (o.rotation !== false) dot(knob, 5);
  if (o.pivot) {
    const [x, y] = at(o.pivot), r = px(7);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - r * 1.5, y); g.lineTo(x + r * 1.5, y); g.moveTo(x, y - r * 1.5); g.lineTo(x, y + r * 1.5); g.stroke();
  }
  if (o.readout) {
    const [x, y] = at(o.readout.at);
    g.font = `600 ${px(12)}px system-ui, sans-serif`;
    const w = g.measureText(o.readout.text).width + px(14), h = px(22);
    g.fillStyle = 'rgba(27,31,38,.9)';
    g.beginPath(); g.roundRect(x + px(12), y - px(30), w, h, px(11)); g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(o.readout.text, x + px(19), y - px(30) + h / 2);
  }
  g.restore();
}
