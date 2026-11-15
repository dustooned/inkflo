import { constrainShape, editShape, fitAs, pathLength, pressureProfile, recognizeShape, resample, shapeOutline, simplify, SHAPE_NAMES, type Shape, type ShapeChoice, type V } from '../engine/core/quickshape';

/**
 * QuickShape with smooth curves. 2Dope's QuickShape (vendored, unchanged) knows lines, arcs,
 * polylines, ellipses, rectangles and polygons: an open stroke that bends but isn't a clean arc
 * (an S, a wave, a flowing line) became a polyline of straight segments, which looks blocky.
 * Here such a stroke becomes a **Curve**: a smooth centripetal Catmull–Rom spline through a few
 * points of the stroke. Polyline stays for strokes with real corners. Every other shape is passed
 * to the vendored code as it is.
 */
export type CurveShape = { kind: 'curve'; pts: V[] };
export type InkShape = Shape | CurveShape;
export type InkShapeKind = InkShape['kind'];
export type InkShapeChoice = ShapeChoice | 'curve';

const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
function bboxDiag(p: readonly V[]): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return Math.hypot(x1 - x0, y1 - y0);
}
/** The turn at `o` from a→o to o→b, in radians (0 = straight on). */
function turnAt(a: V, o: V, b: V): number {
  const u = Math.atan2(o.y - a.y, o.x - a.x), v = Math.atan2(b.y - o.y, b.x - o.x);
  let d = Math.abs(u - v) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export const SHAPE_LABELS: Record<InkShapeKind, string> = { ...SHAPE_NAMES, curve: 'Curve' };
export const shapeName = (s: InkShape) => SHAPE_LABELS[s.kind];

/**
 * How many inner points of a simplified path are real corners: the stroke turns more than 55°
 * within a few samples of the point. A bend spread over the stroke is not a corner.
 */
export function sharpCorners(p: readonly V[], simplified: readonly V[]): number {
  const k = Math.max(2, Math.round(p.length * 0.04));
  let n = 0;
  for (let j = 1; j < simplified.length - 1; j++) {
    const v = simplified[j]!;
    let i = 0, best = Infinity;
    p.forEach((q, qi) => { const d = dist(q, v); if (d < best) { best = d; i = qi; } });
    if (i - k < 0 || i + k >= p.length) continue;
    if (turnAt(p[i - k]!, p[i]!, p[i + k]!) > (55 * Math.PI) / 180) n++;
  }
  return n;
}

/** A hand-drawn open stroke as a clean smooth curve: a few points it passes through. */
export function curveOf(raw: readonly V[]): CurveShape | null {
  if (raw.length < 2 || pathLength(raw) < 12) return null;
  const p = resample(raw, 96);
  const diag = Math.max(1, bboxDiag(p));
  let pts = simplify(p, Math.max(2, 0.025 * diag));
  // keep it light enough to read as one gesture
  for (let eps = 0.035; pts.length > 14; eps += 0.01) pts = simplify(p, eps * diag);
  return { kind: 'curve', pts: pts.map((q) => ({ x: q.x, y: q.y })) };
}

/** Is this stroke closed (its ends meet), as the vendored recogniser decides it? */
function looksClosed(raw: readonly V[]): boolean {
  const p = resample(raw, 96);
  const len = pathLength(p);
  return dist(p[0]!, p[p.length - 1]!) < Math.max(10, 0.2 * len) && bboxDiag(p) > 0.25 * len;
}

/** The shape a hand-drawn stroke looks like (with smooth curves), or null. */
export function recognizeInkShape(raw: readonly V[]): InkShape | null {
  if (raw.length < 2 || pathLength(raw) < 12) return null;
  const s = recognizeShape(raw);
  if (s && s.kind !== 'polyline') return s;
  if (looksClosed(raw)) return s;
  const p = resample(raw, 96);
  // real corners keep the polyline; a stroke that only bends becomes a smooth curve
  if (s?.kind === 'polyline' && sharpCorners(p, s.pts) > 0) return s;
  return curveOf(raw);
}

/** Points along a centripetal Catmull–Rom spline through `pts`, about `step` apart. */
export function splineOutline(pts: readonly V[], step = 3): V[] {
  if (pts.length < 2) return pts.map((q) => ({ ...q }));
  if (pts.length === 2) return shapeOutline({ kind: 'line', a: pts[0]!, b: pts[1]! }, step);
  const ext = [{ x: 2 * pts[0]!.x - pts[1]!.x, y: 2 * pts[0]!.y - pts[1]!.y }, ...pts, { x: 2 * pts.at(-1)!.x - pts.at(-2)!.x, y: 2 * pts.at(-1)!.y - pts.at(-2)!.y }];
  const out: V[] = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1]!, p1 = ext[i]!, p2 = ext[i + 1]!, p3 = ext[i + 2]!;
    const t01 = Math.sqrt(dist(p0, p1)) || 1e-4, t12 = Math.sqrt(dist(p1, p2)) || 1e-4, t23 = Math.sqrt(dist(p2, p3)) || 1e-4;
    // tangents in the centripetal form: no loops or overshoot at tight points
    const m1 = { x: (p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12) + (p2.x - p1.x) / t12, y: (p1.y - p0.y) / t01 - (p2.y - p0.y) / (t01 + t12) + (p2.y - p1.y) / t12 };
    const m2 = { x: (p2.x - p1.x) / t12 - (p3.x - p1.x) / (t12 + t23) + (p3.x - p2.x) / t23, y: (p2.y - p1.y) / t12 - (p3.y - p1.y) / (t12 + t23) + (p3.y - p2.y) / t23 };
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push({ x: h00 * p1.x + h10 * t12 * m1.x + h01 * p2.x + h11 * t12 * m2.x, y: h00 * p1.y + h10 * t12 * m1.y + h01 * p2.y + h11 * t12 * m2.y });
    }
  }
  out.push({ ...pts.at(-1)! });
  return out;
}

export function inkShapeOutline(s: InkShape, step = 3): V[] {
  return s.kind === 'curve' ? splineOutline(s.pts, step) : shapeOutline(s, step);
}

/** Adjust while holding: a curve's start stays and the rest follows the pen, more toward the end. */
export function editInkShape(s: InkShape, grab: V, now: V, uniform = false): InkShape {
  if (s.kind !== 'curve') return editShape(s, grab, now, uniform);
  const dx = now.x - grab.x, dy = now.y - grab.y, n = Math.max(1, s.pts.length - 1);
  return { ...s, pts: s.pts.map((q, i) => ({ x: q.x + (dx * i) / n, y: q.y + (dy * i) / n })) };
}

export function constrainInkShape(s: InkShape): InkShape {
  return s.kind === 'curve' ? s : constrainShape(s);
}

/** The drawn stroke's pressure along the shape (a curve borrows the polyline of its outline). */
export function inkPressureProfile(s: InkShape, stroke: readonly (V & { pressure: number })[], samples = 64): number[] {
  return pressureProfile(s.kind === 'curve' ? { kind: 'polyline', pts: splineOutline(s.pts, 2) } : s, stroke, samples);
}

/** Refit the hand-drawn stroke as a chosen shape (the shape toggles). */
export function fitInkShape(choice: InkShapeChoice, raw: readonly V[]): InkShape | null {
  return choice === 'curve' ? curveOf(raw) : fitAs(choice, raw);
}

/** The toggles offered for a stroke: open strokes and closed ones get their own set. */
export function shapeChoicesFor(s: InkShape): { id: InkShapeChoice; label: string }[] {
  const open = s.kind === 'line' || s.kind === 'arc' || s.kind === 'polyline' || s.kind === 'curve';
  return open
    ? [{ id: 'line', label: 'Line' }, { id: 'arc', label: 'Arc' }, { id: 'curve', label: 'Curve' }, { id: 'polyline', label: 'Polyline' }]
    : [{ id: 'ellipse', label: 'Ellipse' }, { id: 'circle', label: 'Circle' }, { id: 'rect', label: 'Rectangle' }, { id: 'square', label: 'Square' }, { id: 'polygon', label: 'Polygon' }];
}

/** Which toggle a shape shows as chosen (a round ellipse is a circle, an even rectangle a square). */
export function choiceOf(s: InkShape): InkShapeChoice {
  if (s.kind === 'ellipse' && Math.abs(s.rx - s.ry) < 1e-6) return 'circle';
  if (s.kind === 'rect' && Math.abs(s.w - s.h) < 1e-6) return 'square';
  return s.kind;
}
