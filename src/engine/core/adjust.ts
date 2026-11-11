// Vendored from 2Dope src/core/adjust.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Adjustments (Procreate's Adjustments menu): Hue / Saturation / Brightness and Gaussian Blur on
 * RGBA pixels. Pure functions over ImageData-shaped buffers, so they can be previewed live from a
 * kept copy and committed as one undo step.
 */

export interface HSB {
  /** Degrees, -180..180. */
  hue: number;
  /** -100..100: -100 is grey, 100 doubles saturation. */
  sat: number;
  /** -100..100: -100 is black, 100 is white. */
  bright: number;
}

export const NO_HSB: HSB = { hue: 0, sat: 0, bright: 0 };

export function isNoHSB(a: HSB): boolean {
  return a.hue === 0 && a.sat === 0 && a.bright === 0;
}

/** One colour through the adjustment (0..255 channels). */
export function adjustRGB(r: number, g: number, b: number, a: HSB): [number, number, number] {
  // to HSV
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  let s = max === 0 ? 0 : d / max;
  let v = max / 255;
  h = (((h + a.hue) % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s * (1 + a.sat / 100)));
  v = a.bright >= 0 ? v + (1 - v) * (a.bright / 100) : v * (1 + a.bright / 100);
  // brightening also lifts colour towards white, like Procreate
  if (a.bright > 0) s *= 1 - a.bright / 100;
  // back to RGB
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
}

/** Hue / Saturation / Brightness of `src` into `dst` (same length). Transparent pixels are skipped. */
export function applyHSB(src: Uint8ClampedArray, dst: Uint8ClampedArray, a: HSB): void {
  if (isNoHSB(a)) {
    dst.set(src);
    return;
  }
  // many pixels share a colour (flat fills): cache the last one
  let lr = -1, lg = -1, lb = -1, out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < src.length; i += 4) {
    const al = src[i + 3]!;
    dst[i + 3] = al;
    if (!al) {
      dst[i] = src[i]!;
      dst[i + 1] = src[i + 1]!;
      dst[i + 2] = src[i + 2]!;
      continue;
    }
    const r = src[i]!, g = src[i + 1]!, b = src[i + 2]!;
    if (r !== lr || g !== lg || b !== lb) {
      out = adjustRGB(r, g, b, a);
      lr = r; lg = g; lb = b;
    }
    dst[i] = out[0];
    dst[i + 1] = out[1];
    dst[i + 2] = out[2];
  }
}

/** A hex colour (#rrggbb) through the adjustment (for vector lines). */
export function adjustHex(hex: string, a: HSB): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = adjustRGB((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** One box blur pass along rows (horizontal) of premultiplied channels, radius r. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 4 : line * 4;
    for (let ch = 0; ch < 4; ch++) {
      let acc = 0;
      // edges extend with transparency (nothing outside the page)
      for (let k = -r; k <= r; k++) if (k >= 0 && k < len) acc += src[base + k * step + ch]!;
      for (let i = 0; i < len; i++) {
        dst[base + i * step + ch] = acc * inv;
        const out = i - r;
        const inn = i + r + 1;
        if (out >= 0) acc -= src[base + out * step + ch]!;
        if (inn < len) acc += src[base + inn * step + ch]!;
      }
    }
  }
}

/**
 * Gaussian blur (three box passes each way) of `src` into `dst`, radius in pixels. Premultiplied,
 * so colours do not darken at soft edges.
 */
export function applyBlur(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) {
    dst.set(src);
    return;
  }
  const n = w * h * 4;
  let a = new Float32Array(n);
  let b = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const al = src[i + 3]! / 255;
    a[i] = src[i]! * al;
    a[i + 1] = src[i + 1]! * al;
    a[i + 2] = src[i + 2]! * al;
    a[i + 3] = src[i + 3]!;
  }
  // three boxes of about r/sqrt(3) approximate a Gaussian of sigma r/2
  const box = Math.max(1, Math.round(r / 1.7));
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, box, true);
    [a, b] = [b, a];
    boxPass(a, b, w, h, box, false);
    [a, b] = [b, a];
  }
  for (let i = 0; i < n; i += 4) {
    const al = a[i + 3]!;
    dst[i + 3] = al;
    const k = al > 0 ? 255 / al : 0;
    dst[i] = a[i]! * k;
    dst[i + 1] = a[i + 1]! * k;
    dst[i + 2] = a[i + 2]! * k;
  }
}

/**
 * Limit an adjusted block to a selection: pixels of `out` whose document pixel is not selected
 * (mask 1 = selected) go back to `before`. `rect` places the block in a document `width` wide.
 */
export function keepOutside(out: Uint8ClampedArray, before: Uint8ClampedArray, mask: Uint8Array, width: number, rect: { x: number; y: number; w: number; h: number }): void {
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      if (mask[(rect.y + y) * width + rect.x + x] === 1) continue;
      const i = (y * rect.w + x) * 4;
      out[i] = before[i]!;
      out[i + 1] = before[i + 1]!;
      out[i + 2] = before[i + 2]!;
      out[i + 3] = before[i + 3]!;
    }
}

// ---- Symmetry (Procreate's Drawing Guide > Symmetry) ----

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'quadrant' | 'radial';

/** Radial symmetry: this many copies around the centre. */
export const RADIAL_COPIES = 8;

/**
 * The copies of one point (with its tip angle) under a symmetry around (cx, cy), the original
 * first. Mirrors flip the tip's angle so slanted tips stay mirror images.
 */
export function symmetryCopies(mode: SymmetryMode, cx: number, cy: number, x: number, y: number, angle: number): { x: number; y: number; angle: number }[] {
  const out = [{ x, y, angle }];
  if (mode === 'vertical' || mode === 'quadrant') out.push({ x: 2 * cx - x, y, angle: Math.PI - angle });
  if (mode === 'horizontal' || mode === 'quadrant') out.push({ x, y: 2 * cy - y, angle: -angle });
  if (mode === 'quadrant') out.push({ x: 2 * cx - x, y: 2 * cy - y, angle: angle + Math.PI });
  if (mode === 'radial') {
    for (let k = 1; k < RADIAL_COPIES; k++) {
      const t = (k * 2 * Math.PI) / RADIAL_COPIES;
      const c = Math.cos(t), s = Math.sin(t);
      const dx = x - cx, dy = y - cy;
      out.push({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c, angle: angle + t });
    }
  }
  return out;
}
