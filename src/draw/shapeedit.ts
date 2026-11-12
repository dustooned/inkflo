import type { Pt } from '../doc/model';
import { constrainShape, sampleProfile, shapeOutline, type Shape } from '../engine/core/quickshape';
import type { StrokePoint } from '../engine/core/stroke';
import { resizeBox, type ResizeSide } from '../geom/resizebox';

export type EditableShape = Extract<Shape, { kind: 'line' | 'ellipse' | 'rect' }>;
export type ShapeGrab = { kind: 'move' } | { kind: 'end'; end: 'a' | 'b' } | { kind: 'size'; side: ResizeSide };

export function editableShape(s: Shape): s is EditableShape {
  return s.kind === 'line' || s.kind === 'ellipse' || s.kind === 'rect';
}

export function shapeStrokePoints(s: Shape, pressure: number[], dpi: number, start = 0): StrokePoint[] {
  const outline = shapeOutline(s, Math.max(1, dpi / 150));
  return outline.map((p, i) => ({ ...p, pressure: sampleProfile(pressure, i / Math.max(1, outline.length - 1)), tiltX: 0, tiltY: 0, t: start + i * 4 }));
}

function turn(p: Pt, angle: number): Pt {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

const rectCorners: ResizeSide[] = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
const ellipseSides: ResizeSide[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];

export function shapeHandles(s: EditableShape): { at: Pt; grab: ShapeGrab }[] {
  if (s.kind === 'line') return [
    { at: s.a, grab: { kind: 'end', end: 'a' } },
    { at: s.b, grab: { kind: 'end', end: 'b' } },
    { at: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, grab: { kind: 'move' } },
  ];
  const w = s.kind === 'rect' ? s.w : s.rx;
  const h = s.kind === 'rect' ? s.h : s.ry;
  const edges = (s.kind === 'rect' ? rectCorners : ellipseSides).map((side) => {
    const p = turn({ x: w * side.x, y: h * side.y }, s.rot);
    return { at: { x: s.cx + p.x, y: s.cy + p.y }, grab: { kind: 'size', side } as const };
  });
  return [...edges, { at: { x: s.cx, y: s.cy }, grab: { kind: 'move' } }];
}

export function adjustShapeHandle(s: EditableShape, grab: ShapeGrab, delta: Pt, constrain: boolean): EditableShape {
  const shift = (p: Pt): Pt => ({ x: p.x + delta.x, y: p.y + delta.y });
  if (s.kind === 'line') {
    if (grab.kind !== 'end') return { ...s, a: shift(s.a), b: shift(s.b) };
    const anchor = grab.end === 'a' ? s.b : s.a;
    const p = shift(s[grab.end]);
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) < 2) return s;
    const line: Extract<Shape, { kind: 'line' }> = { kind: 'line', a: anchor, b: p };
    const end = constrain ? (constrainShape(line) as typeof line).b : p;
    return { ...s, [grab.end]: end };
  }
  if (grab.kind !== 'size') return { ...s, cx: s.cx + delta.x, cy: s.cy + delta.y };
  const w = s.kind === 'rect' ? s.w : s.rx;
  const h = s.kind === 'rect' ? s.h : s.ry;
  const next = resizeBox({ x0: -w, y0: -h, x1: w, y1: h }, grab.side, turn(delta, -s.rot), { x: 2, y: 2 }, false, constrain);
  const d = turn(next.shift, s.rot);
  const center = { cx: s.cx + d.x, cy: s.cy + d.y };
  return s.kind === 'rect' ? { ...s, ...center, w: next.width / 2, h: next.height / 2 }
    : { ...s, ...center, rx: next.width / 2, ry: next.height / 2 };
}
