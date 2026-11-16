/**
 * Turn a filled pixel area into an outline polygon (the Tone tool's Bucket). Pure, typed arrays in.
 *
 * `traceOutline` walks the pixel edges around one 4-connected area, so the result follows the
 * area exactly; `simplify` then removes the staircase. Holes inside the area are not traced: the
 * outline is the outer edge only.
 */

export interface PxPt {
  x: number;
  y: number;
}

/** Directions in order: east, south, west, north (y runs down). */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * The outer outline of the area `mask` marks, starting from its first pixel in reading order.
 * `box` is a rectangle that contains the area (so the scan stays small). Returns pixel-corner
 * points, or [] when the mask is empty.
 */
export function traceOutline(mask: Uint8Array, w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number }): PxPt[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let sx = -1;
  let sy = -1;
  find: for (let y = Math.max(0, box.y0); y <= Math.min(h - 1, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x <= Math.min(w - 1, box.x1); x++) {
      if (mask[y * w + x] === 1) {
        sx = x;
        sy = y;
        break find;
      }
    }
  }
  if (sx < 0) return [];
  // The region stays on the right-hand side. At vertex (vx, vy) the two cells ahead depend on the heading.
  const ahead = (vx: number, vy: number, d: number): [boolean, boolean] => {
    switch (d) {
      case 0: return [on(vx, vy - 1), on(vx, vy)];
      case 1: return [on(vx, vy), on(vx - 1, vy)];
      case 2: return [on(vx - 1, vy), on(vx - 1, vy - 1)];
      default: return [on(vx - 1, vy - 1), on(vx, vy - 1)];
    }
  };
  const out: PxPt[] = [];
  let vx = sx;
  let vy = sy;
  let d = 3; // arrived heading north along the first pixel's left edge
  const limit = 4 * (box.x1 - box.x0 + 3) * (box.y1 - box.y0 + 3);
  for (let step = 0; step < limit; step++) {
    const [left, right] = ahead(vx, vy, d);
    const nd = right ? (left ? (d + 3) % 4 : d) : (d + 1) % 4;
    if (nd !== d || step === 0) out.push({ x: vx, y: vy });
    d = nd;
    vx += DX[d]!;
    vy += DY[d]!;
    if (vx === sx && vy === sy && d === 3) break;
  }
  return out;
}

/** Douglas-Peucker on a closed outline: drops points within `eps` pixels of the straight line. */
export function simplify(points: readonly PxPt[], eps: number): PxPt[] {
  const n = points.length;
  if (n <= 3 || eps <= 0) return points.slice();
  // split the loop at the two points farthest apart, so both halves are open runs
  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const d = (points[i]!.x - points[0]!.x) ** 2 + (points[i]!.y - points[0]!.y) ** 2;
    if (d > best) {
      best = d;
      b = i;
    }
  }
  best = -1;
  for (let i = 0; i < n; i++) {
    const d = (points[i]!.x - points[b]!.x) ** 2 + (points[i]!.y - points[b]!.y) ** 2;
    if (d > best) {
      best = d;
      a = i;
    }
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const run = (from: number, to: number): PxPt[] => {
    // iterative Douglas-Peucker over indices from..to (inclusive, wrapping)
    const idx: number[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      idx.push(i);
      if (i === to) break;
    }
    const keep = new Uint8Array(idx.length);
    keep[0] = 1;
    keep[idx.length - 1] = 1;
    const stack: [number, number][] = [[0, idx.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      const p = points[idx[s]!]!;
      const q = points[idx[e]!]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      let far = -1;
      let dmax = eps;
      for (let i = s + 1; i < e; i++) {
        const r = points[idx[i]!]!;
        const dist = Math.abs(dy * (r.x - p.x) - dx * (r.y - p.y)) / len;
        if (dist > dmax) {
          dmax = dist;
          far = i;
        }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([s, far], [far, e]);
      }
    }
    return idx.filter((_, i) => keep[i]).map((i) => points[i]!);
  };
  const first = run(lo, hi);
  const second = run(hi, lo);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}
