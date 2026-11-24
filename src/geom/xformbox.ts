import type { Pt } from '../doc/model';
import { invert, type Mat } from '../engine/core/selxform';
import type { Bounds } from './resizebox';

/**
 * The transform box: an oriented rectangle that turns with the art it holds, the way Procreate's does.
 * It is a pure description (centre, size, turn, flips); the matrix that moves the art is derived from
 * the box the drag started with and the box it is now, so a long session of drags never drifts.
 * Sizes are in whatever unit the caller works in (page inches for the paint and line tools).
 */
export interface OBox {
  cx: number;
  cy: number;
  /** Width and height along the box's own axes; always positive. */
  w: number;
  h: number;
  /** Turn in radians, clockwise on screen (y points down). */
  a: number;
  /** Flips are 1 or -1; they change how the art maps onto the box, not where the handles sit. */
  fx: 1 | -1;
  fy: 1 | -1;
}

export type Side = -1 | 0 | 1;
export type BoxGrab =
  | { kind: 'move' }
  | { kind: 'rotate' }
  | { kind: 'pivot' }
  | { kind: 'resize'; sx: Side; sy: Side };

export interface BoxHandle { sx: Side; sy: Side; at: Pt }

export const boxFromBounds = (b: Bounds): OBox => ({
  cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0, a: 0, fx: 1, fy: 1,
});

/** Rotate a vector by `a` radians. */
const turn = (x: number, y: number, a: number): Pt => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * x - s * y, y: s * x + c * y };
};

/** A point given in the box's own frame (offsets from the centre, in box units) → world. */
export function boxPoint(b: OBox, lx: number, ly: number): Pt {
  const p = turn(lx, ly, b.a);
  return { x: b.cx + p.x, y: b.cy + p.y };
}

/** A world point → the box's own frame (offsets from the centre). */
export function boxLocal(b: OBox, p: Pt): Pt {
  return turn(p.x - b.cx, p.y - b.cy, -b.a);
}

/** Top-left, top-right, bottom-right, bottom-left, as the box sits (flips don't move the outline). */
export function boxCorners(b: OBox): Pt[] {
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => boxPoint(b, sx * b.w / 2, sy * b.h / 2));
}

/** Unit square (-.5….5) → world, including flips. */
function boxMat(b: OBox): Mat {
  const c = Math.cos(b.a), s = Math.sin(b.a), X = b.fx * b.w, Y = b.fy * b.h;
  return [c * X, s * X, -s * Y, c * Y, b.cx, b.cy];
}

const mul = (o: Mat, i: Mat): Mat => [
  o[0] * i[0] + o[2] * i[1], o[1] * i[0] + o[3] * i[1],
  o[0] * i[2] + o[2] * i[3], o[1] * i[2] + o[3] * i[3],
  o[0] * i[4] + o[2] * i[5] + o[4], o[1] * i[4] + o[3] * i[5] + o[5],
];

/** The matrix that carries art sitting in `from` to where it belongs in `to`; null if it would collapse. */
export function changeMatrix(from: OBox, to: OBox): Mat | null {
  const inv = invert(boxMat(from));
  if (!inv) return null;
  const m = mul(boxMat(to), inv);
  return m.every(Number.isFinite) && invert(m) ? m : null;
}

export const sameBox = (a: OBox, b: OBox): boolean =>
  Math.abs(a.cx - b.cx) < 1e-9 && Math.abs(a.cy - b.cy) < 1e-9 && Math.abs(a.w - b.w) < 1e-9 &&
  Math.abs(a.h - b.h) < 1e-9 && Math.abs(a.a - b.a) < 1e-9 && a.fx === b.fx && a.fy === b.fy;

/** Grow a tiny box to a size a finger can still work with; the art keeps its real size. */
export function boxFrame(b: OBox, scale: number): OBox {
  return { ...b, w: Math.max(b.w, 28 / scale), h: Math.max(b.h, 28 / scale) };
}

const KNOB = 23;

export function rotateKnob(b: OBox, scale: number): Pt {
  return boxPoint(b, 0, -b.h / 2 - KNOB / scale);
}

/** Eight handles; the side ones hide when the box is too small on screen to tell them from the corners. */
export function boxHandles(b: OBox, scale: number): BoxHandle[] {
  const room = b.w * scale > 34 && b.h * scale > 34;
  const all: [Side, Side][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  return all.filter(([sx, sy]) => (sx && sy) || room).map(([sx, sy]) => ({ sx, sy, at: boxPoint(b, sx * b.w / 2, sy * b.h / 2) }));
}

export interface GrabOptions {
  touch?: boolean;
  /** Where the pivot sits (world), when it is showing. */
  pivot?: Pt | null;
  reachPx?: number;
}

/**
 * What a press at `p` takes hold of: the rotate knob, the pivot, a handle, just outside a corner (also
 * rotates, like most editors), or inside (move). `box` should already be framed for small art.
 */
export function grabBox(box: OBox, p: Pt, scale: number, o: GrabOptions = {}): BoxGrab | null {
  const reach = (o.reachPx ?? (o.touch ? 13 : 8)) / scale;
  const dist = (q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
  if (dist(rotateKnob(box, scale)) <= reach) return { kind: 'rotate' };
  if (o.pivot && dist(o.pivot) <= reach) return { kind: 'pivot' };
  const near = boxHandles(box, scale).sort((x, y) => dist(x.at) - dist(y.at))[0]!;
  if (dist(near.at) <= reach) return { kind: 'resize', sx: near.sx, sy: near.sy };
  const q = boxLocal(box, p);
  if (Math.abs(q.x) <= box.w / 2 && Math.abs(q.y) <= box.h / 2) return { kind: 'move' };
  const corner = boxCorners(box).map((c) => dist(c)).sort((x, y) => x - y)[0]!;
  if (corner <= reach + 24 / scale) return { kind: 'rotate' };
  return null;
}

/** An angle in degrees, pulled to the nearest `step` when within `tol` (pass tol ≥ step/2 to always snap). */
export function snapDegrees(deg: number, step = 15, tol = 3): number {
  const near = Math.round(deg / step) * step;
  return Math.abs(deg - near) <= tol ? near : deg;
}

/** Degrees wrapped to -180…180. */
export const wrapDegrees = (d: number): number => ((d + 180) % 360 + 360) % 360 - 180;

export function moveBox(b: OBox, d: Pt, axisLock = false): OBox {
  let { x, y } = d;
  if (axisLock) { if (Math.abs(y) > Math.abs(x)) x = 0; else y = 0; }
  return { ...b, cx: b.cx + x, cy: b.cy + y };
}

export interface Edges { w: number; h: number }

/**
 * Pull the box toward the page edges and centre lines. Works on the box's bounding rectangle, so a turned
 * box lines up by its visible extent. Returns the guide lines it snapped to, for drawing.
 */
export function snapBoxToPage(b: OBox, page: Edges, tol: number): { box: OBox; guides: { x?: number; y?: number } } {
  const cs = boxCorners(b);
  const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pull = (lo: number, hi: number, size: number) => {
    let best: { shift: number; line: number } | null = null;
    for (const [at, line] of [[lo, 0], [(lo + hi) / 2, size / 2], [hi, size]] as const) {
      const d = line - at;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, line };
    }
    return best;
  };
  const sx = pull(x0, x1, page.w), sy = pull(y0, y1, page.h);
  const guides: { x?: number; y?: number } = {};
  if (sx) guides.x = sx.line;
  if (sy) guides.y = sy.line;
  return { box: { ...b, cx: b.cx + (sx?.shift ?? 0), cy: b.cy + (sy?.shift ?? 0) }, guides };
}

export interface ResizeOptions {
  /** Keep proportions (all handles scale both sides). */
  uniform: boolean;
  /** Scale about the centre instead of the opposite handle. */
  centre: boolean;
  /** Smallest side, in box units. */
  min: number;
  /** The box the art started in; sizes snap back to it within 2% when given. */
  snapTo?: OBox | null;
}

/** Drag a handle. The pull is read along the box's own axes, so a turned box stretches along its edges. */
export function resizeOBox(b: OBox, sx: Side, sy: Side, from: Pt, to: Pt, o: ResizeOptions): OBox {
  const d = turn(to.x - from.x, to.y - from.y, -b.a);
  const mult = o.centre ? 2 : 1;
  let w = sx ? Math.max(o.min, b.w + sx * d.x * mult) : b.w;
  let h = sy ? Math.max(o.min, b.h + sy * d.y * mult) : b.h;
  const snap = o.snapTo;
  if (o.uniform) {
    const rw = w / b.w, rh = h / b.h;
    // a side handle only moves one axis; the other follows it
    let k = sx && sy ? (Math.abs(rw - 1) > Math.abs(rh - 1) ? rw : rh) : sx ? rw : rh;
    k = Math.max(k, o.min / b.w, o.min / b.h);
    if (snap && Math.abs(b.w * k / snap.w - 1) < 0.02) k = snap.w / b.w;
    w = b.w * k; h = b.h * k;
  } else if (snap) {
    if (sx && Math.abs(w / snap.w - 1) < 0.02) w = snap.w;
    if (sy && Math.abs(h / snap.h - 1) < 0.02) h = snap.h;
  }
  // the edge opposite the handle stays put; a side handle in uniform mode grows the other axis about its middle
  const shift = o.centre ? { x: 0, y: 0 } : turn(sx * (w - b.w) / 2, sy * (h - b.h) / 2, b.a);
  return { ...b, w, h, cx: b.cx + shift.x, cy: b.cy + shift.y };
}

export interface RotateResult { box: OBox; degrees: number }

/**
 * Turn the box about `pivot` as the pointer swings round it. `reference` is the angle the art started at
 * (0 for an untouched selection): the readout and the snap are measured from it.
 */
export function rotateOBox(b: OBox, pivot: Pt, from: Pt, to: Pt, reference: number, snap: { step: number; tol: number } | null): RotateResult {
  const swing = Math.atan2(to.y - pivot.y, to.x - pivot.x) - Math.atan2(from.y - pivot.y, from.x - pivot.x);
  let total = wrapDegrees((b.a + swing - reference) * 180 / Math.PI);
  if (snap) total = snapDegrees(total, snap.step, snap.tol);
  const a = reference + total * Math.PI / 180;
  const delta = a - b.a;
  const c = turn(b.cx - pivot.x, b.cy - pivot.y, delta);
  return { box: { ...b, a, cx: pivot.x + c.x, cy: pivot.y + c.y }, degrees: total };
}

/** Two-finger pinch and twist: scale and turn about the fingers' starting midpoint, then follow its drift. */
export function pinchBox(b: OBox, anchor: Pt, drift: Pt, scale: number, twist: number): OBox {
  const c = turn((b.cx - anchor.x) * scale, (b.cy - anchor.y) * scale, twist);
  return { ...b, w: b.w * scale, h: b.h * scale, a: b.a + twist, cx: anchor.x + c.x + drift.x, cy: anchor.y + c.y + drift.y };
}

/** Mirror across the box's own vertical (`h`) or horizontal (`v`) axis. */
export const flipBox = (b: OBox, axis: 'h' | 'v'): OBox => axis === 'h' ? { ...b, fx: -b.fx as 1 | -1 } : { ...b, fy: -b.fy as 1 | -1 };

/** Turn by a fixed step about the box centre. */
export const turnBox = (b: OBox, degrees: number): OBox => ({ ...b, a: b.a + degrees * Math.PI / 180 });

/** Scale (about the centre) so the box's bounding rectangle fits inside `into`, keeping its aspect. */
export function fitBox(b: OBox, into: Edges, margin = 0): OBox {
  const cs = boxCorners(b);
  const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  if (bw <= 0 || bh <= 0) return b;
  const k = Math.min((into.w - 2 * margin) / bw, (into.h - 2 * margin) / bh);
  return { ...b, w: b.w * k, h: b.h * k, cx: into.w / 2, cy: into.h / 2 };
}

/** Pivot as a fraction of the box (so it travels with the box) → world, and back. */
export const pivotPoint = (b: OBox, f: Pt): Pt => boxPoint(b, f.x * b.w, f.y * b.h);
export function pivotFraction(b: OBox, p: Pt): Pt {
  const q = boxLocal(b, p);
  const clamp = (v: number) => Math.max(-1.5, Math.min(1.5, v));
  return { x: b.w ? clamp(q.x / b.w) : 0, y: b.h ? clamp(q.y / b.h) : 0 };
}
