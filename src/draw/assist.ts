import type { Pt } from '../doc/model';
import { hash01 } from '../engine/core/rng';
import { pointInPoly } from '../geom/carve';

/**
 * Drawing assist (EXPLORE-DESK-UI §4): Procreate-style rulers with Lazy Nezumi's "accuracy"
 * (strength), and CSP-style focus/speed line generators. Pure geometry, units of the caller.
 */

export type RulerKind = 'off' | 'straight' | 'parallel' | 'radial' | 'perspective';

export interface Ruler {
  kind: RulerKind;
  /** Parallel: the lines' angle, degrees. */
  angle: number;
  /** Radial: the centre lines run toward. */
  center: Pt;
  /** Perspective: one or two vanishing points. */
  vps: Pt[];
  /** Perspective: also offer vertical lines (2-point). */
  vertical: boolean;
  /** 1 = exactly on the ruler; lower keeps some of the hand's wobble (Nezumi's accuracy). */
  strength: number;
}

export const DEFAULT_RULER: Ruler = { kind: 'off', angle: 0, center: { x: 3.3, y: 5 }, vps: [{ x: -2, y: 4 }, { x: 8.6, y: 4 }], vertical: true, strength: 1 };

const norm = (x: number, y: number): Pt => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

/** Candidate directions at the stroke's start (unit vectors). */
function directions(r: Ruler, start: Pt): Pt[] {
  switch (r.kind) {
    case 'parallel':
      return [{ x: Math.cos((r.angle * Math.PI) / 180), y: Math.sin((r.angle * Math.PI) / 180) }];
    case 'radial':
      return [norm(start.x - r.center.x, start.y - r.center.y)];
    case 'perspective':
      return [...r.vps.map((v) => norm(start.x - v.x, start.y - v.y)), ...(r.vertical ? [{ x: 0, y: 1 }] : [])];
    default:
      return [];
  }
}

/**
 * Locks a stroke to a ruler line. Points are buffered until the pen has moved `lockDist`, then the
 * line through the start that best matches the motion is chosen (Nezumi's auto-axis), and every
 * point is pulled onto it by `strength`. Extra fields on points (pressure, tilt, time) are kept.
 */
export class AssistLock<P extends Pt> {
  private dir: Pt | null = null;
  private pending: P[] = [];

  constructor(
    private readonly ruler: Ruler,
    private readonly start: Pt,
    private readonly lockDist: number,
  ) {}

  get active(): boolean {
    return this.ruler.kind !== 'off';
  }

  /** Feed a point; returns the points ready to draw (possibly none while choosing the line). */
  push(p: P): P[] {
    if (!this.active) return [p];
    if (!this.dir) {
      this.pending.push(p);
      const moved = Math.hypot(p.x - this.start.x, p.y - this.start.y);
      if (moved < this.lockDist) return [];
      const motion = norm(p.x - this.start.x, p.y - this.start.y);
      const cands = this.ruler.kind === 'straight' ? [motion] : directions(this.ruler, this.start);
      this.dir = cands.reduce((best, d) => (Math.abs(d.x * motion.x + d.y * motion.y) > Math.abs(best.x * motion.x + best.y * motion.y) ? d : best), cands[0] ?? motion);
      const out = this.pending.map((q) => this.project(q));
      this.pending = [];
      return out;
    }
    return [this.project(p)];
  }

  /** Points still held back (a stroke too short to choose a line): returned as drawn. */
  flush(): P[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  private project(p: P): P {
    const d = this.dir!;
    const t = (p.x - this.start.x) * d.x + (p.y - this.start.y) * d.y;
    const qx = this.start.x + d.x * t;
    const qy = this.start.y + d.y * t;
    const s = this.ruler.strength;
    return { ...p, x: p.x + (qx - p.x) * s, y: p.y + (qy - p.y) * s };
  }
}

// ---------------------------------------------------------------------------------------------
// Line generators (comic-specific; like Clip Studio's speed and focus line tools)

export interface GenLine {
  pts: Pt[];
  pressure: number[];
}

/** Where a ray from `o` along `d` leaves a polygon (the farthest crossing), or null. */
function exitDistance(poly: readonly Pt[], o: Pt, d: Pt): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t > 1e-9 && u >= 0 && u <= 1 && (best === null || t > best)) best = t;
  }
  return best;
}

export interface FocusOptions {
  /** How many lines. */
  count: number;
  /** Clear zone around the centre, as a share of the distance to the panel edge (0–0.95). */
  inner: number;
  /** Randomness of angle and length, 0–1. */
  jitter: number;
  seed: number;
}

/**
 * Focus (concentrated) lines: rays from the panel's edge toward a centre, thick at the edge and
 * tapering to a point, stopping short of a clear zone. Only rays that start inside the panel.
 */
export function focusLines(panel: readonly Pt[], center: Pt, o: FocusOptions): GenLine[] {
  const out: GenLine[] = [];
  const n = Math.max(1, Math.round(o.count));
  for (let i = 0; i < n; i++) {
    const a = ((i + (hash01(o.seed, i, 1) - 0.5) * o.jitter) / n) * Math.PI * 2;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const far = exitDistance(panel, center, d);
    if (far === null) continue;
    const inner = far * Math.max(0, Math.min(0.95, o.inner * (1 + (hash01(o.seed, i, 2) - 0.5) * o.jitter * 0.8)));
    const outer = far * 1.02; // just past the border: the gutter covers the end
    if (outer - inner < far * 0.04) continue;
    out.push({ pts: [{ x: center.x + d.x * outer, y: center.y + d.y * outer }, { x: center.x + d.x * inner, y: center.y + d.y * inner }], pressure: [1, 0.05] });
  }
  return out;
}

export interface SpeedOptions {
  count: number;
  /** Randomness of spacing and length, 0–1. */
  jitter: number;
  /** Share of the panel's width a line covers, 0.2–1. */
  length: number;
  seed: number;
}

/**
 * Speed lines: parallel strokes across a panel at an angle, tapering at both ends, with jittered
 * spacing and length.
 */
export function speedLines(panel: readonly Pt[], angleDeg: number, o: SpeedOptions): GenLine[] {
  const d = { x: Math.cos((angleDeg * Math.PI) / 180), y: Math.sin((angleDeg * Math.PI) / 180) };
  const nrm = { x: -d.y, y: d.x };
  const xs = panel.map((p) => p.x * nrm.x + p.y * nrm.y);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const ts = panel.map((p) => p.x * d.x + p.y * d.y);
  const tlo = Math.min(...ts);
  const n = Math.max(1, Math.round(o.count));
  const out: GenLine[] = [];
  for (let i = 0; i < n; i++) {
    const s = lo + ((i + 0.5 + (hash01(o.seed, i, 3) - 0.5) * o.jitter) / n) * (hi - lo);
    // a point on this line far behind the panel, then where it enters and leaves
    const o0 = { x: nrm.x * s + d.x * (tlo - 1), y: nrm.y * s + d.y * (tlo - 1) };
    const enter = exitDistanceFirst(panel, o0, d);
    const leave = exitDistance(panel, o0, d);
    if (enter === null || leave === null || leave - enter < 1e-6) continue;
    const span = leave - enter;
    const len = span * Math.max(0.2, Math.min(1, o.length * (1 - hash01(o.seed, i, 4) * o.jitter * 0.6)));
    const startAt = enter + (span - len) * hash01(o.seed, i, 5);
    const a = { x: o0.x + d.x * startAt, y: o0.y + d.y * startAt };
    const b = { x: o0.x + d.x * (startAt + len), y: o0.y + d.y * (startAt + len) };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!pointInPoly(mid, panel)) continue;
    out.push({ pts: [a, mid, b], pressure: [0.05, 1, 0.05] });
  }
  return out;
}

/** Where a ray first enters a polygon (the nearest crossing), or null. */
function exitDistanceFirst(poly: readonly Pt[], o: Pt, d: Pt): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t > 1e-9 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}
