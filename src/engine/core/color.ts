// Vendored from 2Dope src/core/color.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/** Colour maths for the colour panel: hex <-> RGB <-> HSV (h 0..360, s and v 0..1). Pure. */

export interface HSV {
  h: number;
  s: number;
  v: number;
}

/** "#abc", "abc", "#AABBCC" -> "#aabbcc"; null when it is not a colour. */
export function normalizeHex(s: string): string | null {
  let t = s.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt((normalizeHex(hex) ?? '#000000').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const hexToHsv = (hex: string): HSV => rgbToHsv(...hexToRgb(hex));
export const hsvToHex = (c: HSV): string => rgbToHex(...hsvToRgb(c));

/** Put `c` first in a recent-colours list (no repeats, at most `max`). */
export function pushRecent(list: readonly string[], c: string, max = 12): string[] {
  const hex = normalizeHex(c);
  if (!hex) return list.slice(0, max);
  return [hex, ...list.filter((x) => x !== hex)].slice(0, max);
}

// ---- Harmony (Procreate's colour harmony): colours that go with the one you have ----

export type HarmonyMode = 'complementary' | 'split' | 'analogous' | 'triadic' | 'tetradic';

export const HARMONY_MODES: { id: HarmonyMode; label: string }[] = [
  { id: 'complementary', label: 'Complementary' },
  { id: 'split', label: 'Split complementary' },
  { id: 'analogous', label: 'Analogous' },
  { id: 'triadic', label: 'Triadic' },
  { id: 'tetradic', label: 'Tetradic' },
];

const HARMONY_TURNS: Record<HarmonyMode, number[]> = {
  complementary: [0, 180],
  split: [0, 150, 210],
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

/** The colour and its partners, turned round the hue wheel (saturation and brightness kept). */
export function harmony(hex: string, mode: HarmonyMode): string[] {
  const c = hexToHsv(hex);
  return HARMONY_TURNS[mode].map((t) => hsvToHex({ ...c, h: (((c.h + t) % 360) + 360) % 360 }));
}

/**
 * A palette from a picture (Procreate's New from Photos): median cut over the opaque pixels,
 * darkest first. `step` skips pixels on large pictures.
 */
export function paletteFromPixels(data: Uint8ClampedArray, count = 12, step = 1): string[] {
  const px: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4 * step) if (data[i + 3]! > 128) px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < count) {
    // split the box with the widest channel range at its median
    let best = -1, bestRange = 0, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[ch]! < lo) lo = p[ch]!; if (p[ch]! > hi) hi = p[ch]!; }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = ch; }
      }
    });
    if (best < 0 || bestRange < 8) break;
    const b = boxes[best]!.sort((p, q) => p[bestCh]! - q[bestCh]!);
    // cut where the median value starts, so one colour is not split across two boxes
    const v = b[b.length >> 1]![bestCh]!;
    let mid = b.findIndex((p) => p[bestCh]! >= v);
    if (mid <= 0) mid = b.findIndex((p) => p[bestCh]! > v);
    if (mid <= 0) mid = b.length >> 1;
    boxes = [...boxes.slice(0, best), b.slice(0, mid), b.slice(mid), ...boxes.slice(best + 1)];
  }
  const avg = boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) for (let ch = 0; ch < 3; ch++) s[ch]! += p[ch]!;
    return s.map((v) => Math.round(v / b.length)) as [number, number, number];
  });
  avg.sort((p, q) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11 - (q[0] * 0.3 + q[1] * 0.59 + q[2] * 0.11));
  return [...new Set(avg.map((c) => rgbToHex(...c)))];
}

// ---- Colour dynamics (Procreate's Color dynamics): colour that varies per dab or per stroke ----

export interface ColorJitter {
  /** 0..1: up to half a turn of the hue wheel either way. */
  hue: number;
  /** 0..1: saturation moves up to this much either way. */
  sat: number;
  /** 0..1: brightness moves up to this much either way. */
  bright: number;
}

/** `hex` moved by a jitter; r1..r3 are random numbers 0..1 (seeded, so strokes replay the same). */
export function jitterColor(hex: string, j: ColorJitter, r1: number, r2: number, r3: number): string {
  if (!j.hue && !j.sat && !j.bright) return hex;
  const c = hexToHsv(hex);
  const h = (((c.h + (r1 * 2 - 1) * j.hue * 180) % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, c.s + (r2 * 2 - 1) * j.sat));
  const v = Math.min(1, Math.max(0, c.v + (r3 * 2 - 1) * j.bright));
  return hsvToHex({ h, s, v });
}

/** `a` mixed towards `b` by t (0 = a, 1 = b), rounded to 6 bits a channel so few distinct colours result. */
export function mixColor(a: string, rgb: readonly [number, number, number], t: number): string {
  const [r, g, b] = hexToRgb(a);
  const q = (x: number) => Math.min(255, Math.round(x / 4) * 4);
  return rgbToHex(q(r + (rgb[0] - r) * t), q(g + (rgb[1] - g) * t), q(b + (rgb[2] - b) * t));
}
