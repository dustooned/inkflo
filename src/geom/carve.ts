/**
 * Panel carving (ported from design/panel-carving.html and design/inkflo-app.html).
 *
 * The page stores cuts; panels are derived by folding the cuts over the trim rectangle (rule 1).
 * Everything public here takes and returns page units (inches). Internally the prototype's
 * thresholds (1 px dedupe, 12 px direction look-back, 2 px² minimum area...) were tuned for a
 * 520 px wide page, so geometry runs in that "proto" space: inches × K.
 */

import type { Cut, CutMode, Page, PageLayout, Pt } from '../doc/model';

/** Proto pixels per inch (520 px / 6.625 in). */
export const K = 520 / 6.625;

/** Gutter and border width (inches) and Chaikin passes for freehand cuts (0–5). */
export type LayoutStyle = PageLayout;

export const DEFAULT_LAYOUT: LayoutStyle = { gutter: 22 / K, border: 2.5 / K, curve: 2 };

export interface Panel {
  /** Reading-order index, 0-based. */
  index: number;
  /** Closed polygon, inches. */
  pts: Pt[];
  centroid: Pt;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

// ---------------------------------------------------------------------------------------------
// Vector helpers (proto space unless noted)

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const toProto = (pts: readonly Pt[]) => pts.map((p) => ({ x: p.x * K, y: p.y * K }));
const toInches = (pts: readonly Pt[]) => pts.map((p) => ({ x: p.x / K, y: p.y / K }));

export function area(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(poly: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    x += (p.x + q.x) * f;
    y += (p.y + q.y) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return { x: poly[0]!.x, y: poly[0]!.y };
  return { x: x / (6 * a), y: y / (6 * a) };
}

interface Hit {
  x: number;
  y: number;
  tp: number;
  tu: number;
}

function segInt(a: Pt, b: Pt, c: Pt, d: Pt): Hit | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const tp = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const tu = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (tp < 0 || tp > 1 || tu < 0 || tu > 1) return null;
  return { x: a.x + tp * r.x, y: a.y + tp * r.y, tp, tu };
}

export function chaikin(pts: readonly Pt[], iters: number): Pt[] {
  let p = pts.map((q) => ({ ...q }));
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) break;
    const out: Pt[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(p[p.length - 1]!);
    p = out;
  }
  return p;
}

/** Drop points closer than `tol` to the previous kept one (keeps the ends). */
export function simplify(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1]!, pts[i]!) > tol) out.push({ ...pts[i]! });
  out.push({ ...pts[pts.length - 1]! });
  return out;
}

function outward(pts: readonly Pt[], atStart: boolean): Pt {
  const seq = atStart ? pts : [...pts].reverse();
  const p0 = seq[0]!;
  let ref = seq[seq.length - 1]!;
  let acc = 0;
  for (let i = 1; i < seq.length; i++) {
    acc += dist(seq[i]!, seq[i - 1]!);
    if (acc >= 12) {
      ref = seq[i]!;
      break;
    }
  }
  let dx = p0.x - ref.x;
  let dy = p0.y - ref.y;
  let l = Math.hypot(dx, dy);
  if (l < 1e-3) {
    dx = 0;
    dy = -1;
    l = 1;
  }
  return { x: dx / l, y: dy / l };
}

const FAR = 2400;

function extendEnds(pts: readonly Pt[]): Pt[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const ds = outward(pts, true);
  const de = outward(pts, false);
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  return [{ x: a.x + ds.x * FAR, y: a.y + ds.y * FAR }, ...pts, { x: b.x + de.x * FAR, y: b.y + de.y * FAR }];
}

function subPath(path: readonly Pt[], s0: number, s1: number): Pt[] {
  const n = path.length - 1;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1e-6, v));
  s0 = clamp(s0);
  s1 = clamp(s1);
  const i0 = Math.floor(s0);
  const i1 = Math.floor(s1);
  const t0 = s0 - i0;
  const t1 = s1 - i1;
  const lerp = (i: number, t: number): Pt => ({ x: path[i]!.x + (path[i + 1]!.x - path[i]!.x) * t, y: path[i]!.y + (path[i + 1]!.y - path[i]!.y) * t });
  const pA = lerp(i0, t0);
  const pB = lerp(i1, t1);
  if (i0 === i1) return [pA, pB];
  const out = [pA];
  for (let i = i0 + 1; i <= i1; i++) out.push({ ...path[i]! });
  if (dist(out[out.length - 1]!, pB) > 0.01) out.push(pB);
  return out;
}

interface Crossing {
  pt: Pt;
  edge: number;
  s: number;
}

function walk(poly: readonly Pt[], from: Crossing, to: Crossing): Pt[] {
  const n = poly.length;
  const out: Pt[] = [{ ...from.pt }];
  let i = (from.edge + 1) % n;
  let guard = 0;
  while (guard++ <= n + 1) {
    out.push({ ...poly[i]! });
    if (i === to.edge) break;
    i = (i + 1) % n;
  }
  out.push({ ...to.pt });
  return out;
}

/** Split a polygon along a path that crosses it; returns the pieces (or the polygon itself). */
export function splitPoly(poly: readonly Pt[], path: readonly Pt[]): Pt[][] {
  const ins: Crossing[] = [];
  for (let j = 0; j < path.length - 1; j++) {
    for (let i = 0; i < poly.length; i++) {
      const r = segInt(path[j]!, path[j + 1]!, poly[i]!, poly[(i + 1) % poly.length]!);
      if (!r) continue;
      const pt = { x: r.x, y: r.y };
      if (ins.some((q) => dist(q.pt, pt) < 1)) continue;
      ins.push({ pt, edge: i, s: j + r.tp });
    }
  }
  if (ins.length < 2) return [poly.map((p) => ({ ...p }))];
  ins.sort((a, b) => a.s - b.s);
  const A = ins[0]!;
  const B = ins[ins.length - 1]!;
  if (dist(A.pt, B.pt) < 1) return [poly.map((p) => ({ ...p }))];
  const chain = subPath(path, A.s, B.s);
  const c1 = walk(poly, A, B);
  const c2 = walk(poly, B, A);
  const clean = (p: Pt[]) => {
    const out: Pt[] = [];
    for (const q of p) if (!out.length || dist(out[out.length - 1]!, q) > 0.6) out.push(q);
    if (out.length > 2 && dist(out[0]!, out[out.length - 1]!) < 0.6) out.pop();
    return out;
  };
  return [c1.concat([...chain].reverse()), c2.concat(chain)].map(clean).filter((p) => p.length >= 3 && Math.abs(area(p)) > 2);
}

export function pointInPoly(pt: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function rayExit(poly: readonly Pt[], origin: Pt, dir: Pt): Pt | null {
  const far = { x: origin.x + dir.x * 4000, y: origin.y + dir.y * 4000 };
  let best: Pt | null = null;
  let bt = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const r = segInt(origin, far, poly[i]!, poly[(i + 1) % poly.length]!);
    if (!r) continue;
    const t = (r.x - origin.x) * dir.x + (r.y - origin.y) * dir.y;
    if (t > 0.5 && t < bt) {
      bt = t;
      best = { x: r.x, y: r.y };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Page level (inches in, inches out)

export function layoutOf(page: Page): LayoutStyle {
  return page.layout ?? DEFAULT_LAYOUT;
}

function trimProto(page: Page): Pt[] {
  const w = page.widthIn * K;
  const h = page.heightIn * K;
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

/** The full path a cut splits along, in proto space. */
function cutPathProto(c: Cut, curve: number): Pt[] {
  if (c.mode === 'panel' && c.extended && c.extended.length >= 2) return toProto(c.extended);
  return extendEnds(chaikin(toProto(c.pts), curve));
}

/** The full path a cut splits along, inches (for rendering the gutter band). */
export function cutPath(c: Cut, page: Page): Pt[] {
  return toInches(cutPathProto(c, layoutOf(page).curve));
}

function readingOrder(polys: Pt[][]): Pt[][] {
  // rows of ~70 proto px (~0.9 in), then left to right
  return polys.sort((a, b) => {
    const ca = centroid(a);
    const cb = centroid(b);
    return Math.round(ca.y / 70) - Math.round(cb.y / 70) || ca.x - cb.x;
  });
}

function basePanelsProto(page: Page, cuts: readonly Cut[]): Pt[][] {
  const curve = layoutOf(page).curve;
  let ps: Pt[][] = [trimProto(page)];
  for (const c of cuts) {
    const path = cutPathProto(c, curve);
    const next: Pt[][] = [];
    for (const p of ps) for (const q of splitPoly(p, path)) next.push(q);
    ps = next;
  }
  return readingOrder(ps);
}

/** Fold the page's cuts into panels, in reading order. Never stored. */
export function derivePanels(page: Page): Panel[] {
  return basePanelsProto(page, page.cuts).map((poly, index) => {
    const pts = toInches(poly);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { index, pts, centroid: centroid(pts), bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
  });
}

export function panelAt(panels: readonly Panel[], pt: Pt): Panel | null {
  for (let i = panels.length - 1; i >= 0; i--) if (pointInPoly(pt, panels[i]!.pts)) return panels[i]!;
  return null;
}

function snapToTrim(p: Pt, page: Page, tol: number): Pt {
  const w = page.widthIn * K;
  const h = page.heightIn * K;
  let { x, y } = p;
  if (Math.abs(x) < tol) x = 0;
  else if (Math.abs(x - w) < tol) x = w;
  if (Math.abs(y) < tol) y = 0;
  else if (Math.abs(y - h) < tol) y = h;
  return { x, y };
}

let cutCounter = 0;
export function newCutId(): string {
  cutCounter += 1;
  return `c${Date.now().toString(36)}${cutCounter.toString(36)}`;
}

/**
 * Turn a knife stroke (inches) into a cut, or null when it is too small or splits nothing.
 * `straight` keeps only the ends (Shift). Panel-mode cuts freeze the path that stops at the
 * boundary of the panels its ends sit in.
 */
export function makeCut(page: Page, stroke: readonly Pt[], mode: CutMode, straight = false): Cut | null {
  let raw = simplify(toProto(stroke), 2);
  if (straight && raw.length >= 2) raw = [raw[0]!, raw[raw.length - 1]!];
  if (raw.length < 2) return null;
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  if (Math.max(...xs) - Math.min(...xs) < 12 && Math.max(...ys) - Math.min(...ys) < 12) return null;
  raw[0] = snapToTrim(raw[0]!, page, 14);
  raw[raw.length - 1] = snapToTrim(raw[raw.length - 1]!, page, 14);
  const cut: Cut = { id: newCutId(), mode, pts: toInches(raw) };
  if (mode === 'panel') {
    const base = basePanelsProto(page, page.cuts);
    const pts = chaikin(raw, layoutOf(page).curve);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const p0 = base.find((p) => pointInPoly(first, p));
    const p1 = base.find((p) => pointInPoly(last, p));
    const dS = outward(pts, true);
    const dE = outward(pts, false);
    const s = (p0 && rayExit(p0, first, dS)) || { x: first.x + dS.x * FAR, y: first.y + dS.y * FAR };
    const e = (p1 && rayExit(p1, last, dE)) || { x: last.x + dE.x * FAR, y: last.y + dE.y * FAR };
    cut.extended = toInches([s, ...pts, e]);
  }
  const before = basePanelsProto(page, page.cuts).length;
  const after = basePanelsProto(page, [...page.cuts, cut]).length;
  return after > before ? cut : null;
}

/** Move a cut along one axis (inches). Panel-mode cuts move their frozen path with it. */
export function shiftCut(c: Cut, axis: 'x' | 'y', d: number): Cut {
  const move = (p: Pt) => (axis === 'x' ? { x: p.x + d, y: p.y } : { x: p.x, y: p.y + d });
  const out: Cut = { ...c, pts: c.pts.map(move) };
  if (c.extended) out.extended = c.extended.map(move);
  return out;
}

export interface NearCut {
  cut: Cut;
  /** Distance, inches. */
  d: number;
  /** Unit normal of the nearest segment. */
  n: Pt;
}

export function nearestCut(page: Page, pt: Pt): NearCut | null {
  let best: NearCut | null = null;
  for (const c of page.cuts) {
    const path = cutPath(c, page);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const L = abx * abx + aby * aby || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / L));
      const d = Math.hypot(pt.x - (a.x + abx * t), pt.y - (a.y + aby * t));
      if (!best || d < best.d) {
        const l = Math.sqrt(L) || 1;
        best = { cut: c, d, n: { x: -aby / l, y: abx / l } };
      }
    }
  }
  return best;
}

/** Space the page's horizontal cuts evenly top to bottom, and its vertical cuts left to right. */
export function evenOut(page: Page): Cut[] {
  const curve = layoutOf(page).curve;
  const groups: Record<'h' | 'v', { c: Cut; mean: number }[]> = { h: [], v: [] };
  for (const c of page.cuts) {
    const path = chaikin(c.pts, curve);
    const a = path[0]!;
    const b = path[path.length - 1]!;
    const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const mean = path.reduce((s, q) => s + (horiz ? q.y : q.x), 0) / path.length;
    groups[horiz ? 'h' : 'v'].push({ c, mean });
  }
  const moved = new Map<string, Cut>();
  for (const key of ['h', 'v'] as const) {
    const arr = groups[key].sort((a, b) => a.mean - b.mean);
    const end = key === 'h' ? page.heightIn : page.widthIn;
    arr.forEach((item, i) => {
      const target = (end * (i + 1)) / (arr.length + 1);
      moved.set(item.c.id, shiftCut(item.c, key === 'h' ? 'y' : 'x', target - item.mean));
    });
  }
  return page.cuts.map((c) => moved.get(c.id) ?? c);
}

export type Preset = 'rows2' | 'grid4' | 'grid6' | 'grid9' | 'splash' | 'tier3';

/** Cuts that seed a classic grid. After that the page is free. */
export function presetCuts(page: Page, preset: Preset): Cut[] {
  const W = page.widthIn;
  const H = page.heightIn;
  const h = (y: number, mode: CutMode = 'across'): Cut => ({ id: newCutId(), mode, pts: [{ x: 0, y }, { x: W, y }] });
  const v = (x: number): Cut => ({ id: newCutId(), mode: 'across', pts: [{ x, y: 0 }, { x, y: H }] });
  switch (preset) {
    case 'splash':
      return [];
    case 'rows2':
      return [h(H / 2)];
    case 'tier3':
      return [h(H / 3), h((2 * H) / 3)];
    case 'grid4':
      return [h(H / 2), v(W / 2)];
    case 'grid6':
      return [h(H / 3), h((2 * H) / 3), v(W / 2)];
    case 'grid9':
      return [h(H / 3), h((2 * H) / 3), v(W / 3), v((2 * W) / 3)];
  }
}

/**
 * Cuts for `n` panels in rows of at most two (Script → Layout). The first row is a single wide
 * establishing panel when `n` is odd. Panel-mode vertical cuts keep each row independent.
 */
export function cutsForCount(page: Page, n: number): Cut[] {
  if (n <= 1) return [];
  const rows: number[] = [];
  let left = n;
  if (n % 2 === 1) {
    rows.push(1);
    left -= 1;
  }
  while (left > 0) {
    rows.push(Math.min(2, left));
    left -= 2;
  }
  const W = page.widthIn;
  const H = page.heightIn;
  const cuts: Cut[] = [];
  for (let r = 1; r < rows.length; r++) {
    const y = (H * r) / rows.length;
    cuts.push({ id: newCutId(), mode: 'across', pts: [{ x: 0, y }, { x: W, y }] });
  }
  const working: Page = { ...page, cuts: [...cuts] };
  rows.forEach((count, r) => {
    if (count < 2) return;
    const y0 = (H * r) / rows.length;
    const y1 = (H * (r + 1)) / rows.length;
    const yMid = (y0 + y1) / 2;
    const stroke = [{ x: W / 2, y: y0 + (yMid - y0) * 0.2 }, { x: W / 2, y: y1 - (y1 - yMid) * 0.2 }];
    const cut = makeCut(working, stroke, 'panel', true);
    if (cut) {
      cuts.push(cut);
      working.cuts.push(cut);
    }
  });
  return cuts;
}
