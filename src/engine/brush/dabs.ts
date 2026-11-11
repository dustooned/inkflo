// Vendored from 2Dope src/brush/dabs.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { evalDynamic, shadeAmount, type BrushSettings, type InputSample } from '../core/brush';
import { hash01 } from '../core/rng';
import { tiltAmount, type StrokePoint } from '../core/stroke';

/** One stamp of the brush tip, in document space. */
export interface Dab {
  x: number;
  y: number;
  /** Diameter in document pixels. */
  size: number;
  /** Coverage 0..1 for this dab. */
  alpha: number;
  /** Pen pressure, retained for paint deposition through the paper texture. */
  pressure: number;
  /** Radians. */
  angle: number;
  roundness: number;
  /** 0 = normal tip, 1 = side-of-pencil shading tip (blended by tilt). */
  shade: number;
}

/** Speed (px/ms) that counts as "fast" (1.0) for speed dynamics. */
const FAST = 3;

/** A smooth, finite-slope taper. Large tips need enough run-up to avoid a blunt cap;
 * on short strokes the two tapers meet without inflating a wide blob in the middle. */
export function taperAt(brush: BrushSettings, distance: number, totalLength = Infinity, diameter = brush.size): number {
  if (totalLength <= 1e-6) return 1; // a tap is a brush mark, not a zero-length hairline
  const start = brush.taperStart > 0 ? Math.max(brush.taperStart, diameter) : 0;
  const end = brush.taperEnd > 0 ? Math.max(brush.taperEnd, diameter) : 0;
  const ease = (x: number) => Math.sin(Math.max(0, Math.min(1, x)) * Math.PI / 2);
  return Math.min(start ? ease(distance / start) : 1, end && Number.isFinite(totalLength) ? ease((totalLength - distance) / end) : 1);
}

/**
 * The taper as a size and an alpha multiplier. `taperShape` keeps the ends thin for longer,
 * `taperSize` sets how thin they get (1 = to a point), `taperOpacity` fades them.
 */
export function taperProfile(brush: BrushSettings, distance: number, totalLength = Infinity, diameter = brush.size): { size: number; alpha: number } {
  let f = taperAt(brush, distance, totalLength, diameter);
  if (f >= 1) return { size: 1, alpha: 1 };
  if (brush.taperShape) f = Math.pow(f, 1 + 2 * brush.taperShape);
  const amount = brush.taperSize ?? 1;
  return { size: 1 - amount * (1 - f), alpha: 1 - (brush.taperOpacity ?? 0) * (1 - f) };
}

/** Conservative bounds also cover the corners of rotating image tips. */
export function dabBounds(d: Dab): { x0: number; y0: number; x1: number; y1: number } {
  const c = Math.abs(Math.cos(d.angle)), s = Math.abs(Math.sin(d.angle)), r = d.size / 2;
  const rx = r * (c + d.roundness * s) + 2, ry = r * (s + d.roundness * c) + 2;
  return { x0: d.x - rx, y0: d.y - ry, x1: d.x + rx, y1: d.y + ry };
}

/**
 * Walks stabilized points and emits dabs at the brush spacing. Incremental: feed points in any
 * chunking and you get the same dabs. Jitter is keyed by (seed, dab index), so a stroke replays
 * identically. `totalLength` enables the end taper (known only when replaying a finished stroke).
 */
export class DabWalker {
  private prev: StrokePoint | null = null;
  private carry = 0;
  private index = 0;
  private traveled = 0;
  private speed = 0;
  private dir = 0;

  constructor(
    private readonly brush: BrushSettings,
    private readonly seed: number,
    private readonly totalLength = Infinity,
  ) {}

  clone(): DabWalker {
    const w = new DabWalker(this.brush, this.seed, this.totalLength);
    w.prev = this.prev ? { ...this.prev } : null;
    w.carry = this.carry;
    w.index = this.index;
    w.traveled = this.traveled;
    w.speed = this.speed;
    w.dir = this.dir;
    return w;
  }

  push(p: StrokePoint): Dab[] {
    const out: Dab[] = [];
    const prev = this.prev;
    if (!prev) {
      this.prev = { ...p };
      const dab = this.make(p);
      out.push(dab);
      this.carry = this.spacingFor(dab.size);
      return out;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      prev.pressure = p.pressure;
      return out;
    }
    const dt = Math.max(1, p.t - prev.t);
    this.speed = this.speed * 0.6 + Math.min(1, len / dt / FAST) * 0.4;
    this.dir = Math.atan2(dy, dx);

    let along = 0;
    while (this.carry <= len - along) {
      along += this.carry;
      const t = along / len;
      const q: StrokePoint = {
        x: prev.x + dx * t,
        y: prev.y + dy * t,
        pressure: prev.pressure + (p.pressure - prev.pressure) * t,
        tiltX: prev.tiltX + (p.tiltX - prev.tiltX) * t,
        tiltY: prev.tiltY + (p.tiltY - prev.tiltY) * t,
        t: prev.t + (p.t - prev.t) * t,
      };
      const dab = this.make(q, this.traveled + along);
      out.push(dab);
      this.carry = this.spacingFor(dab.size);
    }
    this.carry -= len - along;
    this.traveled += len;
    this.prev = { ...p };
    return out;
  }

  /** Close a tapered stroke at its actual last point, even between regular stamp positions. */
  finish(): Dab[] {
    if (!this.prev || !Number.isFinite(this.totalLength) || this.brush.taperEnd <= 0 || this.traveled <= 1e-6) return [];
    return [this.make(this.prev, this.traveled)];
  }

  private spacingFor(size: number): number {
    return Math.max(0.35, this.brush.spacing * Math.max(size, 1));
  }

  private make(p: StrokePoint, distance = 0): Dab {
    const b = this.brush;
    const i = this.index++;
    const s: InputSample = { pressure: p.pressure, tilt: tiltAmount(p), speed: this.speed };
    const ts = b.tiltShade;
    const shade = shadeAmount(ts, p.tiltX, p.tiltY);
    const diameter = b.size * (1 + (ts.size - 1) * shade);
    const taper = taperProfile(b, distance, this.totalLength, diameter);
    const size = Math.max(
      0.5,
      diameter * evalDynamic(b.sizeDyn, s, hash01(this.seed, i, 1)) * taper.size,
    );
    const alpha =
      taper.alpha *
      b.flow *
      evalDynamic(b.flowDyn, s, hash01(this.seed, i, 2)) *
      evalDynamic(b.opacityDyn, s, hash01(this.seed, i, 3)) *
      (1 + (ts.opacity - 1) * shade);
    let x = p.x;
    let y = p.y;
    if (b.scatter > 0) {
      const off = (hash01(this.seed, i, 4) - 0.5) * 2 * b.scatter * size;
      x += -Math.sin(this.dir) * off;
      y += Math.cos(this.dir) * off;
    }
    let angle = (b.angle * Math.PI) / 180 + (b.followDirection ? this.dir : 0);
    let roundness = b.roundness;
    if (shade > 0) {
      // The flat of the lead lies along the direction the pen leans (its azimuth).
      const azimuth = Math.atan2(p.tiltY, p.tiltX);
      let diff = azimuth - angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      angle += diff * shade;
      roundness += (ts.roundness - roundness) * shade;
    }
    return { x, y, size, alpha, pressure: Math.max(0, Math.min(1, p.pressure)), angle, roundness, shade };
  }
}

/** Replay a finished stroke into its dabs (with end taper). */
export function dabsForStroke(brush: BrushSettings, seed: number, points: StrokePoint[], totalLength: number): Dab[] {
  const w = new DabWalker(brush, seed, totalLength);
  const out: Dab[] = [];
  for (const p of points) out.push(...w.push(p));
  out.push(...w.finish());
  return out;
}
