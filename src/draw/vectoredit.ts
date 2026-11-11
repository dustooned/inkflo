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
  let touched = false;
  const pw = s.pts.map((p, i) => {
    let near = Infinity;
    for (const q of path) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
    const k = ease(near, radius);
    const cur = s.pw?.[i] ?? 1;
    if (k <= 0) return cur;
    touched = true;
    return Math.max(0.1, Math.min(4, cur * Math.pow(factor, k)));
  });
  return touched ? { ...s, pw } : null;
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
    const flatStart = r.brush.taperStart === 0 && (src.flat?.[0] || recs[Number(base)]!.brush.taperStart > 0);
    const flatEnd = r.brush.taperEnd === 0 && (src.flat?.[1] || recs[Number(base)]!.brush.taperEnd > 0);
    if (flatStart || flatEnd) s.flat = [!!flatStart, !!flatEnd];
    else delete s.flat;
    return s;
  });
}

export type { VectorErase };
