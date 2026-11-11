// Vendored from 2Dope src/core/brush.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Brush settings: a plain, serializable parameter bag (the native brush format is this JSON).
 * Every dynamic parameter uses the same `Dynamic` shape, so pressure, tilt and speed can drive
 * any of them (see docs/feature-deconstruction 02 and 06).
 */

import type { VectorStyle } from './vectorstyle';
export type Control = 'off' | 'pressure' | 'tilt' | 'speed';

export interface Dynamic {
  control: Control;
  /** Output when the input is 0 (0..1). */
  min: number;
  /** Response curve exponent: 1 linear, <1 soft (reaches full early), >1 firm. */
  curve: number;
  /** Random reduction per dab (0..1), seeded. */
  jitter: number;
  invert: boolean;
  /**
   * A response curve as points (input, output), both 0..1, input ascending (Procreate's pressure
   * curves). Replaces `curve` when present (then `invert` flips the curve's output); older builds
   * ignore it and use `curve`.
   */
  points?: [number, number][];
}

/**
 * Shading with the side of the pencil. Past `threshold` degrees of tilt the brush blends into a
 * second, broader, softer, lighter tip that leans with the pen and shows more paper grain.
 */
export interface TiltShade {
  enabled: boolean;
  /** Tilt (degrees from upright) where shading starts; full shading 20° later. */
  threshold: number;
  /** Size multiplier at full shading. */
  size: number;
  /** Opacity multiplier at full shading. */
  opacity: number;
  /** Tip roundness at full shading (flat side of the lead). */
  roundness: number;
  /** Tip hardness at full shading. */
  hardness: number;
  /** Paper grain strength for the shaded part. */
  grain: number;
}

export interface BrushSettings {
  /** Missing = the original vector outline when used with the Vector pen. */
  vectorStyle?: VectorStyle;
  name: string;
  /**
   * An image tip (Procreate's shape source): a small PNG as a data URL. White (or opaque) paints,
   * black (or transparent) does not. Missing = the round tip. Raster brushes only.
   */
  tipImage?: string;
  /**
   * A grain picture (Procreate's grain source) as a small PNG data URL, tiled across the paper:
   * white lets paint through, black holds it back. Missing = the built-in paper grain.
   */
  grainImage?: string;
  /** Colour dynamics (Procreate): hue, saturation and brightness vary, 0..1 each. */
  hueJitter?: number;
  satJitter?: number;
  brightJitter?: number;
  /** The colour varies once per stroke instead of on every dab. */
  strokeColor?: boolean;
  /** Wet mix pull (Procreate): how much of the colour already on the canvas the brush picks up, 0..1. */
  wetPull?: number;
  /** Diameter in document pixels. */
  size: number;
  /** Edge hardness 0 (soft) .. 1 (hard). */
  hardness: number;
  /** Dab spacing as a fraction of the dab diameter. */
  spacing: number;
  /** Stroke opacity ceiling (0..1). The stroke composites once at this opacity. */
  opacity: number;
  /** Per-dab coverage (0..1). Builds up within a stroke towards the opacity ceiling. */
  flow: number;
  /** Tip roundness 0.05..1 (1 = circle). */
  roundness: number;
  /** Tip angle in degrees. */
  angle: number;
  /** Rotate the tip to follow the stroke direction. */
  followDirection: boolean;
  sizeDyn: Dynamic;
  opacityDyn: Dynamic;
  flowDyn: Dynamic;
  /** Perpendicular scatter as a multiple of the dab size. */
  scatter: number;
  /** Paper grain strength 0..1 (each dab deposits pigment through the paper texture). */
  grain: number;
  /** Grain texture scale (1 = 256 px tile). */
  grainScale: number;
  /** Taper length at the start / end of a stroke, in document pixels. */
  taperStart: number;
  taperEnd: number;
  /** How thin the taper ends get, 0..1 (missing = 1: down to a point). */
  taperSize?: number;
  /** How much the taper ends fade, 0..1 (missing = 0). */
  taperOpacity?: number;
  /** Tip sharpness 0..1: higher keeps the ends thin for longer (missing = 0, the soft ease). */
  taperShape?: number;
  /**
   * How the grain picture holds paint back. Missing = multiply (the grain darkens coverage by its
   * depth). 'height': the grain is a height map; paint misses the valleys deeper than the depth.
   */
  grainMode?: 'height';
  /** Grain depth at the firmest press, 0..1 (Procreate's depth minimum; missing = 0). */
  grainMin?: number;
  /** How far the grain stays on the paper, 0..1: 1 (or missing) = fixed to the canvas, 0 = rolls with the stroke. */
  grainMovement?: number;
  /** Grain rotation in degrees. */
  grainRotation?: number;
  /** 0..1: how much the grain scale follows the brush size (from `grainRef`). */
  grainFollow?: number;
  /** The brush size the grain scale was set at (for `grainFollow`). */
  grainRef?: number;
  /** Stabilizer amount 0..1. */
  smoothing: number;
  /** Pulled-string (lazy mouse) stabilizer instead of exponential smoothing. */
  pulledString: boolean;
  tiltShade: TiltShade;
  /** Soft (anti-aliased) edges. Off = hard pixel edges, so fills lock tight to the line. Default on. */
  antiAlias?: boolean;
  /** Post-correction 0..1: smooth the stroke after the pen lifts (0 = off). */
  postSmooth?: number;
  /** Procreate-style Stabilisation 0..1: steadies fast strokes (a time-window average). */
  stabilize?: number;
  /** Motion filtering 0..1: removes hand shake. */
  motionFilter?: number;
  /** Expression 0..1: keeps some natural wobble while motion filtering. */
  expression?: number;
}

export const NO_TILT_SHADE: TiltShade = {
  enabled: false,
  threshold: 40,
  size: 3,
  opacity: 0.45,
  roundness: 0.35,
  hardness: 0.1,
  grain: 0.8,
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 (no shading) .. 1 (full side-of-pencil shading) for a pen tilt. */
export function shadeAmount(ts: TiltShade, tiltX: number, tiltY: number): number {
  if (!ts.enabled) return 0;
  const deg = Math.min(90, Math.hypot(tiltX, tiltY));
  return smoothstep(ts.threshold, ts.threshold + 20, deg);
}

export interface InputSample {
  /** 0..1 (1 for a mouse). */
  pressure: number;
  /** 0 upright .. 1 flat. */
  tilt: number;
  /** 0 still .. 1 fast. */
  speed: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function dyn(control: Control, min = 0, curve = 1, jitter = 0, invert = false): Dynamic {
  return { control, min, curve, jitter, invert };
}

/** A points curve at `x` (0..1): straight between points, flat past the ends. */
export function curveAt(points: [number, number][], x: number): number {
  if (!points.length) return x;
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      return x1 - x0 > 1e-9 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return points[points.length - 1]![1];
}

/** Evaluate a dynamic to a 0..1 multiplier. `rnd` is a seeded 0..1 value for jitter. */
export function evalDynamic(d: Dynamic, s: InputSample, rnd: number): number {
  let v = d.control === 'pressure' ? s.pressure : d.control === 'tilt' ? s.tilt : d.control === 'speed' ? s.speed : 1;
  if (d.control !== 'off') {
    if (d.points) {
      // a points curve shapes the input first; inverting flips its output (Procreate's negative amounts)
      v = clamp01(curveAt(d.points, clamp01(v)));
      if (d.invert) v = 1 - v;
    } else {
      if (d.invert) v = 1 - v;
      v = Math.pow(clamp01(v), d.curve);
    }
    v = d.min + (1 - d.min) * v;
  }
  if (d.jitter > 0) v *= 1 - d.jitter * rnd;
  return clamp01(v);
}

const base: BrushSettings = {
  name: 'Pencil',
  size: 8,
  hardness: 0.8,
  spacing: 0.12,
  opacity: 1,
  flow: 0.9,
  roundness: 1,
  angle: 0,
  followDirection: false,
  sizeDyn: dyn('pressure', 0.25, 1.2),
  opacityDyn: dyn('pressure', 0.35, 1),
  flowDyn: dyn('off'),
  scatter: 0,
  grain: 0.35,
  grainScale: 0.6,
  taperStart: 0,
  taperEnd: 0,
  smoothing: 0.25,
  pulledString: false,
  tiltShade: { ...NO_TILT_SHADE, enabled: true },
};

export const PRESETS: BrushSettings[] = [
  base,
  {
    ...base,
    name: 'Ink',
    size: 10,
    hardness: 0.98,
    spacing: 0.05,
    flow: 1,
    sizeDyn: dyn('pressure', 0.05, 1.6),
    opacityDyn: dyn('off'),
    grain: 0,
    taperStart: 30,
    taperEnd: 40,
    smoothing: 0.45,
    postSmooth: 0.5,
    tiltShade: NO_TILT_SHADE,
  },
  {
    ...base,
    name: 'Brush Pen',
    size: 18,
    hardness: 0.98,
    spacing: 0.04,
    flow: 1,
    roundness: 0.75,
    angle: 30,
    sizeDyn: dyn('pressure', 0.02, 2.2),
    opacityDyn: dyn('off'),
    grain: 0,
    taperStart: 50,
    taperEnd: 90,
    smoothing: 0.55,
    postSmooth: 0.6,
    tiltShade: NO_TILT_SHADE,
  },
  {
    ...base,
    name: 'Fine Liner',
    size: 4,
    hardness: 0.98,
    spacing: 0.05,
    flow: 1,
    sizeDyn: dyn('pressure', 0.75, 1),
    opacityDyn: dyn('off'),
    grain: 0,
    taperStart: 6,
    taperEnd: 6,
    smoothing: 0.4,
    postSmooth: 0.4,
    tiltShade: NO_TILT_SHADE,
  },
  {
    ...base,
    name: 'Pixel Ink',
    size: 3,
    hardness: 0.98,
    spacing: 0.05,
    flow: 1,
    sizeDyn: dyn('off'),
    opacityDyn: dyn('off'),
    grain: 0,
    smoothing: 0.3,
    postSmooth: 0.3,
    antiAlias: false,
    tiltShade: NO_TILT_SHADE,
  },
  {
    ...base,
    name: 'Marker',
    size: 28,
    hardness: 0.6,
    spacing: 0.05,
    opacity: 0.7,
    flow: 0.25,
    roundness: 0.35,
    angle: 35,
    sizeDyn: dyn('off'),
    opacityDyn: dyn('off'),
    grain: 0,
    smoothing: 0.2,
    tiltShade: NO_TILT_SHADE,
  },
  {
    ...base,
    name: 'Charcoal',
    size: 26,
    hardness: 0.35,
    spacing: 0.15,
    opacity: 0.9,
    flow: 0.5,
    roundness: 0.6,
    followDirection: true,
    sizeDyn: dyn('pressure', 0.5, 1),
    opacityDyn: dyn('pressure', 0.1, 1.4),
    flowDyn: dyn('off', 0, 1, 0.4),
    scatter: 0.08,
    grain: 0.75,
    grainScale: 1.2,
    smoothing: 0.1,
    tiltShade: { enabled: true, threshold: 35, size: 2.5, opacity: 0.55, roundness: 0.3, hardness: 0.05, grain: 0.9 },
  },
  {
    ...base,
    name: 'Shading Pencil',
    size: 6,
    hardness: 0.7,
    spacing: 0.1,
    flow: 0.8,
    grain: 0.5,
    grainScale: 0.5,
    tiltShade: { enabled: true, threshold: 30, size: 5, opacity: 0.35, roundness: 0.25, hardness: 0.05, grain: 0.85 },
  },
  {
    ...base,
    name: 'Textured Paint',
    size: 48,
    hardness: 0.7,
    spacing: 0.12,
    opacity: 1,
    flow: 0.28,
    sizeDyn: dyn('pressure', 0.35, 1),
    opacityDyn: dyn('pressure', 0.2, 1),
    grain: 0.7,
    grainScale: 0.4,
    taperStart: 12,
    taperEnd: 20,
    smoothing: 0.2,
    tiltShade: NO_TILT_SHADE,
  },
  {
    ...base,
    name: 'Soft Airbrush',
    size: 90,
    hardness: 0,
    spacing: 0.1,
    opacity: 0.6,
    flow: 0.08,
    sizeDyn: dyn('off'),
    opacityDyn: dyn('off'),
    flowDyn: dyn('pressure', 0, 1.5),
    grain: 0,
    smoothing: 0.3,
    tiltShade: NO_TILT_SHADE,
  },
];

// Vector presets use original procedural tips. Selecting one switches to the Vector pen.
for (const [name,mode,tip,size,spacing,aspect] of [
  ['Vector Ink','ink','dot',12,.12,1],
  ['Vector Chisel','flat','dot',24,.12,.2],
  ['Vector Dry Ink','stamp','dry',20,.12,1],
  ['Vector Pencil','stamp','pencil',12,.1,.65],
  ['Vector Dots','stamp','dot',14,1.6,1],
  ['Vector Pattern','stamp','dash',22,1.2,1],
] as const) PRESETS.push({...structuredClone(base),name,size,spacing,roundness:aspect,angle:mode==='flat'?-35:0,followDirection:tip==='dash',sizeDyn:dyn('pressure',.15,1),opacity:1,flow:tip==='pencil'?.6:1,vectorStyle:{v:1,mode,tip}});

export function cloneBrush(b: BrushSettings): BrushSettings {
  return structuredClone(b);
}

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** A curve from a file: 2..16 points in 0..1 with ascending inputs, or null. */
export function readCurvePoints(v: unknown): [number, number][] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 16) return null;
  const out: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || !unit(p[0]) || !unit(p[1])) return null;
    if (out.length && p[0] < out[out.length - 1]![0]) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Drop or clamp the optional imported-brush fields of a brush read from a file or storage (in place). */
export function sanitizeBrushExtras(b: BrushSettings): BrushSettings {
  for (const k of ['sizeDyn', 'opacityDyn', 'flowDyn'] as const) {
    const d = b[k];
    if (d && d.points !== undefined) {
      const pts = readCurvePoints(d.points);
      if (pts) d.points = pts;
      else delete d.points;
    }
  }
  for (const k of ['taperSize', 'taperOpacity', 'taperShape', 'grainMin', 'grainMovement', 'grainFollow'] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) delete b[k];
    else b[k] = clamp01(v);
  }
  if (b.grainRotation !== undefined && !(typeof b.grainRotation === 'number' && Number.isFinite(b.grainRotation))) delete b.grainRotation;
  if (b.grainRef !== undefined && !(typeof b.grainRef === 'number' && Number.isFinite(b.grainRef) && b.grainRef > 0)) delete b.grainRef;
  if (b.grainMode !== undefined && b.grainMode !== 'height') delete b.grainMode;
  return b;
}
