// Vendored from 2Dope src/lettering/geometry.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Caption geometry: fitting text so it sets the balloon size, balloon outlines, tails and shape
 * detection. Pure functions (ported from docs/research/lettering-prototype), no DOM. Text width
 * comes from a measure function the caller supplies.
 */
import type { BalloonLook, BalloonStyle, CaptionTail } from './spec';

export type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const norm = (a: Pt): Pt => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };

// ---------------------------------------------------------------------------------------------
// Fitting: the lettering size is fixed; the text decides the balloon

export interface Fit {
  /** Lines, top to bottom, with their y (relative to the balloon centre) and width. */
  lines: { text: string; y: number; width: number }[];
  /** Balloon half-width and half-height (the text area for boxes and sound effects). */
  a: number;
  b: number;
  /** True when the text needed more room than the frame allows (the caller suggests splitting). */
  tooLong: boolean;
}

export interface FitOptions {
  /** Lettering size, page units. */
  size: number;
  /** Line spacing, 1 = the size. */
  leading: number;
  /** Largest balloon half-width and half-height allowed. */
  maxA: number;
  maxB: number;
  /** Balloon width: multiplies the style's usual width-to-height ratio (1 = usual; wider = fewer, longer lines). */
  aspect?: number;
  /** The balloon's half-width share at a height share (0 = middle, 1 = top or bottom); default an oval. */
  profile?: Profile;
}

/** A balloon's half-width (share of its widest) at a height share u, 0 = middle … 1 = top/bottom. */
export type Profile = (u: number) => number;
export const ovalProfile: Profile = u => (u >= 1 ? 0 : Math.sqrt(1 - u * u));
/** A superellipse: power 2 is an oval, higher is fuller (flatter top and bottom). */
export const superProfile = (n: number): Profile => u => (u >= 1 ? 0 : Math.pow(1 - Math.pow(u, n), 1 / n));

/** The classic roundness of each style when the look does not set one. */
export function lookRound(style: BalloonStyle, look?: BalloonLook): number {
  return look?.round ?? (style === 'speech' || style === 'whisper' ? 2.7 : style === 'thought' ? 2.4 : 2.2);
}
export function lookWobble(style: BalloonStyle, look?: BalloonLook): number {
  return look?.wobble ?? (style === 'speech' || style === 'whisper' ? 0.4 : 0);
}

/**
 * Normalise a drawn or imported outline: centred, stretched to -1…1 on both axes and resampled
 * evenly (so any SVG or hand-drawn loop can be fitted to words like the built-in shapes).
 */
export function normalizeOutline(pts: Pt[], n = 160): [number, number][] {
  if (pts.length < 3) return [];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = (x1 - x0) / 2 || 1, h = (y1 - y0) / 2 || 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const q = pts.map(p => ({ x: (p.x - cx) / w, y: (p.y - cy) / h }));
  return resample([...q, q[0]!], n + 1).slice(0, n).map(p => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]);
}

/**
 * A drawn or imported shape made ready for words (like Area Type: each line gets the shape's width
 * at its height). `orient` turns it so its longest direction runs sideways, the way words read.
 * The result is normalised, then shifted so the middle rows' widths are centred on the words.
 */
export function shapeForText(pts: Pt[], orient = true): [number, number][] {
  let q = pts;
  if (orient && pts.length >= 3) {
    // the principal axis (from the shape's spread) becomes horizontal
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let xx = 0, yy = 0, xy = 0;
    for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    let ang = 0.5 * Math.atan2(2 * xy, xx - yy);
    // a nearly level shape stays as drawn (a slight tilt is often part of the look)
    if (Math.abs(ang) < (6 * Math.PI) / 180) ang = 0;
    const c = Math.cos(-ang), s = Math.sin(-ang);
    q = pts.map(p => ({ x: (p.x - cx) * c - (p.y - cy) * s, y: (p.x - cx) * s + (p.y - cy) * c }));
  }
  const unit = normalizeOutline(q);
  return centreForText(unit);
}

/** Shift a unit outline so the chords of its middle rows are centred on x = 0 (where words go). */
export function centreForText(unit: [number, number][]): [number, number][] {
  const poly = unit.map(([x, y]) => ({ x, y }));
  let sum = 0, n = 0;
  for (let i = -6; i <= 6; i++) {
    const y = (i / 6) * 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j]!, b = poly[(j + 1) % poly.length]!;
      if ((a.y > y) === (b.y > y)) continue;
      const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    if (hi > lo) { sum += (lo + hi) / 2; n++; }
  }
  const dx = n ? sum / n : 0;
  return Math.abs(dx) < 1e-4 ? unit : unit.map(([x, y]) => [Math.round((x - dx) * 1e4) / 1e4, y]);
}

/** Turn a unit outline a quarter turn, or mirror it, then ready it for words again. */
export function turnOutline(unit: [number, number][], how: 'turn' | 'mirror'): [number, number][] {
  const pts = unit.map(([x, y]) => (how === 'turn' ? { x: -y, y: x } : { x: -x, y }));
  return centreForText(normalizeOutline(how === 'mirror' ? pts.reverse() : pts));
}

/**
 * Reshape a unit outline by dragging the point at `index` by (dx, dy) unit lengths; its neighbours
 * follow with a smooth falloff over `reach` of the outline, so the line stays smooth.
 */
export function reshapeOutline(unit: [number, number][], index: number, dx: number, dy: number, reach = 0.12): [number, number][] {
  const n = unit.length, span = Math.max(2, Math.round(n * reach));
  return unit.map(([x, y], i) => {
    const d = Math.min(Math.abs(i - index), n - Math.abs(i - index));
    if (d > span) return [x, y];
    const w = 0.5 * (1 + Math.cos((Math.PI * d) / span));
    const nx = Math.max(-1.5, Math.min(1.5, x + dx * w)), ny = Math.max(-1.5, Math.min(1.5, y + dy * w));
    return [Math.round(nx * 1e4) / 1e4, Math.round(ny * 1e4) / 1e4];
  });
}

/** A custom outline's profile: at each height, the narrower of its left and right extents. */
export function outlineProfile(unit: [number, number][]): Profile {
  const N = 48, table: number[] = [];
  const poly = unit.map(([x, y]) => ({ x, y }));
  const across = (y: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if ((a.y > y) === (b.y > y)) continue;
      const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    return hi > lo ? Math.max(0, Math.min(-lo, hi)) : 0;
  };
  for (let i = 0; i <= N; i++) { const u = i / N; table.push(Math.min(across(u * 0.999), across(-u * 0.999))); }
  // the narrowest from the middle out: text rows must fit wherever the shape pinches
  for (let i = 1; i <= N; i++) table[i] = Math.min(table[i]!, table[i - 1]!);
  return u => { if (u >= 1) return 0; const f = u * N, i = Math.floor(f), t = f - i; return table[i]! * (1 - t) + table[Math.min(N, i + 1)]! * t; };
}

/** The profile words are fitted to, for a style and look. */
export function balloonProfile(style: BalloonStyle, look?: BalloonLook): Profile {
  if (look?.outline && look.outline.length >= 8) return outlineProfile(look.outline);
  if (style === 'box' || style === 'sfx') return u => (u >= 1 ? 0 : 1);
  const n = lookRound(style, look);
  return n === 2 ? ovalProfile : superProfile(n);
}

/** Text width, page units, at the lettering size. */
export type Measure = (text: string) => number;

const ASPECT: Record<BalloonStyle, number> = { speech: 1.5, whisper: 1.5, thought: 1.4, shout: 1.35, box: 2.6, sfx: 1, custom: 1.5 };

/** Lay out text for a balloon style. Explicit line breaks in the text are kept as they are. */
export function fitCaption(text: string, style: BalloonStyle, measure: Measure, o: FitOptions): Fit {
  const lead = o.size * o.leading, K = ASPECT[style] * Math.min(2.5, Math.max(0.5, o.aspect ?? 1)), prof = o.profile ?? ovalProfile;
  const fits = (x: number, y: number, A: number, B: number) => y < B && x <= A * prof(y / B);
  const pad = style === 'shout' ? o.size * 1.4 : style === 'thought' ? o.size * 1.2 : o.size * 0.9;
  const paragraphs = text.split('\n');
  if (style === 'sfx' || paragraphs.length > 1 || !text.trim()) {
    // the student's own lines (or a sound effect): the balloon fits around them
    const lines = paragraphs.map(t => ({ text: t, width: measure(t) }));
    const top = -((lines.length - 1) * lead) / 2, wMax = Math.max(o.size, ...lines.map(l => l.width));
    const out = lines.map((l, i) => ({ ...l, y: top + i * lead }));
    if (style === 'sfx' || style === 'box') return { lines: out, a: wMax / 2 + (style === 'box' ? pad : 0), b: (lines.length * lead) / 2 + (style === 'box' ? pad * 0.7 : 0), tooLong: false };
    // an ellipse around a block of lines: corners of the block must sit inside the inset ellipse
    const hb = (lines.length * lead) / 2, hw = wMax / 2, k = K;
    let b = Math.max(hb + pad, (hw + pad) / k);
    for (let i = 0; i < 80 && !fits(hw, hb, k * b - pad, b - pad); i++) b *= 1.04;
    return { lines: out, a: Math.min(k * b, o.maxA), b: Math.min(b, o.maxB), tooLong: k * b > o.maxA || b > o.maxB };
  }
  const words = text.split(/\s+/).filter(Boolean), W = words.length, wordW = words.map(measure), space = measure(' ');
  // running totals: the width of words i..j-1 on one line in constant time
  const pre = [0];
  for (let k = 0; k < W; k++) pre.push(pre[k]! + wordW[k]!);
  const span = (i: number, j: number) => pre[j]! - pre[i]! + space * Math.max(0, j - i - 1);
  const breakLines = (caps: { y: number; cap: number }[]) => {
    const n = caps.length, INF = Infinity, cost = Array.from({ length: n + 1 }, () => new Array<number>(W + 1).fill(INF)), from = Array.from({ length: n + 1 }, () => new Array<number>(W + 1).fill(-1));
    cost[0]![0] = 0;
    for (let l = 1; l <= n; l++) for (let j = l; j <= W; j++) for (let i = j - 1; i >= l - 1; i--) {
      const w = span(i, j), slack = caps[l - 1]!.cap - w;
      // a longer line (smaller i) only gets wider: stop at the first that overflows
      if (slack < 0) break;
      if (cost[l - 1]![i] === INF) continue;
      const v = cost[l - 1]![i]! + (slack / caps[l - 1]!.cap) ** 2;
      if (v < cost[l]![j]!) { cost[l]![j] = v; from[l]![j] = i; }
    }
    if (cost[n]![W] === INF) return null;
    const lines: Fit['lines'] = [];
    for (let l = n, j = W; l > 0; l--) { const i = from[l]![j]!; lines.unshift({ text: words.slice(i, j).join(' '), width: span(i, j), y: caps[l - 1]!.y }); j = i; }
    return lines;
  };
  const caps = (n: number, a: number, b: number) => {
    const top = -((n - 1) * lead) / 2, out: { y: number; cap: number }[] = [];
    for (let i = 0; i < n; i++) {
      const y = top + i * lead;
      if (style === 'box') { if ((n * lead) / 2 > b - pad * 0.7) return null; out.push({ y, cap: 2 * (a - pad) }); continue; }
      const yy = Math.abs(y) + o.size / 2, u = yy / (b - pad * 0.6);
      if (u >= 1) return null;
      const w = prof(u);
      if (w <= 0) return null;
      out.push({ y, cap: 2 * (a * w - pad) });
    }
    return out;
  };
  let best: (Fit & { area: number }) | null = null;
  const widest = Math.max(...wordW);
  for (let n = 1; n <= Math.min(16, W); n++) {
    // too few lines for the longest line the frame allows: skip without searching
    if (pre[W]! / n > 2 * o.maxA) continue;
    let lo = Math.max(o.size * 0.6, widest / (2 * K)), hi = Math.max(lo * 2, o.maxB * 1.5), found: { a: number; b: number; lines: Fit['lines'] } | null = null;
    for (let it = 0; it < 26; it++) {
      const b = (lo + hi) / 2, a = Math.min(K * b, o.maxA), c = caps(n, a, b), lines = c && breakLines(c);
      if (lines) { found = { a, b, lines }; hi = b; } else lo = b;
    }
    if (!found || found.b > o.maxB) continue;
    const area = found.a * found.b;
    if (!best || area < best.area * 0.97) best = { ...found, area, tooLong: false };
  }
  if (best) return { lines: best.lines, a: best.a, b: best.b, tooLong: false };
  // past the frame: never squeeze the letters; one long line per word group, flagged
  const lines = [{ text, width: measure(text), y: 0 }];
  return { lines, a: o.maxA, b: o.maxB, tooLong: true };
}

// ---------------------------------------------------------------------------------------------
// Balloon outlines (closed, around the centre 0,0)

function hash(seed: number, i: number): number { let x = Math.imul(seed ^ (i * 0x9e3779b1), 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; }

export function balloonOutline(style: BalloonStyle, a: number, b: number, seed = 1, custom?: [number, number][], look?: BalloonLook): Pt[] {
  if (style === 'custom' && custom?.length && !look?.outline) return custom.map(([x, y]) => ({ x, y }));
  const wobble = lookWobble(style, look), phase = [hash(seed, 101) * 6.283, hash(seed, 102) * 6.283, hash(seed, 103) * 6.283];
  // hand-inked: a slow, steady swell (never inward, so the words keep their room)
  const swell = (t: number) => 1 + wobble * (0.03 + 0.018 * Math.sin(t + phase[0]!) + 0.009 * Math.sin(2 * t + phase[1]!) + 0.004 * Math.sin(3 * t + phase[2]!));
  if (look?.outline && look.outline.length >= 8) return look.outline.map(([x, y]) => { const t = Math.atan2(y, x), s = swell(t); return { x: x * a * s, y: y * b * s }; });
  const n0 = lookRound(style, look), e = 2 / n0;
  const base = (t: number): Pt => { const c = Math.cos(t), s = Math.sin(t); return { x: a * Math.sign(c) * Math.pow(Math.abs(c), e), y: b * Math.sign(s) * Math.pow(Math.abs(s), e) }; };
  if (style === 'box') {
    const r = Math.min(a, b) * 0.12, out: Pt[] = [];
    const corner = (cx: number, cy: number, from: number) => { for (let i = 0; i <= 6; i++) { const t = from + (i / 6) * (Math.PI / 2); out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }); } };
    corner(a - r, b - r, 0); corner(-a + r, b - r, Math.PI / 2); corner(-a + r, -b + r, Math.PI); corner(a - r, -b + r, Math.PI * 1.5);
    return out;
  }
  const n = 180;
  if (style === 'thought') {
    // scallops whose size follows the balloon, all bulging outward
    const perim = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))), k = look?.bumps ?? Math.max(6, Math.min(16, Math.round(perim / (Math.min(a, b) * 0.9)))), depth = look?.bumpDepth ?? 0.16;
    return Array.from({ length: n * 2 }, (_, i) => { const t = (i / (n * 2)) * Math.PI * 2, s = (1 + depth * Math.pow(Math.abs(Math.sin((k * t) / 2)), 0.55)) * swell(t), p = base(t); return { x: p.x * s, y: p.y * s }; });
  }
  if (style === 'shout') {
    const spikes = look?.spikes ?? Math.max(10, Math.min(22, Math.round((a + b) / 18))), reach = look?.spikeDepth ?? 0.26, out: Pt[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const t = (i / (spikes * 2)) * Math.PI * 2, r = i % 2 ? 0.96 : 0.96 + reach + (hash(seed, i) - 0.5) * reach * 0.6, p = base(t);
      out.push({ x: p.x * r, y: p.y * r });
    }
    return out;
  }
  return Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2, p = base(t), s = swell(t); return { x: p.x * s, y: p.y * s }; });
}

// ---------------------------------------------------------------------------------------------
// Tails

export function inside(poly: Pt[], p: Pt): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const centroid = (poly: Pt[]) => mul(poly.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / poly.length);

function exitPoint(poly: Pt[], toward: Pt): Pt {
  const c = centroid(poly), d = norm(sub(toward, c));
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!, e = sub(b, a), den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, c), t = (w.x * e.y - w.y * e.x) / den, u = (w.x * d.y - w.y * d.x) / den;
    if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
  }
  return best > 0 ? add(c, mul(d, best)) : toward;
}

function centreline(poly: Pt[], tip: Pt, bend: Pt | null, n = 40): Pt[] {
  const base = exitPoint(poly, bend ?? tip), c = centroid(poly);
  const start = add(base, mul(norm(sub(c, base)), Math.min(dist(c, base) * 0.5, 30)));
  const ctrl = bend ?? mul(add(base, tip), 0.5);
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return { x: u * u * start.x + 2 * u * t * ctrl.x + t * t * tip.x, y: u * u * start.y + 2 * u * t * ctrl.y + t * t * tip.y }; });
}

function wedge(line: Pt[], width: number, taper = 1, tip = 0): { L: Pt[]; R: Pt[] } {
  const L: Pt[] = [], R: Pt[] = [];
  line.forEach((p, i) => {
    const a = line[Math.max(0, i - 1)]!, b = line[Math.min(line.length - 1, i + 1)]!, t = norm(sub(b, a)), nr = { x: -t.y, y: t.x }, u = 1 - i / (line.length - 1);
    // the width along the tail: `taper` bends the narrowing, `tip` leaves a blunt end
    const w = (width / 2) * (tip + (1 - tip) * Math.pow(u, 1 / taper));
    L.push(add(p, mul(nr, w))); R.push(add(p, mul(nr, -w)));
  });
  return { L, R };
}

function crossing(p1: Pt, p2: Pt, poly: Pt[]): { i: number; p: Pt } | null {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!, r = sub(p2, p1), s = sub(b, a), den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, p1), t = (w.x * s.y - w.y * s.x) / den, u = (w.x * r.y - w.y * r.x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { i, p: add(p1, mul(r, t)) };
  }
  return null;
}

function sideExit(side: Pt[], poly: Pt[]): { i: number; p: Pt; k: number } | null {
  for (let k = 1; k < side.length; k++) if (inside(poly, side[k - 1]!) && !inside(poly, side[k]!)) { const c = crossing(side[k - 1]!, side[k]!, poly); if (c) return { ...c, k }; }
  return null;
}

function selfCrosses(p: Pt[]): boolean {
  const n = p.length, o = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = p[i]!, b = p[(i + 1) % n]!, c = p[j]!, d = p[(j + 1) % n]!;
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
  }
  return false;
}

/** The balloon outline with a tail spliced in (no seam), or null when it cannot merge cleanly. */
export function mergeTail(poly: Pt[], tip: Pt, bend: Pt | null, width: number, taper = 1, tipW = 0): Pt[] | null {
  const { L, R } = wedge(centreline(poly, tip, bend), width, taper, tipW);
  const a = sideExit(L, poly), b = sideExit(R, poly);
  if (!a || !b) return null;
  const reenters = (side: Pt[]) => side.some((p, k) => k > 0 && !inside(poly, side[k - 1]!) && inside(poly, p));
  if (reenters(L) || reenters(R)) return null;
  const outL = [a.p, ...L.slice(a.k)], outR = [b.p, ...R.slice(b.k)], n = poly.length;
  const forward = (from: number, to: number) => { const pts: Pt[] = []; for (let i = (from + 1) % n; ; i = (i + 1) % n) { pts.push(poly[i]!); if (i === to || pts.length > n) break; } return pts; };
  const tailPoly = [...outL, ...[...outR].reverse()], under = (pts: Pt[]) => pts.some(p => inside(tailPoly, p));
  const keep1 = forward(b.i, a.i), keep2 = forward(a.i, b.i);
  const useFirst = keep1.length >= keep2.length ? !under(keep1) || under(keep2) : under(keep2);
  const out = useFirst ? [b.p, ...keep1, ...outL, ...[...outR].reverse().slice(1)] : [a.p, ...keep2, ...outR, ...[...outL].reverse().slice(1)];
  // a result that crosses itself falls back to a seam tail
  const step = Math.max(1, Math.floor(out.length / 220));
  return selfCrosses(out.filter((_, i) => i % step === 0)) ? null : out;
}

/** A closed tail drawn over the balloon edge (the seam look), starting just inside the edge. */
/**
 * A tail as its own closed shape. Its base starts well inside the balloon (where the centreline
 * starts), so it always meets the balloon with no gap however it bends or tapers; the renderer draws
 * its outline only outside the balloon, and the balloon's own outline closes it.
 */
export function seamTail(poly: Pt[], tip: Pt, bend: Pt | null, width: number, taper = 1, tipW = 0): Pt[] {
  const { L, R } = wedge(centreline(poly, tip, bend), width, taper, tipW);
  return [...L, ...[...R].reverse()];
}

/** Thought tail: shrinking circles from the edge to the tip. */
export function bubbleTail(poly: Pt[], tip: Pt, bend: Pt | null, width: number, count = 3, shrink = 0.67): (Pt & { r: number })[] {
  const line = centreline(poly, tip, bend, 60), from = Math.max(0, line.findIndex(p => !inside(poly, p)));
  // each bubble is smaller than the one before by `shrink` of the first's size, spread out to the tip
  return Array.from({ length: count }, (_, k) => { const t = count === 1 ? 0.6 : (k + 0.6) / count, p = line[Math.round(from + (line.length - 1 - from) * t)]!; return { ...p, r: Math.max(2, (width / 2) * 0.75 * (1 - (shrink * k) / Math.max(1, count - 1))) }; });
}

/** Radio or phone tail: a zigzag from the edge to the tip. */
export function lightningTail(poly: Pt[], tip: Pt, width: number, zigs = 3, swing = 1): Pt[] {
  const base = exitPoint(poly, tip), d = sub(tip, base), dir = norm(d), nr = { x: -dir.y, y: dir.x }, amp = width * 0.8 * swing;
  return Array.from({ length: zigs * 2 + 1 }, (_, i) => { const t = i / (zigs * 2), p = add(base, mul(d, t)); return i === 0 || i === zigs * 2 ? p : add(p, mul(nr, i % 2 ? amp : -amp)); });
}

/** Everything a caption's balloon draws: the outline (tails merged in) and separate tail shapes. */
/** A lightning tail as a thick bolt: the zigzag widened either side, narrowing to the tip, its base tucked inside. */
export function boltShape(poly: Pt[], zig: Pt[], width: number): Pt[] {
  const c = centroid(poly), base = zig[0]!, inward = norm(sub(c, base)), start = add(base, mul(inward, width * 1.5));
  const line = [start, ...zig], n = line.length, left: Pt[] = [], right: Pt[] = [];
  line.forEach((p, i) => {
    const a = line[Math.max(0, i - 1)]!, b = line[Math.min(n - 1, i + 1)]!, t = norm(sub(b, a)), nr = { x: -t.y, y: t.x }, w = (width / 2) * (1 - i / (n - 1)) + width * 0.04;
    left.push(add(p, mul(nr, w))); right.push(add(p, mul(nr, -w)));
  });
  return [...left, ...right.reverse()];
}

/**
 * Everything a caption's balloon draws: the outline (Joined tails merged in), `joined` tails that
 * could not be merged exactly (drawn into one shared outline with the balloon), `seams` (closed
 * tails and thick bolts, outlined outside the balloon), bubbles, and zigzag lines with their widths.
 */
export interface BalloonShapes { outline: Pt[]; seams: Pt[][]; joined: Pt[][]; bubbles: (Pt & { r: number })[]; zigzags: Pt[][]; zigzagWidths: number[] }

export function balloonShapes(outline: Pt[], tails: CaptionTail[], cx: number, cy: number, size: number): BalloonShapes {
  let poly = outline.map(p => ({ x: p.x + cx, y: p.y + cy }));
  const seams: Pt[][] = [], joined: Pt[][] = [], bubbles: (Pt & { r: number })[] = [], zigzags: Pt[][] = [], zigzagWidths: number[] = [];
  for (const t of tails) {
    const tip = { x: t.x, y: t.y }, bend = t.bend ? { x: t.bend[0], y: t.bend[1] } : null, w = t.width * size;
    if (inside(poly, tip) || t.join === 'none') continue;
    if (t.join === 'bubbles') bubbles.push(...bubbleTail(poly, tip, bend, w * 1.6 * (t.size ?? 1), t.count ?? 3, t.shrink ?? 0.67));
    else if (t.join === 'lightning') {
      const zig = lightningTail(poly, tip, w * 0.5, t.zigs ?? 3, t.amp ?? 1);
      if (t.bolt) seams.push(boltShape(poly, zig, w * 0.45 * (t.line ?? 1)));
      else { zigzags.push(zig); zigzagWidths.push(t.line ?? 1); }
    }
    else {
      const merged = t.join === 'merged' ? mergeTail(poly, tip, bend, w, t.taper ?? 1, t.tip ?? 0) : null;
      // a Joined tail always joins: merged exactly when it can be, otherwise drawn into one shared outline
      if (merged) poly = merged; else (t.join === 'merged' ? joined : seams).push(seamTail(poly, tip, bend, w, t.taper ?? 1, t.tip ?? 0));
    }
  }
  return { outline: poly, seams, joined, bubbles, zigzags, zigzagWidths };
}

// ---------------------------------------------------------------------------------------------
// Shape detection (a drawn closed loop → a balloon style)

function resample(p: Pt[], n: number): Pt[] {
  const L = [0];
  for (let i = 1; i < p.length; i++) L.push(L[i - 1]! + dist(p[i - 1]!, p[i]!));
  const total = L[L.length - 1]!, out: Pt[] = [];
  let k = 1;
  for (let i = 0; i < n; i++) {
    const at = (total * i) / n;
    while (k < p.length - 1 && L[k]! < at) k++;
    const a = p[k - 1]!, b = p[k]!, s = L[k]! - L[k - 1]!, t = s > 0 ? (at - L[k - 1]!) / s : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
function area(p: Pt[]): number { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i]!, r = p[(i + 1) % p.length]!; a += q.x * r.y - r.x * q.y; } return Math.abs(a) / 2; }
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y), cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), lo: Pt[] = [], hi: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function minRectArea(h: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!, b = h[(i + 1) % h.length]!, l = dist(a, b) || 1, ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of h) { const u = q.x * ux + q.y * uy, v = -q.x * uy + q.y * ux; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    best = Math.min(best, (x1 - x0) * (y1 - y0));
  }
  return best;
}
function bigPeaks(r: number[], prom: number): number {
  const n = r.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = r[i]!;
    if (!(v >= r[(i - 1 + n) % n]! && v > r[(i + 1) % n]!)) continue;
    let left = v, right = v;
    for (let j = 1; j < n / 2; j++) { const w = r[(i - j + n) % n]!; if (w > v) break; left = Math.min(left, w); }
    for (let j = 1; j < n / 2; j++) { const w = r[(i + j) % n]!; if (w > v) break; right = Math.min(right, w); }
    if (v - Math.max(left, right) >= prom) count++;
  }
  return count;
}

export type Detected = 'open' | 'speech' | 'box' | 'thought' | 'shout' | 'custom';

/** What a drawn stroke is as a balloon. Over 1,800 synthetic sloppy drawings this was 97–99% right. */
export function detectBalloon(raw: Pt[]): Detected {
  if (raw.length < 8) return 'open';
  let len = 0;
  for (let i = 1; i < raw.length; i++) len += dist(raw[i - 1]!, raw[i]!);
  if (len < 20 || dist(raw[0]!, raw[raw.length - 1]!) > len * 0.18) return 'open';
  const N = 256, p = resample(raw, N), cx = p.reduce((s, q) => s + q.x, 0) / N, cy = p.reduce((s, q) => s + q.y, 0) / N;
  const r0 = p.map(q => Math.hypot(q.x - cx, q.y - cy)), mean = r0.reduce((a, b) => a + b, 0) / N;
  const r = r0.map((_, i) => { let s = 0; for (let k = -2; k <= 2; k++) s += r0[(i + k + N) % N]!; return s / 5 / mean; });
  const h = hull(p), a = area(p), solidity = a / area(h), rectFill = a / minRectArea(h), big = bigPeaks(r, 0.18);
  const sm = p.map((_, i) => { let x = 0, y = 0; for (let k = -3; k <= 3; k++) { const q = p[(i + k + N) % N]!; x += q.x; y += q.y; } return { x: x / 7, y: y / 7 }; });
  let signed = 0;
  for (let i = 0; i < N; i++) { const q = sm[i]!, w = sm[(i + 1) % N]!; signed += q.x * w.y - w.x * q.y; }
  const orient = signed >= 0 ? 1 : -1, S = 4;
  const turn = sm.map((_, i) => { const A = sm[(i - S + N) % N]!, B = sm[i]!, C = sm[(i + S) % N]!, t = Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(B.y - A.y, B.x - A.x); return orient * Math.atan2(Math.sin(t), Math.cos(t)); });
  const straight = turn.filter(t => Math.abs(t) < 0.035).length / N;
  let dents = 0, inDent = false;
  for (let i = 0; i < N; i++) { const d = turn[i]! < -0.06; if (d && !inDent) dents++; inDent = d; }
  if (inDent && turn[0]! < -0.06 && dents > 1) dents--;
  if (big >= 5 && solidity < 0.86) return 'shout';
  if (straight >= 0.26 && solidity >= 0.95 && rectFill >= 0.88) return 'box';
  if (dents >= 6 && dents <= 20 && solidity > 0.88 && straight < 0.1) return 'thought';
  if (solidity >= 0.985 && rectFill >= 0.74 && rectFill < 0.84 && dents <= 4) return 'speech';
  return 'custom';
}

// ---------------------------------------------------------------------------------------------
// Turning a drawn balloon into a caption

/** A balloon read from a drawing: its style, centre and size, a custom outline if needed, and a tail tip. */
export interface ReadBalloon {
  style: BalloonStyle;
  centre: Pt;
  width: number;
  height: number;
  /** Balloon width setting that keeps the drawn proportions (CaptionSpec.shape). */
  shape: number;
  outline?: [number, number][];
  tail?: Pt;
}

/**
 * Read a balloon from the outline of a drawing (a vector line or a traced painted shape). A spike
 * that reaches well past the rest of the outline is its tail: the tip is kept and the spike is cut
 * from the balloon. The rest is recognised like a drawn balloon (speech, box, thought, shout or a
 * custom shape that still fits the words). Null when it is not a closed shape.
 */
export function readBalloon(raw: Pt[]): ReadBalloon | null {
  if (raw.length < 8) return null;
  // an open line (its ends far apart) is not a balloon
  let travel = 0;
  for (let i = 1; i < raw.length; i++) travel += dist(raw[i - 1]!, raw[i]!);
  if (travel < 20 || dist(raw[0]!, raw[raw.length - 1]!) > travel * 0.18) return null;
  const pts = resample([...raw, raw[0]!], 240).slice(0, 240), n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n, cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const r = pts.map(p => Math.hypot(p.x - cx, p.y - cy)), sorted = [...r].sort((a, b) => a - b), med = sorted[Math.floor(n / 2)]!;
  // the tail: the one sharp point that sticks out (a turn over 110° within a short stretch, reaching
  // past the typical radius). Box corners turn 90°; a shout has many sharp points and keeps them all.
  const k = Math.max(3, Math.round(n / 48));
  const turnAt = (i: number) => {
    const a = pts[(i - k + n) % n]!, b = pts[i]!, c = pts[(i + k) % n]!;
    const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: c.x - b.x, y: c.y - b.y };
    return Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y));
  };
  const sharp: number[] = [];
  for (let i = 0; i < n; i++) if (r[i]! > med * 1.2 && turnAt(i) > (110 * Math.PI) / 180 && r[i]! >= r[(i - 1 + n) % n]! && r[i]! >= r[(i + 1) % n]!) sharp.push(i);
  // neighbouring hits are one spike
  const spikes = sharp.filter((i, j) => j === 0 || i - sharp[j - 1]! > k);
  let tail: Pt | undefined, body = pts;
  if (spikes.length >= 1 && spikes.length <= 2) {
    const tip = spikes.reduce((best, i) => (r[i]! > r[best]! ? i : best), spikes[0]!);
    tail = { ...pts[tip]! };
    // cut the spike back along its sides to the corners where it meets the balloon (the sides run
    // fairly straight; the base is a sharp turn the other way)
    const signedTurn = (i: number) => {
      const p0 = pts[(i - k + n) % n]!, p1 = pts[i]!, p2 = pts[(i + k) % n]!;
      return Math.atan2((p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x), (p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y));
    };
    const tipSign = Math.sign(signedTurn(tip)), corner = (35 * Math.PI) / 180;
    let a = (tip - k + n) % n, b = (tip + k) % n;
    for (let q = 0; q < n / 5 && !(Math.sign(signedTurn(a)) === -tipSign && Math.abs(signedTurn(a)) > corner); q++) a = (a - 1 + n) % n;
    for (let q = 0; q < n / 5 && !(Math.sign(signedTurn(b)) === -tipSign && Math.abs(signedTurn(b)) > corner); q++) b = (b + 1) % n;
    const cut = new Set<number>();
    for (let i = a; ; i = (i + 1) % n) { cut.add(i); if (i === b) break; }
    body = pts.filter((_, i) => !cut.has(i));
  }
  const kind = detectBalloon(resample([...body, body[0]!], 200));
  if (kind === 'open') return null;
  const xs = body.map(p => p.x), ys = body.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const width = x1 - x0, height = y1 - y0, style: BalloonStyle = kind === 'custom' ? 'custom' : kind;
  return {
    style, centre: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, width, height,
    shape: Math.round(Math.min(2.5, Math.max(0.5, width / Math.max(1, height) / ASPECT[style])) * 100) / 100,
    ...(style === 'custom' ? { outline: shapeForText(body, false) } : {}),
    ...(tail ? { tail } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Sound effects on a path

/**
 * The path the letters follow, as points around the caption's centre (page units). Arcs and
 * waves are made to the words' length (`span`); a drawn path is used as drawn.
 */
export function textPath(curve: { kind: 'arc' | 'wave'; bend: number } | { kind: 'drawn'; points: [number, number][] }, span: number, size: number): Pt[] {
  if (curve.kind === 'drawn') return curve.points.map(([x, y]) => ({ x, y }));
  const n = 48, half = (span * 1.04) / 2, out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = -half + 2 * half * t;
    // an arc bulges up for a positive bend; a wave swings one and a half times along the words
    const y = curve.kind === 'arc' ? -curve.bend * span * 0.45 * (1 - (2 * t - 1) ** 2) + curve.bend * span * 0.225 : -curve.bend * size * 1.4 * Math.sin(Math.PI * 3 * t);
    out.push({ x, y });
  }
  return out;
}

/** Where along a path a distance falls: the point and the direction (radians). Past either end it carries on straight. */
export function alongPath(path: Pt[], d: number): { x: number; y: number; angle: number } {
  const seg = (i: number) => ({ a: path[i]!, b: path[i + 1]! });
  if (path.length < 2) return { x: path[0]?.x ?? 0, y: path[0]?.y ?? 0, angle: 0 };
  if (d <= 0) { const { a, b } = seg(0), l = dist(a, b) || 1; return { x: a.x + ((b.x - a.x) / l) * d, y: a.y + ((b.y - a.y) / l) * d, angle: Math.atan2(b.y - a.y, b.x - a.x) }; }
  let walked = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const { a, b } = seg(i), l = dist(a, b);
    if (walked + l >= d || i === path.length - 2) {
      const t = l ? (d - walked) / l : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    walked += l;
  }
  return { x: path[0]!.x, y: path[0]!.y, angle: 0 };
}

export function pathLength(path: Pt[]): number { let n = 0; for (let i = 1; i < path.length; i++) n += dist(path[i - 1]!, path[i]!); return n; }

/** A closed band around a path, `r` either side (the caption's area for selecting and moving it). */
export function pathBand(path: Pt[], r: number): Pt[] {
  if (path.length < 2) return [];
  const left: Pt[] = [], right: Pt[] = [];
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, i + 1)]!, t = norm(sub(b, a)), nr = { x: -t.y, y: t.x };
    left.push(add(p, mul(nr, r))); right.push(add(p, mul(nr, -r)));
  });
  return [...left, ...right.reverse()];
}
