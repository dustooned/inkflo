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
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS) return null;
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const tp = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const tu = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (tp < -1e-9 || tp > 1 + 1e-9 || tu < -1e-9 || tu > 1 + 1e-9) return null;
  const t = Math.max(0, Math.min(1, tp));
  return { x: a.x + t * r.x, y: a.y + t * r.y, tp: t, tu: Math.max(0, Math.min(1, tu)) };
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
  const i0 = Math.min(n - 1, Math.floor(s0));
  const i1 = Math.min(n - 1, Math.floor(s1));
  const t0 = s0 - i0;
  const t1 = s1 - i1;
  const lerp = (i: number, t: number): Pt => ({ x: path[i]!.x + (path[i + 1]!.x - path[i]!.x) * t, y: path[i]!.y + (path[i + 1]!.y - path[i]!.y) * t });
  const pA = lerp(i0, t0);
  const pB = lerp(i1, t1);
  if (i0 === i1) return [pA, pB];
  const out = [pA];
  for (let i = i0 + 1; i <= i1; i++) out.push({ ...path[i]! });
  if (dist(out[out.length - 1]!, pB) > 1e-6) out.push(pB);
  return out;
}

interface Crossing {
  pt: Pt;
  edge: number;
  edgeT: number;
  s: number;
}

function walk(poly: readonly Pt[], from: Crossing, to: Crossing): Pt[] {
  const n = poly.length;
  if (from.edge === to.edge && from.edgeT <= to.edgeT) return [from.pt, to.pt];
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

const EPS = 1e-6;

function onBoundary(p: Pt, poly: readonly Pt[]): boolean {
  return poly.some((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) <= EPS * Math.hypot(dx, dy) &&
      p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
      p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
  });
}

function insideStrict(p: Pt, poly: readonly Pt[]): boolean {
  return pointInPoly(p, poly) && !onBoundary(p, poly);
}

function cleanPath(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (!out.length || dist(out.at(-1)!, p) > EPS) out.push(p);
  return out;
}

function simplePath(path: Pt[]): boolean {
  for (let i = 1; i < path.length; i++) {
    for (let j = i + 2; j < path.length; j++) {
      if (segInt(path[i - 1]!, path[i]!, path[j - 1]!, path[j]!)) return false;
    }
  }
  return true;
}

/** Find the first continuous, interior span that really divides this polygon. */
function splitOnce(poly: Pt[], path: readonly Pt[], after = 0, at?: number) {
  const ins: Crossing[] = [];
  for (let j = Math.floor(after); j < path.length - 1; j++) {
    for (let i = 0; i < poly.length; i++) {
      const r = segInt(path[j]!, path[j + 1]!, poly[i]!, poly[(i + 1) % poly.length]!);
      if (!r) continue;
      const pt = { x: r.x, y: r.y };
      const s = j + r.tp;
      if (s < after - EPS || ins.some((q) => Math.abs(q.s - s) < EPS)) continue;
      ins.push({ pt, edge: i, edgeT: r.tu, s });
    }
  }
  ins.sort((a, b) => a.s - b.s);
  for (let i = 1; i < ins.length; i++) {
    const a = ins[i - 1]!;
    const b = ins[i]!;
    if ((at !== undefined && (at < a.s - EPS || at > b.s + EPS)) || dist(a.pt, b.pt) < 1) continue;
    const chain = cleanPath(subPath(path, a.s, b.s));
    if (chain.length < 2 || !chain.slice(1).every((p, j) => insideStrict({ x: (p.x + chain[j]!.x) / 2, y: (p.y + chain[j]!.y) / 2 }, poly))) continue;
    if (!simplePath(chain)) continue;
    const pieces = [walk(poly, a, b).concat([...chain].reverse()), walk(poly, b, a).concat(chain)].map((points) => {
      const clean = cleanPath(points);
      if (dist(clean[0]!, clean.at(-1)!) < EPS) clean.pop();
      return clean;
    });
    if (pieces.some((p) => p.length < 3 || area(p) * Math.sign(area(poly)) <= 2)) continue;
    return { pieces, chain, end: b.s };
  }
  return null;
}

function divide(poly: Pt[], path: readonly Pt[], gutters: Pt[][]): Pt[][] {
  const pending = [{ poly, after: 0 }];
  const pieces: Pt[][] = [];
  while (pending.length) {
    const item = pending.pop()!;
    const split = splitOnce(item.poly, path, item.after);
    if (!split) { pieces.push(item.poly); continue; }
    gutters.push(split.chain);
    for (const part of split.pieces) pending.push({ poly: part, after: split.end });
  }
  return pieces;
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
  return extendEnds(simplify(chaikin(toProto(c.pts), curve), 0.65));
}

/** The stored cut's construction path, including extensions, in inches. */
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

export interface GutterPath { cut: Cut; points: Pt[] }

interface CarvedPage { polys: Pt[][]; gutters: GutterPath[] }
const cache = new WeakMap<Page, { key: string; value: CarvedPage }>();

function carvePage(page: Page): CarvedPage {
  const curve = layoutOf(page).curve;
  const key = JSON.stringify([page.widthIn, page.heightIn, curve, page.cuts]);
  const cached = cache.get(page);
  if (cached?.key === key) return cached.value;
  let ps: Pt[][] = [trimProto(page)];
  const gutters: GutterPath[] = [];
  for (const cut of page.cuts) {
    const path = cutPathProto(cut, curve);
    const boundaries: Pt[][] = [];
    ps = ps.flatMap((poly) => divide(poly, path, boundaries));
    for (const pts of boundaries) gutters.push({ cut, points: toInches(pts) });
  }
  const value = { polys: readingOrder(ps), gutters };
  cache.set(page, { key, value });
  return value;
}

/** Only paths that divide panels. Rendering, fill masks and hit testing use these same spans. */
export function gutterPaths(page: Page): readonly GutterPath[] {
  return carvePage(page).gutters;
}

/** Fold the page's cuts into panels, in reading order. Never stored. */
export function derivePanels(page: Page): Panel[] {
  return carvePage(page).polys.map((poly, index) => {
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
 * `straight` keeps only the ends (Shift). Panel-mode cuts freeze the first valid span within
 * the panel where the stroke started.
 */
export function planCut(page: Page, stroke: readonly Pt[], mode: CutMode, straight = false): { cut: Omit<Cut, 'id'>; paths: Pt[][] } | null {
  let raw = simplify(toProto(stroke), 2);
  if (straight && raw.length >= 2) raw = [raw[0]!, raw[raw.length - 1]!];
  if (raw.length < 2) return null;
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  if (Math.max(...xs) - Math.min(...xs) < 12 && Math.max(...ys) - Math.min(...ys) < 12) return null;
  raw[0] = snapToTrim(raw[0]!, page, 14);
  raw[raw.length - 1] = snapToTrim(raw[raw.length - 1]!, page, 14);
  const cut: Omit<Cut, 'id'> = { mode, pts: toInches(raw) };
  const { polys } = carvePage(page);
  const path = cutPathProto({ id: '', ...cut }, layoutOf(page).curve);
  if (mode === 'panel') {
    const first = path[1]!;
    const next = path[2]!;
    const probe = { x: first.x + (next.x - first.x) * 0.001, y: first.y + (next.y - first.y) * 0.001 };
    const panel = polys.find((poly) => insideStrict(first, poly)) ?? polys.find((poly) => insideStrict(probe, poly));
    const span = panel && splitOnce(panel, path, 0, 1);
    if (!span) return null;
    cut.extended = toInches(span.chain);
    return { cut, paths: [cut.extended] };
  }
  const boundaries: Pt[][] = [];
  for (const poly of polys) divide(poly, path, boundaries);
  return boundaries.length ? { cut, paths: boundaries.map(toInches) } : null;
}

export function makeCut(page: Page, stroke: readonly Pt[], mode: CutMode, straight = false): Cut | null {
  const plan = planCut(page, stroke, mode, straight);
  return plan ? { id: newCutId(), ...plan.cut } : null;
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
  /** Nearest point on the shared boundary. */
  at: Pt;
  /** Distance, inches. */
  d: number;
  /** Unit normal of the nearest segment. */
  n: Pt;
}

export function nearestCut(page: Page, pt: Pt): NearCut | null {
  let best: NearCut | null = null;
  for (const { cut, points: path } of gutterPaths(page)) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const L = abx * abx + aby * aby || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / L));
      const at = { x: a.x + abx * t, y: a.y + aby * t };
      const d = dist(pt, at);
      if (!best || d < best.d) {
        const l = Math.sqrt(L) || 1;
        best = { cut, at, d, n: { x: -aby / l, y: abx / l } };
      }
    }
  }
  return best;
}

function gridAxis(c: Cut): 'x' | 'y' | undefined {
  if (c.mode !== 'across') return;
  const first = c.pts[0]!;
  if (c.pts.every((p) => Math.abs(p.x - first.x) < 1e-6)) return 'x';
  if (c.pts.every((p) => Math.abs(p.y - first.y) < 1e-6)) return 'y';
}

export function canEvenOut(page: Page): boolean {
  const axes = page.cuts.map(gridAxis);
  return axes.length >= 2 && axes.every(Boolean) && new Set(gutterPaths(page).map(({ cut }) => cut.id)).size === axes.length;
}

/** Even spacing for complete rectangular grids. Irregular layouts keep their junctions. */
export function evenOut(page: Page): Cut[] {
  if (!canEvenOut(page)) return page.cuts;
  const moved = new Map<string, Cut>();
  for (const axis of ['x', 'y'] as const) {
    const arr = page.cuts.filter((c) => gridAxis(c) === axis).sort((a, b) => a.pts[0]![axis] - b.pts[0]![axis]);
    const end = axis === 'y' ? page.heightIn : page.widthIn;
    arr.forEach((cut, i) => {
      const target = (end * (i + 1)) / (arr.length + 1);
      moved.set(cut.id, shiftCut(cut, axis, target - cut.pts[0]![axis]));
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
