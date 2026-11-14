import type { Pt } from '../doc/model';

/**
 * Halftone screening: the print way of turning a tone into dots.
 *
 * Every pixel finds its cell on a rotated screen (`frequency` cells per inch, at `angle`), asks
 * the tone at that cell's centre, and inks itself when its place in the cell's *fill order* comes
 * before that tone. The fill order is a classic spot function (round Euclidean dots that turn into
 * round holes past 50%, squares, diamonds, lines, crosses), **calibrated** through its own
 * distribution so that a tone of d covers exactly d of the cell for every shape. So 30% grey
 * prints as 30% ink, whatever the dot.
 *
 * The screen is fixed to the page (inches from its top-left), so dots line up across panels, tiles
 * and exports. Pure: it fills an alpha array, so tests can measure coverage without a browser.
 */
export type ToneShape = 'dot' | 'square' | 'diamond' | 'line' | 'cross';
export interface Screen { shape: ToneShape; frequency: number; angle: number }

/** Fill order inside a cell (u, v in −0.5…0.5): lower is inked first. */
export function spotOrder(shape: ToneShape, u: number, v: number): number {
  const au = Math.abs(u), av = Math.abs(v);
  switch (shape) {
    case 'square': return Math.max(au, av);
    case 'diamond': return au + av;
    case 'line': return av;
    case 'cross': return Math.min(au, av);
    default: {
      // Euclidean dot (PostScript), on x, y in −1…1: round dots from the centre, meeting in a
      // checkerboard at 50%, then round paper holes shrinking into the corners
      const x = 2 * au, y = 2 * av;
      return x + y <= 1 ? x * x + y * y - 1 : 1 - ((1 - x) * (1 - x) + (1 - y) * (1 - y));
    }
  }
}

const LUT = 4096;
const luts = new Map<ToneShape, { lut: Float32Array; min: number; span: number }>();

/** Order → share of the cell inked before it (0…1): the calibration that makes coverage exact. */
function calibration(shape: ToneShape) {
  const hit = luts.get(shape);
  if (hit) return hit;
  const N = 512, values = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) values[j * N + i] = spotOrder(shape, (i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5);
  values.sort();
  const min = values[0]!, span = (values[values.length - 1]! - min) || 1;
  const lut = new Float32Array(LUT + 1);
  let k = 0;
  for (let b = 0; b <= LUT; b++) {
    const edge = min + (b / LUT) * span;
    while (k < values.length && values[k]! <= edge) k++;
    lut[b] = k / values.length;
  }
  const out = { lut, min, span };
  luts.set(shape, out);
  return out;
}

/** Threshold of a point inside a cell: the share of the cell that is inked before it. */
export function threshold(shape: ToneShape, u: number, v: number): number {
  const c = calibration(shape);
  const b = Math.max(0, Math.min(LUT, Math.round(((spotOrder(shape, u, v) - c.min) / c.span) * LUT)));
  // centre of the step, so a tone of d inks d of the cell, not slightly more
  return b > 0 ? (c.lut[b - 1]! + c.lut[b]!) / 2 : c.lut[0]! / 2;
}

export interface HalftoneArea {
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Page inches at the output's top-left pixel corner. */
  x0: number;
  y0: number;
  /** Pixels per inch of the output. */
  scale: number;
}

/**
 * Fill `alpha` (width × height, 0–255) with the screened tone. `densityAt` gives 0–1 at a page
 * point (inches); it is asked once per cell, at the cell's centre, like a press does.
 * `smooth` softens dot edges by about a pixel for screen display; off gives crisp 1-bit dots.
 */
export function screenAlpha(alpha: Uint8ClampedArray, area: HalftoneArea, screen: Screen, densityAt: (x: number, y: number) => number, smooth = true): void {
  const { width, height, x0, y0, scale } = area;
  const f = screen.frequency, a = (screen.angle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const cellPx = scale / f;
  const soft = smooth ? Math.min(0.5, 1.2 / cellPx) : 0;
  // Crisp dots: a tiny zero-mean nudge of each pixel's threshold (about one pixel's worth at a
  // dot's edge) breaks the slow beat between dot spacing and the pixel grid (moiré) at angles
  // where the two nearly line up. The average tone is unchanged.
  const nudge = smooth ? 0 : Math.min(0.25, 1.6 / (cellPx * cellPx) + 0.6 / cellPx) ;
  const c = calibration(screen.shape);
  let lastCell = NaN, lastI = NaN, lastD = 0;
  for (let py = 0; py < height; py++) {
    const y = y0 + (py + 0.5) / scale;
    for (let px = 0; px < width; px++) {
      const x = x0 + (px + 0.5) / scale;
      // page → screen space (cells)
      const su = (x * cos + y * sin) * f, sv = (-x * sin + y * cos) * f;
      const ci = Math.floor(su), cj = Math.floor(sv);
      if (ci !== lastI || cj !== lastCell) {
        lastI = ci; lastCell = cj;
        const cu = (ci + 0.5) / f, cv = (cj + 0.5) / f;
        lastD = densityAt(cu * cos - cv * sin, cu * sin + cv * cos);
      }
      const d = lastD;
      let v: number;
      if (d <= 0) v = 0;
      else if (d >= 1) v = 1;
      else {
        const b = Math.max(0, Math.min(LUT, Math.round(((spotOrder(screen.shape, su - ci - 0.5, sv - cj - 0.5) - c.min) / c.span) * LUT)));
        const t = b > 0 ? (c.lut[b - 1]! + c.lut[b]!) / 2 : c.lut[0]! / 2;
        v = soft > 0 ? Math.max(0, Math.min(1, (d - t) / soft + 0.5)) : (t + (pixelNoise(px + Math.round(x0 * scale), py + Math.round(y0 * scale)) - 0.5) * nudge < d ? 1 : 0);
      }
      alpha[py * width + px] = Math.round(v * 255);
    }
  }
}

/** A fixed noise per output pixel (0–1), placed by page position so exports tile seamlessly. */
function pixelNoise(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ---- tone fields

export interface ToneStop { at: number; density: number }
export interface ToneGradient { kind: 'linear' | 'radial'; from: Pt; to: Pt; stops: ToneStop[] }

/** Tone along a gradient's stops at position t (0–1); stops in any order. */
export function stopDensity(stops: readonly ToneStop[], t: number): number {
  if (!stops.length) return 0;
  const s = [...stops].sort((a, b) => a.at - b.at);
  if (t <= s[0]!.at) return s[0]!.density;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (t <= b.at) return b.at === a.at ? b.density : a.density + (b.density - a.density) * ((t - a.at) / (b.at - a.at));
  }
  return s[s.length - 1]!.density;
}

/** A gradient's tone at a page point (inches). */
export function gradientField(g: ToneGradient): (x: number, y: number) => number {
  const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y, len2 = dx * dx + dy * dy || 1e-9, len = Math.sqrt(len2);
  const stops = [...g.stops].sort((a, b) => a.at - b.at);
  return g.kind === 'radial'
    ? (x, y) => stopDensity(stops, Math.min(1, Math.hypot(x - g.from.x, y - g.from.y) / len))
    : (x, y) => stopDensity(stops, Math.max(0, Math.min(1, ((x - g.from.x) * dx + (y - g.from.y) * dy) / len2)));
}

/**
 * A painted layer's tone: darkness (alpha × (1 − luma)) averaged over a box one cell wide around
 * each point, from a summed-area table, so each dot carries the true average of its cell rather
 * than one sampled pixel.
 */
export function darknessField(rgba: Uint8ClampedArray, width: number, height: number, area: { x0: number; y0: number; scale: number }, cellInches: number): (x: number, y: number) => number {
  const W = width + 1, sat = new Float64Array(W * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const luma = (0.299 * rgba[k]! + 0.587 * rgba[k + 1]! + 0.114 * rgba[k + 2]!) / 255;
      row += (rgba[k + 3]! / 255) * (1 - luma);
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1]! + row;
    }
  }
  const half = Math.max(0.5, (cellInches * area.scale) / 2);
  return (xi, yi) => {
    const cx = (xi - area.x0) * area.scale, cy = (yi - area.y0) * area.scale;
    const x0 = Math.max(0, Math.min(width, Math.round(cx - half))), x1 = Math.max(0, Math.min(width, Math.round(cx + half)));
    const y0 = Math.max(0, Math.min(height, Math.round(cy - half))), y1 = Math.max(0, Math.min(height, Math.round(cy + half)));
    const n = (x1 - x0) * (y1 - y0);
    if (n <= 0) return 0;
    return (sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!) / n;
  };
}
