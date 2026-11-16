import type { Pt, Stroke } from '../doc/model';
import { eraseVectors, type VectorErase } from '../engine/core/vectorcut';
import type { StrokeRecord } from '../engine/core/stroke';
import { toRecord, type LinePass } from './replay';

/**
 * Editing vector ink (CSP's vector layer): pure functions on stored strokes, in page inches.
 * Each returns new strokes; the desk records before/after as one undo step.
 */

export interface StrokeHit {
  index: number;
  /** Fractional point index of the nearest spot. */
  at: number;
  dist: number;
}

/** The stroke nearest `p` within `reach` (its own half-width counts), topmost first. */
export function hitStroke(strokes: readonly Stroke[], p: Pt, reach: number): StrokeHit | null {
  let best: StrokeHit | null = null;
  for (let s = strokes.length - 1; s >= 0; s--) {
    const st = strokes[s]!;
    const pts = st.pts;
    for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
      const a = pts[i]!;
      const b = pts[i + 1] ?? a;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) - st.w / 2;
      if (d <= reach && (!best || d < best.dist - 1e-9)) best = { index: s, at: i + t, dist: d };
    }
  }
  return best;
}

/** Arc length from point 0 to each point. */
function arc(pts: readonly Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return out;
}

const ease = (d: number, r: number) => (d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r));

/** Insert a point at a fractional index when it isn't already close to one; returns its index. */
export function pointAt(s: Stroke, at: number): { stroke: Stroke; index: number } {
  const i = Math.floor(at);
  const t = at - i;
  if (t < 0.15 || i >= s.pts.length - 1) return { stroke: s, index: Math.min(s.pts.length - 1, Math.round(at)) };
  if (t > 0.85) return { stroke: s, index: i + 1 };
  const a = s.pts[i]!;
  const b = s.pts[i + 1]!;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const pts = [...s.pts.slice(0, i + 1), { x: lerp(a.x, b.x), y: lerp(a.y, b.y) }, ...s.pts.slice(i + 1)];
  const out: Stroke = { ...s, pts };
  if (s.pressure) out.pressure = [...s.pressure.slice(0, i + 1), lerp(s.pressure[i]!, s.pressure[i + 1]!), ...s.pressure.slice(i + 1)];
  if (s.pw) out.pw = [...s.pw.slice(0, i + 1), lerp(s.pw[i]!, s.pw[i + 1]!), ...s.pw.slice(i + 1)];
  return { stroke: out, index: i + 1 };
}

/**
 * Pull a line: the grabbed point moves by `delta`, its neighbours follow with a smooth falloff
 * over `radius` inches of line (CSP's "correct line" / Procreate-style point drag).
 */
export function reshape(s: Stroke, grab: number, delta: Pt, radius: number): Stroke {
  const d = arc(s.pts);
  const at = d[grab]!;
  return { ...s, pts: s.pts.map((p, i) => {
    const k = radius > 0 ? ease(Math.abs(d[i]! - at), radius) : i === grab ? 1 : 0;
    return { x: p.x + delta.x * k, y: p.y + delta.y * k };
  }) };
}

/**
 * Brush a line's width: points near the brush path get `factor` applied, with a falloff over
 * `radius` (CSP "adjust line width"). Widths stay within 0.1×–4× of the stroke's base.
 */
export function brushWidth(s: Stroke, path: readonly Pt[], radius: number, factor: number): Stroke | null {
  if (!path.length || radius <= 0 || factor === 1) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const sweep = path.map((b, i) => {
    x0 = Math.min(x0, b.x - radius); y0 = Math.min(y0, b.y - radius);
    x1 = Math.max(x1, b.x + radius); y1 = Math.max(y1, b.y + radius);
    const a = path[i - 1] ?? b;
    const dx = b.x - a.x, dy = b.y - a.y;
    return { a, dx, dy, len2: dx * dx + dy * dy };
  });
  function widthAt(p: Pt, original: number): number {
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return original;
    let near2 = radius * radius;
    for (const { a, dx, dy, len2 } of sweep) {
      const x = p.x - a.x, y = p.y - a.y;
      const t = len2 ? Math.max(0, Math.min(1, (x * dx + y * dy) / len2)) : 0;
      near2 = Math.min(near2, (x - dx * t) ** 2 + (y - dy * t) ** 2);
    }
    const influence = ease(Math.sqrt(near2), radius);
    return influence ? Math.max(0.1, Math.min(4, original * factor ** influence)) : original;
  }

  const pts: Pt[] = [], pw: number[] = [], pressure: number[] = [];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  let changed = false, room = Math.max(0, 4096 - s.pts.length);
  for (const [i, a] of s.pts.entries()) {
    const base = s.pw?.[i] ?? 1;
    const width = widthAt(a, base);
    pts.push(a);
    pw.push(width);
    if (s.pressure) pressure.push(s.pressure[i]!);
    changed ||= width !== base;
    const b = s.pts[i + 1];
    if (!b || room < 3) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= radius) continue;

    // Sample just the part of a long segment inside the sweep bounds, including the fade edges.
    let start = 0, end = 1;
    for (const [at, delta, lo, hi] of [[a.x, dx, x0, x1], [a.y, dy, y0, y1]] as const) {
      if (!delta && (at < lo || at > hi)) { end = -1; break; }
      if (!delta) continue;
      const t0 = (lo - at) / delta, t1 = (hi - at) / delta;
      start = Math.max(start, Math.min(t0, t1));
      end = Math.min(end, Math.max(t0, t1));
    }
    if (end <= start) continue;
    const steps = Math.min(room - 1, 128, Math.max(2, Math.ceil((end - start) * length / Math.max(radius / 4, 0.01))));
    const samples = [];
    let sampleChanged = false;
    for (let j = 0; j <= steps; j++) {
      const t = lerp(start, end, j / steps);
      if (t <= 0 || t >= 1) continue;
      const point = { x: a.x + dx * t, y: a.y + dy * t };
      const original = lerp(base, s.pw?.[i + 1] ?? 1, t);
      const width = widthAt(point, original);
      sampleChanged ||= width !== original;
      samples.push({ point, width, t });
    }
    if (!sampleChanged) continue;
    for (const sample of samples) {
      pts.push(sample.point);
      pw.push(sample.width);
      if (s.pressure) pressure.push(lerp(s.pressure[i]!, s.pressure[i + 1]!, sample.t));
    }
    room -= samples.length;
    changed = true;
  }
  return changed ? { ...s, pts, pw, ...(s.pressure ? { pressure } : {}) } : null;
}

export function removePoint(s: Stroke, index: number): Stroke {
  if (s.pts.length <= 2 || index < 0 || index >= s.pts.length) return s;
  return pick(s, s.pts.map((_, i) => i).filter((i) => i !== index));
}

/** Scale a whole line's width. */
export function scaleWidth(s: Stroke, k: number): Stroke {
  return { ...s, w: Math.max(0.002, Math.min(0.5, s.w * k)) };
}

/**
 * Simplify: drop points the line doesn't need (Ramer–Douglas–Peucker with tolerance `eps`
 * inches), keeping pressure and width at the points kept.
 */
export function simplify(s: Stroke, eps: number): Stroke {
  const n = s.pts.length;
  if (n < 3) return s;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = s.pts[a]!;
    const B = s.pts[b]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const l = Math.hypot(dx, dy) || 1e-12;
    let far = -1;
    let fd = 0;
    for (let i = a + 1; i < b; i++) {
      const P = s.pts[i]!;
      const d = Math.abs((P.x - A.x) * dy - (P.y - A.y) * dx) / l;
      // pressure changes are kept too: a swell is part of the line
      const dp = Math.abs((s.pressure?.[i] ?? 1) - ((s.pressure?.[a] ?? 1) + ((s.pressure?.[b] ?? 1) - (s.pressure?.[a] ?? 1)) * ((i - a) / (b - a))));
      const score = Math.max(d, dp * eps * 4);
      if (score > fd) {
        fd = score;
        far = i;
      }
    }
    if (far > 0 && fd > eps) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const idx = [...keep.keys()].filter((i) => keep[i]);
  return pick(s, idx);
}

/** Smooth: each inner point moves toward its neighbours' average, `passes` times; ends stay put. */
export function smooth(s: Stroke, passes = 3, k = 0.5): Stroke {
  let pts = s.pts;
  for (let r = 0; r < passes; r++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const a = pts[i - 1]!;
      const b = pts[i + 1]!;
      return { x: p.x + ((a.x + b.x) / 2 - p.x) * k, y: p.y + ((a.y + b.y) / 2 - p.y) * k };
    });
  }
  return { ...s, pts };
}

function pick(s: Stroke, idx: number[]): Stroke {
  const out: Stroke = { ...s, pts: idx.map((i) => s.pts[i]!) };
  if (s.pressure) out.pressure = idx.map((i) => s.pressure![i]!);
  if (s.pw) out.pw = idx.map((i) => s.pw![i]!);
  return out;
}

/**
 * Vector eraser (Clip Studio's three modes, via 2Dope's `eraseVectors`): `whole` removes a touched
 * line, `crossing` removes the piece between its nearest crossings with other lines (cleans
 * overshoots), `intersection` cuts only where the eraser crosses. Returns the new list or null.
 */
export function eraseStrokes(strokes: readonly Stroke[], path: readonly Pt[], radius: number, mode: VectorErase, pass: LinePass, dpi: number, newSeed: () => number): Stroke[] | null {
  const recs: StrokeRecord[] = strokes.map((s, i) => toRecord(s, pass, dpi, String(i)));
  const out = eraseVectors(recs, path.map((p) => ({ x: p.x * dpi, y: p.y * dpi })), radius * dpi, mode);
  if (!out) return null;
  return out.map((r) => {
    const [base, piece] = r.id.split('~');
    const src = strokes[Number(base)]!;
    if (piece === undefined) return src;
    // a piece of a cut line: its points, and flat ends where it was cut
    const s: Stroke = {
      ...src,
      seed: newSeed(),
      pts: r.points.map((p) => ({ x: p.x / dpi, y: p.y / dpi })),
      pressure: r.points.map((p) => Math.max(0, Math.min(1, p.pressure))),
    };
    if (src.pw || r.points.some((p) => p.w !== undefined && p.w !== 1)) s.pw = r.points.map((p) => p.w ?? 1);
    else delete s.pw;
    const original = recs[Number(base)]!;
    const changed = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) > 1e-6;
    const flatStart = changed(r.points[0]!, original.points[0]!) || src.flat?.[0];
    const flatEnd = changed(r.points.at(-1)!, original.points.at(-1)!) || src.flat?.[1];
    if (flatStart || flatEnd) s.flat = [!!flatStart, !!flatEnd];
    else delete s.flat;
    return s;
  });
}

export type { VectorErase };
