// Vendored from 2Dope src/core/quickshape.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * QuickShape (doc 14): hold at the end of a stroke and it snaps to the shape it looks like (a
 * line, an arc, a polyline, an ellipse, a rectangle or a polygon). While still held, moving the
 * pen resizes and turns it; "constrain" (a second finger, or Shift) makes it perfect: a circle, a
 * square, a regular polygon, a line at a 15° step. Pure geometry, no DOM.
 */

export interface V {
  x: number;
  y: number;
}

export type Shape =
  | { kind: 'line'; a: V; b: V }
  | { kind: 'polyline'; pts: V[] }
  | { kind: 'arc'; cx: number; cy: number; r: number; start: number; sweep: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number }
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number; rot: number }
  | { kind: 'polygon'; pts: V[] };

export type ShapeKind = Shape['kind'];

const dist = (a: V, b: V) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(p: readonly V[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) n += dist(p[i - 1]!, p[i]!);
  return n;
}

/** `n` points evenly spaced along the path. */
export function resample(p: readonly V[], n: number): V[] {
  const total = pathLength(p);
  if (p.length < 2 || total === 0) return p.length ? [{ ...p[0]! }] : [];
  const step = total / (n - 1);
  const out: V[] = [{ x: p[0]!.x, y: p[0]!.y }];
  let want = step;
  let walked = 0;
  for (let i = 1; i < p.length && out.length < n; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const seg = dist(a, b);
    while (seg > 0 && walked + seg >= want && out.length < n) {
      const t = (want - walked) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      want += step;
    }
    walked += seg;
  }
  while (out.length < n) out.push({ ...p[p.length - 1]! });
  return out;
}

function segDist(p: V, a: V, b: V): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Ramer–Douglas–Peucker: the corners of an open path. */
export function simplify(p: readonly V[], eps: number): V[] {
  if (p.length < 3) return p.slice();
  let worst = 0;
  let at = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = segDist(p[i]!, p[0]!, p[p.length - 1]!);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= eps) return [p[0]!, p[p.length - 1]!];
  const left = simplify(p.slice(0, at + 1), eps);
  const right = simplify(p.slice(at), eps);
  return [...left.slice(0, -1), ...right];
}

/** The corners of a closed path (no repeated first point), dropping corners that are not corners. */
export function closedCorners(p: readonly V[], eps: number): V[] {
  if (p.length < 4) return p.slice();
  let far = 0;
  let worst = -1;
  p.forEach((q, i) => {
    const d = dist(q, p[0]!);
    if (d > worst) {
      worst = d;
      far = i;
    }
  });
  const a = simplify(p.slice(0, far + 1), eps);
  const b = simplify([...p.slice(far), p[0]!], eps);
  let pts = [...a.slice(0, -1), ...b.slice(0, -1)];
  // the start point is rarely a real corner: drop any vertex that sits on the line of its neighbours
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      const next = pts[(i + 1) % pts.length]!;
      if (segDist(pts[i]!, prev, next) < eps) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Least-squares circle through points (Kåsa); null when they are (nearly) on a line. */
export function fitCircle(p: readonly V[]): { cx: number; cy: number; r: number } | null {
  const n = p.length;
  let mx = 0;
  let my = 0;
  for (const q of p) {
    mx += q.x;
    my += q.y;
  }
  mx /= n;
  my /= n;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const q of p) {
    const u = q.x - mx;
    const v = q.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = svv === 0 ? 0 : (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { cx: mx + uc, cy: my + vc, r };
}

/** Centre, axes and angle of the points (principal components). */
function pca(p: readonly V[]): { cx: number; cy: number; l1: number; l2: number; rot: number } {
  let cx = 0;
  let cy = 0;
  for (const q of p) {
    cx += q.x;
    cy += q.y;
  }
  cx /= p.length;
  cy /= p.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const q of p) {
    const dx = q.x - cx;
    const dy = q.y - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  xx /= p.length;
  yy /= p.length;
  xy /= p.length;
  const tr = xx + yy;
  const disc = Math.sqrt(Math.max(0, ((xx - yy) * (xx - yy)) / 4 + xy * xy));
  return { cx, cy, l1: tr / 2 + disc, l2: Math.max(0, tr / 2 - disc), rot: 0.5 * Math.atan2(2 * xy, xx - yy) };
}

/** Fit the line's direction from the whole stroke rather than two possibly shaky endpoints. */
function fitLine(p: readonly V[]): Extract<Shape, { kind: 'line' }> {
  const pc = pca(p);
  const ux = Math.cos(pc.rot), uy = Math.sin(pc.rot);
  const project = (q: V) => (q.x - pc.cx) * ux + (q.y - pc.cy) * uy;
  let a = project(p[0]!), b = project(p[p.length - 1]!);
  // Explicitly converting a closed stroke to a line still needs a useful length.
  const values = p.map(project);
  const lo = Math.min(...values), hi = Math.max(...values);
  if (Math.abs(b - a) < (hi - lo) * 0.25) { a = lo; b = hi; }
  return { kind: 'line', a: { x: pc.cx + ux * a, y: pc.cy + uy * a }, b: { x: pc.cx + ux * b, y: pc.cy + uy * b } };
}

/** Small pivoted solver; normalization keeps the conic fit well conditioned at canvas scale. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i]![k]!) > Math.abs(a[pivot]![k]!)) pivot = i;
    if (Math.abs(a[pivot]![k]!) < 1e-10) return null;
    [a[k], a[pivot]] = [a[pivot]!, a[k]!];
    const scale = a[k]![k]!;
    for (let j = k; j <= n; j++) a[k]![j] = a[k]![j]! / scale;
    for (let i = 0; i < n; i++) if (i !== k) {
      const f = a[i]![k]!;
      for (let j = k; j <= n; j++) a[i]![j] = a[i]![j]! - f * a[k]![j]!;
    }
  }
  return a.map(row => row[n]!);
}

/**
 * Fit an ellipse boundary. PCA gives the orientation of point mass, not ellipse radii:
 * uniform distance samples spend more time near the narrow ends of an elongated oval.
 * Solve a normalized conic instead, rejecting degenerate/non-elliptic solutions.
 */
function fitEllipse(p: readonly V[]): Extract<Shape, { kind: 'ellipse' }> | null {
  if (p.length < 5) return null;
  const o = centroid(p), scale = bboxDiag(p) / 2;
  if (!(scale > 0)) return null;
  const m = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  const rhs = Array<number>(5).fill(0);
  for (const q of p) {
    const x = (q.x - o.x) / scale, y = (q.y - o.y) / scale;
    const v = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) {
      rhs[i] = rhs[i]! + v[i]!;
      for (let j = 0; j < 5; j++) m[i]![j] = m[i]![j]! + v[i]! * v[j]!;
    }
  }
  const coefficients = solve(m, rhs);
  if (!coefficients) return null;
  const [a, b, c, d, e] = coefficients as [number, number, number, number, number];
  const det = 4 * a * c - b * b;
  if (det <= 1e-8 || a <= 0 || c <= 0) return null;
  const x = (b * e - 2 * c * d) / det, y = (b * d - 2 * a * e) / det;
  const k = 1 + a * x * x + b * x * y + c * y * y;
  const disc = Math.hypot(a - c, b);
  const low = (a + c - disc) / 2, high = (a + c + disc) / 2;
  if (low <= 0 || k <= 0) return null;
  const rx = Math.sqrt(k / low) * scale, ry = Math.sqrt(k / high) * scale;
  if (![rx, ry, x, y].every(Number.isFinite) || rx > 4 * scale || ry < 0.001 * scale) return null;
  return { kind: 'ellipse', cx: o.x + x * scale, cy: o.y + y * scale, rx, ry, rot: 0.5 * Math.atan2(-b, c - a) };
}

function bboxDiag(p: readonly V[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return Math.hypot(x1 - x0, y1 - y0);
}

const angleBetween = (a: V, o: V, b: V) => {
  const u = Math.atan2(a.y - o.y, a.x - o.x);
  const v = Math.atan2(b.y - o.y, b.x - o.x);
  let d = Math.abs(u - v) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

/** The shape a hand-drawn stroke looks like, or null when it does not look like one. */
export function recognizeShape(raw: readonly V[]): Shape | null {
  const len = pathLength(raw);
  if (raw.length < 2 || len < 12) return null;
  const p = resample(raw, 96);
  const first = p[0]!;
  const last = p[p.length - 1]!;
  const diag = bboxDiag(p);
  const gap = dist(first, last);
  const closed = gap < Math.max(10, 0.2 * len) && diag > 0.25 * len;

  if (!closed) {
    const chord = gap;
    let dev = 0;
    for (const q of p) dev = Math.max(dev, segDist(q, first, last));
    if (dev < Math.max(3, 0.07 * chord)) return fitLine(p);
    const eps = Math.max(3, 0.06 * diag);
    // an arc: a circle fits well and the stroke bends one way
    const c = fitCircle(p);
    if (c && c.r < 4 * diag) {
      let rms = 0;
      for (const q of p) rms += (Math.hypot(q.x - c.cx, q.y - c.cy) - c.r) ** 2;
      rms = Math.sqrt(rms / p.length);
      let sweep = 0;
      for (let i = 1; i < p.length; i++) {
        let d = Math.atan2(p[i]!.y - c.cy, p[i]!.x - c.cx) - Math.atan2(p[i - 1]!.y - c.cy, p[i - 1]!.x - c.cx);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        sweep += d;
      }
      const corners = simplify(p, eps).length - 2;
      if (rms < 0.06 * c.r && Math.abs(sweep) < (340 * Math.PI) / 180 && (corners > 1 || rms < 0.035 * c.r))
        return { kind: 'arc', cx: c.cx, cy: c.cy, r: c.r, start: Math.atan2(first.y - c.cy, first.x - c.cx), sweep };
    }
    const pts = simplify(p, eps);
    if (pts.length >= 3 && pts.length <= 7) return { kind: 'polyline', pts };
    return null;
  }

  // closed: an ellipse, or a polygon (a rectangle when its corners are square)
  const ring = p.slice(0, -1);
  const fitted = fitEllipse(ring);
  let err = 0;
  if (fitted && fitted.ry > 1) {
    const cos = Math.cos(-fitted.rot);
    const sin = Math.sin(-fitted.rot);
    for (const q of ring) {
      const dx = q.x - fitted.cx;
      const dy = q.y - fitted.cy;
      const u = (dx * cos - dy * sin) / fitted.rx;
      const v = (dx * sin + dy * cos) / fitted.ry;
      err += (Math.hypot(u, v) - 1) ** 2;
    }
    err = Math.sqrt(err / ring.length);
  } else err = Infinity;
  if (fitted && err < 0.06) return fitted;
  const corners = closedCorners(ring, Math.max(3, 0.07 * diag));
  if (corners.length >= 3 && corners.length <= 8) {
    if (corners.length === 4 && corners.every((c, i) => Math.abs(angleBetween(corners[(i + 3) % 4]!, c, corners[(i + 1) % 4]!) - Math.PI / 2) < (22 * Math.PI) / 180)) {
      // a rectangle along its mean edge direction
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < 4; i++) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 4; // edges 90° apart agree after ×4
        const l = dist(a, b);
        sx += Math.cos(ang) * l;
        sy += Math.sin(ang) * l;
      }
      const rot = Math.atan2(sy, sx) / 4;
      const cx = corners.reduce((n, c) => n + c.x, 0) / 4;
      const cy = corners.reduce((n, c) => n + c.y, 0) / 4;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);
      let w = 0;
      let h = 0;
      for (const c of corners) {
        w += Math.abs((c.x - cx) * cos - (c.y - cy) * sin);
        h += Math.abs((c.x - cx) * sin + (c.y - cy) * cos);
      }
      return { kind: 'rect', cx, cy, w: w / 4, h: h / 4, rot };
    }
    return { kind: 'polygon', pts: corners };
  }
  return fitted && err < 0.12 ? fitted : null;
}

function rotScale(q: V, o: V, s: number, a: number): V {
  const dx = q.x - o.x;
  const dy = q.y - o.y;
  const c = Math.cos(a) * s;
  const n = Math.sin(a) * s;
  return { x: o.x + dx * c - dy * n, y: o.y + dx * n + dy * c };
}

function centroid(p: readonly V[]): V {
  return { x: p.reduce((n, q) => n + q.x, 0) / p.length, y: p.reduce((n, q) => n + q.y, 0) / p.length };
}

/** Stretch `q` away from `a` by (sx, sy) along axes turned by `rot`. */
function stretch(q: V, a: V, sx: number, sy: number, rot: number): V {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  const dx = q.x - a.x;
  const dy = q.y - a.y;
  const u = (dx * c + dy * n) * sx;
  const v = (-dx * n + dy * c) * sy;
  return { x: a.x + u * c - v * n, y: a.y + u * n + v * c };
}

/** Per-axis scale (in a frame turned by `rot`) that takes grab to now with the anchor fixed. */
function axisScale(anchor: V, grab: V, now: V, rot: number, uniform: boolean): { sx: number; sy: number } {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  const g = { x: (grab.x - anchor.x) * c + (grab.y - anchor.y) * n, y: -(grab.x - anchor.x) * n + (grab.y - anchor.y) * c };
  const w = { x: (now.x - anchor.x) * c + (now.y - anchor.y) * n, y: -(now.x - anchor.x) * n + (now.y - anchor.y) * c };
  // an axis the grab barely spans cannot be scaled from the pen: it follows the other axis
  let sx = Math.abs(g.x) < 4 ? 1 : w.x / g.x;
  let sy = Math.abs(g.y) < 4 ? 1 : w.y / g.y;
  if (Math.abs(g.x) < 4 && Math.abs(g.y) >= 4) sx = Math.abs(sy);
  if (Math.abs(g.y) < 4 && Math.abs(g.x) >= 4) sy = Math.abs(sx);
  if (uniform) {
    const k = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * k;
    sy = Math.sign(sy || 1) * k;
  }
  const min = 0.02;
  return { sx: Math.sign(sx || 1) * Math.max(min, Math.abs(sx)), sy: Math.sign(sy || 1) * Math.max(min, Math.abs(sy)) };
}

/** The point that stays put while the shape is adjusted from `grab`. */
export function anchorOf(s: Shape, grab: V): V {
  switch (s.kind) {
    case 'line':
      return s.a;
    case 'polyline':
      return s.pts[0]!;
    case 'arc':
      return { x: s.cx + Math.cos(s.start) * s.r, y: s.cy + Math.sin(s.start) * s.r };
    case 'polygon': {
      const c = centroid(s.pts);
      return { x: 2 * c.x - grab.x, y: 2 * c.y - grab.y };
    }
    default:
      return { x: 2 * s.cx - grab.x, y: 2 * s.cy - grab.y };
  }
}

/**
 * The shape after the pen moved from `grab` to `now` while holding. The first point stays put and
 * the pen drags the second: a line's or polyline's last point follows the pen; an arc stays pinned
 * at its start and its end lands on the pen; ellipses, rectangles and polygons keep the side
 * opposite the pen fixed and stretch toward it (width and height separately; `uniform` keeps
 * them in proportion).
 */
export function editShape(s: Shape, grab: V, now: V, uniform = false): Shape {
  const dx = now.x - grab.x;
  const dy = now.y - grab.y;
  switch (s.kind) {
    case 'line':
      return { ...s, b: { x: s.b.x + dx, y: s.b.y + dy } };
    case 'polyline': {
      const pts = s.pts.slice();
      const last = pts[pts.length - 1]!;
      pts[pts.length - 1] = { x: last.x + dx, y: last.y + dy };
      return { ...s, pts };
    }
    case 'arc': {
      const a = anchorOf(s, grab);
      const r0 = dist(grab, a);
      if (r0 < 4) return s;
      const k = Math.max(0.02, dist(now, a) / r0);
      const turn = Math.atan2(now.y - a.y, now.x - a.x) - Math.atan2(grab.y - a.y, grab.x - a.x);
      const c = rotScale({ x: s.cx, y: s.cy }, a, k, turn);
      return { ...s, cx: c.x, cy: c.y, r: s.r * k, start: s.start + turn };
    }
    case 'polygon': {
      const a = anchorOf(s, grab);
      const { sx, sy } = axisScale(a, grab, now, 0, uniform);
      return { ...s, pts: s.pts.map((q) => stretch(q, a, sx, sy, 0)) };
    }
    case 'ellipse':
    case 'rect': {
      const a = anchorOf(s, grab);
      const { sx, sy } = axisScale(a, grab, now, s.rot, uniform);
      const c = stretch({ x: s.cx, y: s.cy }, a, sx, sy, s.rot);
      return s.kind === 'ellipse' ? { ...s, cx: c.x, cy: c.y, rx: s.rx * Math.abs(sx), ry: s.ry * Math.abs(sy) } : { ...s, cx: c.x, cy: c.y, w: s.w * Math.abs(sx), h: s.h * Math.abs(sy) };
    }
  }
}

const STEP = Math.PI / 12; // 15°

/** The perfect version: circle, square, regular polygon, a line or polyline at 15° steps. */
export function constrainShape(s: Shape): Shape {
  switch (s.kind) {
    case 'line': {
      const l = dist(s.a, s.b);
      const ang = Math.round(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) / STEP) * STEP;
      return { ...s, b: { x: s.a.x + Math.cos(ang) * l, y: s.a.y + Math.sin(ang) * l } };
    }
    case 'polyline': {
      const pts = [s.pts[0]!];
      for (let i = 1; i < s.pts.length; i++) {
        const prev = pts[i - 1]!;
        const l = dist(s.pts[i - 1]!, s.pts[i]!);
        const ang = Math.round(Math.atan2(s.pts[i]!.y - s.pts[i - 1]!.y, s.pts[i]!.x - s.pts[i - 1]!.x) / STEP) * STEP;
        pts.push({ x: prev.x + Math.cos(ang) * l, y: prev.y + Math.sin(ang) * l });
      }
      return { ...s, pts };
    }
    case 'ellipse': {
      const r = (s.rx + s.ry) / 2;
      return { ...s, rx: r, ry: r };
    }
    case 'rect': {
      const r = (s.w + s.h) / 2;
      return { ...s, w: r, h: r };
    }
    case 'polygon': {
      const c = centroid(s.pts);
      const r = s.pts.reduce((n, q) => n + dist(q, c), 0) / s.pts.length;
      const a0 = Math.atan2(s.pts[0]!.y - c.y, s.pts[0]!.x - c.x);
      const n = s.pts.length;
      return { ...s, pts: s.pts.map((_, i) => ({ x: c.x + Math.cos(a0 + (i * 2 * Math.PI) / n) * r, y: c.y + Math.sin(a0 + (i * 2 * Math.PI) / n) * r })) };
    }
    case 'arc':
      return s;
  }
}

function densify(corners: readonly V[], step: number): V[] {
  const out: V[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]!;
    const b = corners[i + 1]!;
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  out.push({ ...corners[corners.length - 1]! });
  return out;
}

/** Points along the shape, about `step` apart; closed shapes end where they start. */
export function shapeOutline(s: Shape, step = 3): V[] {
  switch (s.kind) {
    case 'line':
      return densify([s.a, s.b], step);
    case 'polyline':
      return densify(s.pts, step);
    case 'polygon':
      return densify([...s.pts, s.pts[0]!], step);
    case 'rect': {
      const c = { x: s.cx, y: s.cy };
      const pts = [
        { x: -s.w, y: -s.h },
        { x: s.w, y: -s.h },
        { x: s.w, y: s.h },
        { x: -s.w, y: s.h },
      ].map((q) => rotScale({ x: c.x + q.x, y: c.y + q.y }, c, 1, s.rot));
      return densify([...pts, pts[0]!], step);
    }
    case 'arc': {
      const n = Math.max(8, Math.ceil((Math.abs(s.sweep) * s.r) / step));
      return Array.from({ length: n + 1 }, (_, i) => {
        const a = s.start + (s.sweep * i) / n;
        return { x: s.cx + Math.cos(a) * s.r, y: s.cy + Math.sin(a) * s.r };
      });
    }
    case 'ellipse': {
      const n = Math.max(16, Math.ceil((2 * Math.PI * Math.max(s.rx, s.ry)) / step));
      const c = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      return Array.from({ length: n + 1 }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        const x = Math.cos(a) * s.rx;
        const y = Math.sin(a) * s.ry;
        return { x: s.cx + x * c - y * sn, y: s.cy + x * sn + y * c };
      });
    }
  }
}

export const SHAPE_NAMES: Record<ShapeKind, string> = { line: 'Line', polyline: 'Polyline', arc: 'Arc', ellipse: 'Ellipse', rect: 'Rectangle', polygon: 'Polygon' };

/**
 * The stroke's pressure along a shape: `samples` values from the shape's start to its end, each
 * taken from the nearest point of the hand-drawn stroke (lightly smoothed). The shape keeps the
 * thick and thin of the line you drew, even after it is resized (the profile follows the outline).
 */
export function pressureProfile(shape: Shape, stroke: readonly (V & { pressure: number })[], samples = 64): number[] {
  const along = resample(shapeOutline(shape, 2), samples);
  const raw = along.map((q) => {
    let best = Infinity;
    let p = 1;
    for (const s of stroke) {
      const d = (s.x - q.x) ** 2 + (s.y - q.y) ** 2;
      if (d < best) {
        best = d;
        p = s.pressure;
      }
    }
    return p;
  });
  return raw.map((_, i) => {
    let n = 0;
    let sum = 0;
    for (let k = i - 2; k <= i + 2; k++) {
      const v = raw[k];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    return sum / n;
  });
}

/** The profile's value at `t` (0 = shape start, 1 = end). */
export function sampleProfile(profile: readonly number[], t: number): number {
  if (!profile.length) return 1;
  const x = Math.max(0, Math.min(1, t)) * (profile.length - 1);
  const i = Math.floor(x);
  const a = profile[i]!;
  const b = profile[Math.min(profile.length - 1, i + 1)]!;
  return a + (b - a) * (x - i);
}

/** What the Edit shape menu offers: the six shapes plus their perfect versions. */
export type ShapeChoice = ShapeKind | 'circle' | 'square';
export const SHAPE_CHOICES: { id: ShapeChoice; label: string }[] = [
  { id: 'line', label: '／ Line' },
  { id: 'polyline', label: '⌇ Polyline' },
  { id: 'arc', label: '◠ Arc' },
  { id: 'ellipse', label: '⬭ Ellipse' },
  { id: 'circle', label: '◯ Circle' },
  { id: 'rect', label: '▭ Rectangle' },
  { id: 'square', label: '□ Square' },
  { id: 'polygon', label: '⬠ Polygon' },
];

/**
 * Fit the hand-drawn stroke as a chosen shape (the Edit shape menu), whatever it was recognised
 * as. Null when the stroke cannot make that shape (too short, or no corners for a polygon).
 */
export function fitAs(choice: ShapeChoice, raw: readonly V[]): Shape | null {
  if (raw.length < 2 || pathLength(raw) < 6) return null;
  const p = resample(raw, 96);
  const first = p[0]!;
  const last = p[p.length - 1]!;
  const diag = Math.max(1, bboxDiag(p));
  switch (choice) {
    case 'line':
      return fitLine(p);
    case 'polyline': {
      const pts = simplify(p, Math.max(3, 0.06 * diag));
      return pts.length >= 2 ? { kind: 'polyline', pts } : null;
    }
    case 'arc': {
      const c = fitCircle(p);
      if (!c) return null;
      let sweep = 0;
      for (let i = 1; i < p.length; i++) {
        let d = Math.atan2(p[i]!.y - c.cy, p[i]!.x - c.cx) - Math.atan2(p[i - 1]!.y - c.cy, p[i - 1]!.x - c.cx);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        sweep += d;
      }
      sweep = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, sweep));
      return { kind: 'arc', cx: c.cx, cy: c.cy, r: c.r, start: Math.atan2(first.y - c.cy, first.x - c.cx), sweep };
    }
    case 'ellipse':
    case 'circle': {
      const e = fitEllipse(p);
      if (!e) return null;
      return choice === 'circle' ? constrainShape(e) : e;
    }
    case 'rect':
    case 'square': {
      // Four fitted edges give a stable rotation even when a square has equal PCA axes.
      const recognized = recognizeShape(raw);
      if (recognized?.kind === 'rect') return choice === 'square' ? constrainShape(recognized) : recognized;
      // the box around the stroke, turned to its main direction
      const pc = pca(p);
      const cos = Math.cos(pc.rot);
      const sin = Math.sin(pc.rot);
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const q of p) {
        const u = (q.x - pc.cx) * cos + (q.y - pc.cy) * sin;
        const v = -(q.x - pc.cx) * sin + (q.y - pc.cy) * cos;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      const mu = (u0 + u1) / 2;
      const mv = (v0 + v1) / 2;
      const r: Shape = { kind: 'rect', cx: pc.cx + mu * cos - mv * sin, cy: pc.cy + mu * sin + mv * cos, w: Math.max(1, (u1 - u0) / 2), h: Math.max(1, (v1 - v0) / 2), rot: pc.rot };
      return choice === 'square' ? constrainShape(r) : r;
    }
    case 'polygon': {
      const ring = dist(first, last) < 0.2 * pathLength(p) ? p.slice(0, -1) : p;
      const corners = closedCorners(ring, Math.max(3, 0.07 * diag));
      return corners.length >= 3 ? { kind: 'polygon', pts: corners.slice(0, 12) } : null;
    }
  }
}
