// Vendored from 2Dope src/fill/fill.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Flood fill for line art, written to avoid the usual problems:
 *
 * - Soft anti-aliased line edges count as line (barrier threshold on alpha), so there is no
 *   one-pixel gap between the fill and the line.
 * - The fill then grows *underneath* the line, only through pixels the line covers (alpha > 0).
 *   Because the fill lives on a plane below the line plane, the overlap is invisible except where
 *   the line is semi-transparent, and there it shows fill color instead of white: no halo, and
 *   the fill can never leak through a line (it cannot enter pixels the line does not touch).
 * - Gaps up to `gap` px are closed with a distance-limited barrier. The seed's own distance to
 *   the nearest line caps the closing radius, so clicking near a line never gets blocked.
 *
 * Pure functions on typed arrays (no DOM), so they are unit-tested in Node.
 */

export interface FillOptions {
  /** Line alpha (0..255) at or above which a pixel blocks the fill. */
  threshold: number;
  /** Close gaps in the line up to this many pixels wide (0 = off). */
  gap: number;
  /** How far the fill grows under the line, in pixels (about the line's soft-edge width). */
  under: number;
}

export const DEFAULT_FILL: FillOptions = { threshold: 24, gap: 4, under: 2 };

export interface FillResult {
  /** 1 where the fill paints, width*height. */
  mask: Uint8Array;
  /** Inclusive bounding box of the painted pixels. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
}

const FAR = 255;

/** Distance (4-neighbour steps) to the nearest barrier pixel, capped: 0 on barriers, FAR beyond `cap`. */
function distanceToBarrier(barrier: Uint8Array, w: number, h: number, cap: number): Uint8Array {
  const dist = new Uint8Array(barrier.length).fill(FAR);
  let frontier: number[] = [];
  for (let i = 0; i < barrier.length; i++) {
    if (barrier[i]) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; d <= cap && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && dist[i - 1] === FAR) ((dist[i - 1] = d), next.push(i - 1));
      if (x < w - 1 && dist[i + 1] === FAR) ((dist[i + 1] = d), next.push(i + 1));
      if (y > 0 && dist[i - w] === FAR) ((dist[i - w] = d), next.push(i - w));
      if (y < h - 1 && dist[i + w] === FAR) ((dist[i + w] = d), next.push(i + w));
    }
    frontier = next;
  }
  return dist;
}

/** Nearest non-barrier pixel to (sx, sy) within `radius`, or -1. */
function nearestOpen(barrier: Uint8Array, w: number, h: number, sx: number, sy: number, radius: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      const d = dx * dx + dy * dy;
      if (!barrier[i] && d < bestD) {
        best = i;
        bestD = d;
      }
    }
  }
  return best;
}

/** Grow `mask` by up to `steps` pixels (4-neighbour) into pixels where `allow(i)` is true. */
function grow(mask: Uint8Array, w: number, h: number, frontier: number[], steps: number, allow: (i: number) => boolean): void {
  let cur = frontier;
  for (let s = 0; s < steps && cur.length; s++) {
    const next: number[] = [];
    const add = (j: number) => {
      if (!mask[j] && allow(j)) {
        mask[j] = 1;
        next.push(j);
      }
    };
    for (const i of cur) {
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) add(i - 1);
      if (x < w - 1) add(i + 1);
      if (y > 0) add(i - w);
      if (y < h - 1) add(i + w);
    }
    cur = next;
  }
}

/** Pixels of `mask` (inside the box) that touch an unset pixel. */
function boundary(mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) out.push(i);
    }
  }
  return out;
}

/**
 * What a drawing's line art means for filling, worked out once and reused for every fill on that
 * drawing until its lines change: the barrier (pixels that count as line) and each pixel's
 * distance to the nearest line (for gap closing). A tap then costs one flood, not a full scan.
 */
export interface FillMap {
  w: number;
  h: number;
  alpha: Uint8Array;
  barrier: Uint8Array;
  /** Distance to the nearest barrier pixel, capped at `want` (null when gap closing is off). */
  dist: Uint8Array | null;
  /** Gap-closing radius asked for (half the gap). */
  want: number;
  opts: FillOptions;
}

export function prepareFill(alpha: Uint8Array, w: number, h: number, opts: FillOptions = DEFAULT_FILL): FillMap {
  const N = w * h;
  const barrier = new Uint8Array(N);
  for (let i = 0; i < N; i++) barrier[i] = alpha[i]! >= opts.threshold ? 1 : 0;
  const want = Math.max(0, Math.ceil(opts.gap / 2));
  const dist = want > 0 ? distanceToBarrier(barrier, w, h, want) : null;
  return { w, h, alpha, barrier, dist, want, opts };
}

/**
 * Compute the fill for a click at (sx, sy) on a line-alpha image (`alpha`, width*height, 0..255).
 * Returns null when there is nothing to fill (the click is buried inside a solid line).
 */
export function computeFill(alpha: Uint8Array, w: number, h: number, sx: number, sy: number, opts: FillOptions = DEFAULT_FILL): FillResult | null {
  return fillFrom(prepareFill(alpha, w, h, opts), sx, sy);
}

/**
 * The fill for a seed on a prepared map. `exact` refuses seeds on a line instead of moving them to
 * the nearest open pixel (drag and lasso fills use it, so a finger crossing a line does not fill
 * the region on the other side by accident).
 */
export function fillFrom(map: FillMap, sx: number, sy: number, exact = false, selection?: Uint8Array): FillResult | null {
  const { w, h, alpha, barrier, dist, want, opts } = map;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const N = w * h;
  let seed = sy * w + sx;
  if (selection && !selection[seed]) return null;
  if (barrier[seed]) {
    if (exact) return null;
    seed = nearestOpen(barrier, w, h, sx, sy, 3);
    if (seed < 0) return null;
  }
  if (selection && !selection[seed]) return null;

  // Gap closing: block pixels within `rr` of a line. rr is capped so the seed itself stays open.
  const rr = dist ? Math.min(want, Math.max(0, dist[seed]! - 1)) : 0;
  const inside = (i: number) => !selection || !!selection[i];
  const open = (i: number) => inside(i) && (dist ? dist[i]! > rr : !barrier[i]);

  // Flood fill from the seed through open pixels.
  const mask = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  stack[sp++] = seed;
  mask[seed] = 1;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  while (sp > 0) {
    const i = stack[--sp]!;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (x > 0 && !mask[i - 1] && open(i - 1)) ((mask[i - 1] = 1), (stack[sp++] = i - 1));
    if (x < w - 1 && !mask[i + 1] && open(i + 1)) ((mask[i + 1] = 1), (stack[sp++] = i + 1));
    if (y > 0 && !mask[i - w] && open(i - w)) ((mask[i - w] = 1), (stack[sp++] = i - w));
    if (y < h - 1 && !mask[i + w] && open(i + w)) ((mask[i + w] = 1), (stack[sp++] = i + w));
  }

  // Give back the closing band: grow `rr` pixels into pixels that are not line themselves.
  if (rr > 0) {
    const f = boundary(mask, w, h, x0, y0, x1, y1);
    grow(mask, w, h, f, rr, (j) => inside(j) && !barrier[j] && dist![j]! <= rr);
  }

  // Grow under the line, only through pixels the line covers.
  if (opts.under > 0) {
    const bx0 = Math.max(0, x0 - rr - 1);
    const by0 = Math.max(0, y0 - rr - 1);
    const bx1 = Math.min(w - 1, x1 + rr + 1);
    const by1 = Math.min(h - 1, y1 + rr + 1);
    const f = boundary(mask, w, h, bx0, by0, bx1, by1);
    grow(mask, w, h, f, opts.under, (j) => inside(j) && alpha[j]! > 0);
  }

  // Final bounding box and count.
  const pad = rr + opts.under + 1;
  const fx0 = Math.max(0, x0 - pad);
  const fy0 = Math.max(0, y0 - pad);
  const fx1 = Math.min(w - 1, x1 + pad);
  const fy1 = Math.min(h - 1, y1 + pad);
  let count = 0;
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  for (let y = fy0; y <= fy1; y++) {
    for (let x = fx0; x <= fx1; x++) {
      if (mask[y * w + x]) {
        count++;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  if (count === 0) return null;
  return { mask, x0: bx0, y0: by0, x1: bx1, y1: by1, count };
}

// ---------------------------------------------------------------------------------------------
// Lasso fill: fill every closed area inside a drawn loop (Clip Studio's "enclose and fill")

export interface Area {
  mask: Uint8Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pixels inside a closed polygon (even-odd rule, pixel centres), with its bounding box. */
export function polygonMask(points: readonly (readonly [number, number])[], w: number, h: number): Area | null {
  if (points.length < 3) return null;
  const ys = points.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  if (y1 < y0) return null;
  const mask = new Uint8Array(w * h);
  let x0 = w;
  let x1 = -1;
  let top = h;
  let bottom = -1;
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[(i + 1) % points.length]!;
      if (ay <= cy !== by <= cy) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1]! - 0.5));
      if (from > to) continue;
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
      x0 = Math.min(x0, from);
      x1 = Math.max(x1, to);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return x1 < 0 ? null : { mask, x0, y0: top, x1, y1: bottom };
}

/**
 * Every closed area inside the lasso, as one fill. An area counts when at least `minInside` of
 * it lies inside the loop, so the background (or an area leaking through a big gap) is left out.
 */
export function lassoFill(map: FillMap, poly: Area, minInside = 0.9, maxRegions = 2000): FillResult | null {
  const { w, h, barrier, dist, want } = map;
  const visited = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  let count = 0;
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  let regions = 0;
  for (let y = poly.y0; y <= poly.y1 && regions < maxRegions; y++) {
    for (let x = poly.x0; x <= poly.x1; x++) {
      const i = y * w + x;
      if (!poly.mask[i] || visited[i] || barrier[i]) continue;
      // only seed from pixels clear of the lines, so gaps stay closed for every area
      if (dist && dist[i]! <= want) continue;
      const r = fillFrom(map, x, y, true);
      if (!r) continue;
      regions++;
      let inside = 0;
      for (let yy = r.y0; yy <= r.y1; yy++) {
        for (let xx = r.x0; xx <= r.x1; xx++) {
          const j = yy * w + xx;
          if (!r.mask[j]) continue;
          visited[j] = 1;
          if (poly.mask[j]) inside++;
        }
      }
      if (inside / r.count < minInside) continue;
      for (let yy = r.y0; yy <= r.y1; yy++) {
        for (let xx = r.x0; xx <= r.x1; xx++) {
          const j = yy * w + xx;
          if (r.mask[j] && !out[j]) {
            out[j] = 1;
            count++;
          }
        }
      }
      bx0 = Math.min(bx0, r.x0);
      by0 = Math.min(by0, r.y0);
      bx1 = Math.max(bx1, r.x1);
      by1 = Math.max(by1, r.y1);
    }
  }
  return count ? { mask: out, x0: bx0, y0: by0, x1: bx1, y1: by1, count } : null;
}

// ---------------------------------------------------------------------------------------------
// Leftover brush: scrub over specks the fill missed (Clip Studio's "paint unfilled area")

export interface Hole {
  /** Pixel indices to paint. */
  pixels: number[];
  /** 0xRRGGBB: the colour around the hole (or the fallback when nothing around it is filled). */
  rgb: number;
}

function neighbours(i: number, w: number, h: number): number[] {
  const x = i % w;
  const y = (i - x) / w;
  return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
}

/**
 * Small unfilled holes under a brushed area. A hole is a patch of unfilled, non-line pixels that
 * touches the brushed area and is enclosed (its flood stays within `maxArea` pixels); big empty
 * areas are left alone. Each hole takes the commonest fill colour along its edge, and grows
 * `under` pixels under the line like a normal fill.
 */
export function leftoverHoles(
  fill: Uint8ClampedArray,
  lineAlpha: Uint8Array,
  w: number,
  h: number,
  brush: Area,
  opts: { threshold: number; maxArea: number; under: number; fallback: number },
): Hole[] {
  const seen = new Uint8Array(w * h);
  const holes: Hole[] = [];
  const unfilled = (i: number) => fill[i * 4 + 3] === 0;
  const passable = (i: number) => unfilled(i) && lineAlpha[i]! < opts.threshold;
  for (let y = brush.y0; y <= brush.y1; y++) {
    for (let x = brush.x0; x <= brush.x1; x++) {
      const s = y * w + x;
      if (!brush.mask[s] || seen[s] || !passable(s)) continue;
      // flood the patch, giving up once it is bigger than a speck
      const patch: number[] = [s];
      seen[s] = 1;
      let big = false;
      for (let k = 0; k < patch.length && !big; k++) {
        for (const j of neighbours(patch[k]!, w, h)) {
          if (j < 0 || seen[j] || !passable(j)) continue;
          seen[j] = 1;
          patch.push(j);
        }
        if (patch.length > opts.maxArea) big = true;
      }
      if (big) continue;
      // grow under the line edge, into unfilled pixels the line covers
      const inPatch = new Set(patch);
      let edge = patch;
      for (let step = 0; step < opts.under; step++) {
        const next: number[] = [];
        for (const i of edge) {
          for (const j of neighbours(i, w, h)) {
            if (j < 0 || inPatch.has(j) || !unfilled(j) || lineAlpha[j] === 0) continue;
            inPatch.add(j);
            next.push(j);
          }
        }
        edge = next;
      }
      // the commonest fill colour touching the hole
      const votes = new Map<number, number>();
      for (const i of inPatch) {
        for (const j of neighbours(i, w, h)) {
          if (j < 0 || unfilled(j)) continue;
          const c = (fill[j * 4]! << 16) | (fill[j * 4 + 1]! << 8) | fill[j * 4 + 2]!;
          votes.set(c, (votes.get(c) ?? 0) + 1);
        }
      }
      let rgb = opts.fallback;
      let best = 0;
      for (const [c, n] of votes) if (n > best) [rgb, best] = [c, n];
      holes.push({ pixels: [...inPatch], rgb });
    }
  }
  return holes;
}

/** Pixels within `radius` of a polyline (the leftover brush's path), with a bounding box. */
export function brushMask(points: readonly (readonly [number, number])[], radius: number, w: number, h: number): Area | null {
  if (!points.length) return null;
  const mask = new Uint8Array(w * h);
  const r = Math.max(0.5, radius);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  const dab = (cx: number, cy: number) => {
    const ax = Math.max(0, Math.floor(cx - r));
    const bx = Math.min(w - 1, Math.ceil(cx + r));
    const ay = Math.max(0, Math.floor(cy - r));
    const by = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        mask[y * w + x] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  };
  dab(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, r / 2)));
    for (let k = 1; k <= steps; k++) dab(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
  }
  return x1 < 0 ? null : { mask, x0, y0, x1, y1 };
}
