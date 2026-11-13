import type { Fill, Pt, Stroke } from '../doc/model';
import { brushMask, fillFrom, lassoFill, leftoverHoles, polygonMask, prepareFill, type FillMap, type FillResult } from '../engine/fill/fill';
import type { Panel } from '../geom/carve';

/**
 * Line and fill detection (EXPLORE-DESK-UI §7). Pure: typed arrays in, masks out, so the desk and
 * replay share one path and Node can test it.
 *
 * - **Walls:** the reference lines plus everything outside the panels (gutters and margins), so a
 *   fill never crosses a panel border even where the art doesn't close.
 * - One cached **line map** per (refer, gap, threshold): repeat taps cost one flood.
 * - Every fill kind is stored as data on the colour layer and replays exactly.
 */

export const FILL_THRESHOLD = 24;

export type Refer = 'refs' | 'all';

export interface FillPaintMask {
  res: FillResult;
  /** Per-pixel colour (0xRRGGBB) when it is not the fill's own colour (leftover holes). */
  rgbAt?: Map<number, number>;
}

export function hexRgb(color: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  return m ? parseInt(m[1]!, 16) : 0;
}

/** Union of the panels' pixel masks (1 = inside a panel). */
export function panelUnion(panels: readonly Panel[], dpi: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const p of panels) {
    const a = polygonMask(p.pts.map((q) => [q.x * dpi, q.y * dpi] as const), w, h);
    if (!a) continue;
    for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) {
      const i = y * w + x;
      if (a.mask[i]) out[i] = 1;
    }
  }
  return out;
}

/**
 * Pixels where two panels meet (1 = a 4-neighbour belongs to another panel). Carved panels share
 * their cut edge, so without this the panel union is one region and a fill runs from one panel
 * into the next, and around any ink that stops short of the far side.
 */
export function panelSeams(panels: readonly Panel[], dpi: number, w: number, h: number): Uint8Array {
  const id = new Uint16Array(w * h);
  panels.forEach((p, n) => {
    const a = polygonMask(p.pts.map((q) => [q.x * dpi, q.y * dpi] as const), w, h);
    if (!a) return;
    for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) {
      const i = y * w + x;
      if (a.mask[i] && !id[i]) id[i] = n + 1;
    }
  });
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const v = id[i]!;
    if (!v) continue;
    if ((x > 0 && id[i - 1] && id[i - 1] !== v) || (x < w - 1 && id[i + 1] && id[i + 1] !== v)
      || (y > 0 && id[i - w] && id[i - w] !== v) || (y < h - 1 && id[i + w] && id[i + w] !== v)) out[i] = 1;
  }
  return out;
}

/** Grow (n > 0) or shrink (n < 0) a fill by |n| pixels; growth stays inside `inside`. */
export function scaleMask(r: FillResult, n: number, w: number, h: number, inside: Uint8Array): FillResult | null {
  if (!n) return r;
  const mask = r.mask;
  const steps = Math.abs(n);
  let x0 = r.x0;
  let y0 = r.y0;
  let x1 = r.x1;
  let y1 = r.y1;
  for (let s = 0; s < steps; s++) {
    const change: number[] = [];
    const ax = Math.max(0, x0 - 1);
    const ay = Math.max(0, y0 - 1);
    const bx = Math.min(w - 1, x1 + 1);
    const by = Math.min(h - 1, y1 + 1);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const i = y * w + x;
      const on = mask[i] === 1;
      if (n > 0 && on) continue;
      if (n < 0 && !on) continue;
      const nb = [x > 0 ? mask[i - 1] : 0, x < w - 1 ? mask[i + 1] : 0, y > 0 ? mask[i - w] : 0, y < h - 1 ? mask[i + w] : 0];
      if (n > 0 ? nb.some((v) => v === 1) && inside[i] : nb.some((v) => v !== 1)) change.push(i);
    }
    for (const i of change) mask[i] = n > 0 ? 1 : 0;
    if (n > 0) {
      x0 = ax;
      y0 = ay;
      x1 = bx;
      y1 = by;
    }
  }
  let count = 0;
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!mask[y * w + x]) continue;
    count++;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }
  return count ? { mask, x0: bx0, y0: by0, x1: bx1, y1: by1, count } : null;
}

export class FillKit {
  private maps = new Map<string, FillMap>();
  private walled = new Map<Refer, Uint8Array>();
  private union: Uint8Array | null = null;

  /**
   * `alphaOf` gives the line alpha (0–255 per pixel) the fills read: the group's reference layers
   * ('refs') or every visible layer except colour ('all').
   */
  constructor(
    private readonly alphaOf: (refer: Refer) => Uint8Array,
    readonly w: number,
    readonly h: number,
    readonly dpi: number,
    readonly panels: readonly Panel[],
    /** Fill only here instead of the panels (the Gutters group passes its gutter bands). */
    private readonly region?: Uint8Array,
  ) {}

  /** Where fills may go: inside the panels, or the given region (the gutter bands). */
  inside(): Uint8Array {
    return (this.union ??= this.region ?? panelUnion(this.panels, this.dpi, this.w, this.h));
  }

  /** Line alpha with everything outside the panels, and the seams between them, made solid. */
  walls(refer: Refer): Uint8Array {
    let a = this.walled.get(refer);
    if (!a) {
      const inside = this.inside();
      a = Uint8Array.from(this.alphaOf(refer));
      for (let i = 0; i < a.length; i++) if (!inside[i]) a[i] = 255;
      if (!this.region) {
        const seams = panelSeams(this.panels, this.dpi, this.w, this.h);
        for (let i = 0; i < a.length; i++) if (seams[i]) a[i] = 255;
      }
      this.walled.set(refer, a);
    }
    return a;
  }

  map(f: Pick<Fill, 'gap' | 'threshold' | 'refer'>): FillMap {
    const refer: Refer = f.refer ?? 'refs';
    const gap = Math.round(f.gap * this.dpi);
    const threshold = f.threshold ?? FILL_THRESHOLD;
    const key = `${refer}|${gap}|${threshold}`;
    let m = this.maps.get(key);
    if (!m) {
      m = prepareFill(this.walls(refer), this.w, this.h, { threshold, gap, under: 2 });
      this.maps.set(key, m);
    }
    return m;
  }

  private px(p: Pt): [number, number] {
    return [Math.floor(p.x * this.dpi), Math.floor(p.y * this.dpi)];
  }

  /**
   * What a fill paints. `colour` (RGBA of the colour layer, w*h*4) is needed only for leftover
   * fills, which take the colour around each hole.
   */
  mask(f: Fill, colour?: Uint8ClampedArray): FillPaintMask | null {
    const map = this.map(f);
    let res: FillResult | null;
    if (f.leftover) {
      if (!colour) return null;
      const area = brushMask(f.leftover.path.map((p) => [p.x * this.dpi, p.y * this.dpi] as const), f.leftover.r * this.dpi, this.w, this.h);
      if (!area) return null;
      const maxArea = Math.max(64, Math.round((0.12 * this.dpi) ** 2));
      const holes = leftoverHoles(colour, map.alpha, this.w, this.h, area, { threshold: map.opts.threshold, maxArea, under: 2, fallback: hexRgb(f.color) });
      if (!holes.length) return null;
      const mask = new Uint8Array(this.w * this.h);
      const rgbAt = new Map<number, number>();
      let x0 = this.w;
      let y0 = this.h;
      let x1 = -1;
      let y1 = -1;
      let count = 0;
      for (const hole of holes) for (const i of hole.pixels) {
        if (mask[i] || !this.inside()[i]) continue;
        mask[i] = 1;
        rgbAt.set(i, hole.rgb);
        count++;
        const x = i % this.w;
        const y = (i - x) / this.w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      return count ? { res: { mask, x0, y0, x1, y1, count }, rgbAt } : null;
    }
    if (f.lasso) {
      const poly = polygonMask(f.lasso.map((p) => [p.x * this.dpi, p.y * this.dpi] as const), this.w, this.h);
      res = poly ? lassoFill(map, poly) : null;
    } else {
      const [sx, sy] = this.px(f.at);
      res = fillFrom(map, sx, sy, !!f.exact);
    }
    if (res && f.grow) res = scaleMask(res, Math.round(f.grow * this.dpi), this.w, this.h, this.inside());
    return res ? { res } : null;
  }

  /**
   * Auto flats: one seed per closed area inside a panel (bigger than `minArea` square inches), in
   * reading order (top to bottom, left to right). The desk stores each as an ordinary fill.
   */
  flats(panel: Panel, f: Pick<Fill, 'gap' | 'threshold' | 'refer'>, minArea = 0.004, maxRegions = 400): { at: Pt; count: number }[] {
    const map = this.map(f);
    const { w, h } = this;
    const poly = polygonMask(panel.pts.map((q) => [q.x * this.dpi, q.y * this.dpi] as const), w, h);
    if (!poly) return [];
    const seen = new Uint8Array(w * h);
    const out: { at: Pt; count: number }[] = [];
    const minPx = minArea * this.dpi * this.dpi;
    for (let y = poly.y0; y <= poly.y1 && out.length < maxRegions; y++) {
      for (let x = poly.x0; x <= poly.x1; x++) {
        const i = y * w + x;
        if (!poly.mask[i] || seen[i] || map.barrier[i]) continue;
        if (map.dist && map.dist[i]! <= map.want) continue; // seed clear of lines, like a tap would be
        const r = fillFrom(map, x, y, true);
        if (!r) {
          seen[i] = 1;
          continue;
        }
        for (let yy = r.y0; yy <= r.y1; yy++) for (let xx = r.x0; xx <= r.x1; xx++) if (r.mask[yy * w + xx]) seen[yy * w + xx] = 1;
        if (r.count >= minPx) out.push({ at: { x: (x + 0.5) / this.dpi, y: (y + 0.5) / this.dpi }, count: r.count });
      }
    }
    return out;
  }
}

/** Distinct, print-friendly flat colours (muted, spread around the hue wheel). */
export function flatColours(n: number, seed = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const hue = ((seed * 0.13 + i * 0.618034) % 1) * 360;
    const l = 0.62 + ((i * 7) % 3) * 0.08;
    const s = 0.42 + ((i * 5) % 4) * 0.08;
    out.push(hslHex(hue, s, l));
  }
  return out;
}

function hslHex(hh: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

// ---------------------------------------------------------------------------------------------
// Closure check: open line ends

/**
 * Stroke ends that don't meet anything: no wall (line or panel border) within `reach` inches
 * (the gap-closing distance). The stroke's own last stretch doesn't count, so a loop that closes
 * on its own start is closed. `walls` is line alpha, w*h, at `dpi`.
 */
export function openEnds(strokes: readonly Stroke[], walls: Uint8Array, w: number, h: number, dpi: number, reach: number, threshold = FILL_THRESHOLD): Pt[] {
  const out: Pt[] = [];
  const own = 0.15; // inches of the stroke behind each end that are "itself"
  for (const s of strokes) {
    if (s.erase || s.pts.length < 2) continue;
    for (const end of [0, 1] as const) {
      const pts = end ? [...s.pts].reverse() : s.pts;
      // the stretch behind this end
      const tail: Pt[] = [pts[0]!];
      let len = 0;
      for (let i = 1; i < pts.length && len < own; i++) {
        len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
        tail.push(pts[i]!);
      }
      const e = tail[0]!;
      const half = s.w / 2 + 1.5 / dpi;
      const nearTail = (q: Pt) => tail.some((t, i) => i > 0 && segDist(q, tail[i - 1]!, t) < half);
      // closed when any other line (or its own far end, as a loop does, or a panel wall) is
      // within gap-closing reach: exactly when a fill would treat it as closed
      let closed = false;
      const ring = half + reach + 1 / dpi;
      const ex = Math.floor(e.x * dpi);
      const ey = Math.floor(e.y * dpi);
      const rp = Math.ceil(ring * dpi);
      for (let y = ey - rp; y <= ey + rp && !closed; y++) {
        for (let x = ex - rp; x <= ex + rp; x++) {
          const q = { x: (x + 0.5) / dpi, y: (y + 0.5) / dpi };
          if (Math.hypot(q.x - e.x, q.y - e.y) > ring) continue;
          if (x < 0 || y < 0 || x >= w || y >= h) {
            closed = true;
            break;
          }
          if (walls[y * w + x]! < threshold || nearTail(q)) continue;
          closed = true;
          break;
        }
      }
      if (!closed) out.push({ ...e });
    }
  }
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
