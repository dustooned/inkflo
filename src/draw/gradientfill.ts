import type { Fill, FillGradient } from '../doc/model';
import { polygonMask, type FillResult } from '../engine/fill/fill';
import { hexRgb, type FillKit } from './fillkit';
import type { FillPaint } from './replay';

/**
 * Colour gradients for flats: a gradient fill paints a blend from one colour to another (or to
 * transparent) across an area, and is stored as a fill so it undoes, saves and replays like one.
 *
 * Area, chosen where the drag starts:
 * - `lines`: the area the line art encloses (the bucket's area);
 * - `colour`: the flat you start on, pixels of that colour joined to it on the colour layer;
 * - `lasso`: a drawn area (also used for "whole panel", stored as the panel's outline).
 *
 * Blend: `normal` lays the gradient over the flat; `multiply` darkens it (shading that keeps the
 * flat's hue); `screen` lightens it (light). Opacity scales the whole gradient.
 */

/** Pixels of the flat at the seed: the same colour (within `tolerance` per channel), joined to it. */
export function colourRegion(rgba: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, inside?: Uint8Array, tolerance = 10): FillResult | null {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const k0 = (sy * w + sx) * 4;
  if (rgba[k0 + 3]! < 8) return null; // nothing painted here: there is no flat to follow
  const r = rgba[k0]!, g = rgba[k0 + 1]!, b = rgba[k0 + 2]!, a = rgba[k0 + 3]!;
  const same = (i: number) => {
    const k = i * 4;
    return Math.abs(rgba[k]! - r) <= tolerance && Math.abs(rgba[k + 1]! - g) <= tolerance && Math.abs(rgba[k + 2]! - b) <= tolerance && Math.abs(rgba[k + 3]! - a) <= tolerance * 2;
  };
  const mask = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  mask[stack[0]!] = 1;
  let x0 = sx, y0 = sy, x1 = sx, y1 = sy, count = 0;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n < 0 || mask[n] || (inside && !inside[n]) || !same(n)) continue;
      mask[n] = 1;
      stack.push(n);
    }
  }
  return { mask, x0, y0, x1, y1, count };
}

/** The gradient's position (0–1) at a pixel centre, in page inches. */
export function gradientT(gr: Pick<FillGradient, 'kind' | 'from' | 'to'>): (x: number, y: number) => number {
  const dx = gr.to.x - gr.from.x, dy = gr.to.y - gr.from.y, len2 = dx * dx + dy * dy || 1e-9, len = Math.sqrt(len2);
  return gr.kind === 'radial'
    ? (x, y) => Math.min(1, Math.hypot(x - gr.from.x, y - gr.from.y) / len)
    : (x, y) => Math.max(0, Math.min(1, ((x - gr.from.x) * dx + (y - gr.from.y) * dy) / len2));
}

const rgbaOf = (c: string): [number, number, number, number] => {
  if (c === 'transparent') return [0, 0, 0, 0];
  const n = hexRgb(c);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

/**
 * Blend the gradient into `px` (RGBA of the region's box) where `mask` is set. Pure, so tests can
 * check colours and blends without a canvas. `box` is the region's pixel box on the layer.
 */
export function blendGradient(px: Uint8ClampedArray, box: { x: number; y: number; w: number; h: number }, mask: Uint8Array, layerW: number, dpi: number, gr: FillGradient): void {
  const t = gradientT(gr);
  const [sr, sg, sb, sa] = rgbaOf(gr.start), [er, eg, eb, ea] = rgbaOf(gr.end);
  // a colour fading to transparent keeps its own colour (no darkening toward black)
  const fr = ea === 0 ? sr : er, fg = ea === 0 ? sg : eg, fb = ea === 0 ? sb : eb;
  const br = sa === 0 ? fr : sr, bg = sa === 0 ? fg : sg, bb = sa === 0 ? fb : sb;
  const opacity = Math.max(0, Math.min(1, gr.opacity ?? 1));
  const blend = gr.blend ?? 'normal';
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      if (!mask[(box.y + y) * layerW + box.x + x]) continue;
      const u = t((box.x + x + 0.5) / dpi, (box.y + y + 0.5) / dpi);
      const cr = br + (fr - br) * u, cg = bg + (fg - bg) * u, cb = bb + (fb - bb) * u;
      const a = ((sa + (ea - sa) * u) / 255) * opacity;
      if (a <= 0) continue;
      const i = (y * box.w + x) * 4;
      const dr = px[i]!, dg = px[i + 1]!, db = px[i + 2]!, da = px[i + 3]! / 255;
      let nr = cr, ng = cg, nb = cb;
      if (da > 0 && blend === 'multiply') { nr = (dr * cr) / 255; ng = (dg * cg) / 255; nb = (db * cb) / 255; }
      else if (da > 0 && blend === 'screen') { nr = 255 - ((255 - dr) * (255 - cr)) / 255; ng = 255 - ((255 - dg) * (255 - cg)) / 255; nb = 255 - ((255 - db) * (255 - cb)) / 255; }
      // straight-alpha "over"
      const oa = a + da * (1 - a);
      px[i] = (nr * a + dr * da * (1 - a)) / oa;
      px[i + 1] = (ng * a + dg * da * (1 - a)) / oa;
      px[i + 2] = (nb * a + db * da * (1 - a)) / oa;
      px[i + 3] = oa * 255;
    }
  }
}

/** The area a gradient fill covers. */
export function gradientArea(kit: FillKit, colour: HTMLCanvasElement, fill: Fill): FillResult | null {
  const gr = fill.gradient!;
  const w = colour.width, h = colour.height, dpi = kit.dpi;
  if (gr.area === 'lasso' && gr.lasso && gr.lasso.length >= 3) {
    const area = polygonMask(gr.lasso.map((p) => [p.x * dpi, p.y * dpi] as const), w, h);
    if (!area) return null;
    const inside = kit.inside();
    const mask = new Uint8Array(w * h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = area.y0; y <= area.y1; y++) for (let x = area.x0; x <= area.x1; x++) {
      const i = y * w + x;
      if (!area.mask[i] || !inside[i]) continue;
      mask[i] = 1; count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return count ? { mask, x0, y0, x1, y1, count } : null;
  }
  if (gr.area === 'colour') {
    const rgba = colour.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    const region = colourRegion(rgba, w, h, Math.floor(fill.at.x * dpi), Math.floor(fill.at.y * dpi), kit.inside());
    if (region) return region;
    // nothing painted where the drag started: follow the line art instead
  }
  const { gradient: _g, ...plain } = fill;
  return kit.mask(plain)?.res ?? null;
}

/** Paint a gradient fill onto a colour canvas, returning before/after pixels for undo. */
export function paintGradient(kit: FillKit, colour: HTMLCanvasElement, fill: Fill): FillPaint | null {
  const res = gradientArea(kit, colour, fill);
  if (!res) return null;
  const g = colour.getContext('2d', { willReadFrequently: true })!;
  const rect = { x: res.x0, y: res.y0, w: res.x1 - res.x0 + 1, h: res.y1 - res.y0 + 1 };
  const before = g.getImageData(rect.x, rect.y, rect.w, rect.h);
  const after = new ImageData(new Uint8ClampedArray(before.data), rect.w, rect.h);
  blendGradient(after.data, rect, res.mask, colour.width, kit.dpi, fill.gradient!);
  g.putImageData(after, rect.x, rect.y);
  return { rect, before, after };
}
