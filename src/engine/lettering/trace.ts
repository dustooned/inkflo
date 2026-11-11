// Vendored from 2Dope src/lettering/trace.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * The outer edge of the biggest painted shape in a mask (for turning a painted balloon into a
 * caption). Portable: it works on a plain array of on/off cells, no DOM.
 */
import type { Pt } from './geometry';

/**
 * Outer contour (cell corners) of the largest 4-connected region of `mask` (w × h, 1 = painted).
 * Every side between a painted cell of that region and an unpainted one is an edge, directed so the
 * region is on its right; the edges chain into closed loops, and the longest loop is the outer edge.
 */
export function outerContour(input: Uint8Array, w: number, h: number): Pt[] {
  // thin lines (a few pixels, scaled down) touch only at corners on diagonals: grow every painted cell
  // by one so a drawn outline stays one connected shape
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!input[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) mask[Y * w + X] = 1; }
  }
  // label regions, keep the largest
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    let size = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      size++;
      if (x > 0 && mask[i - 1] && label[i - 1] === -1) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && label[i + 1] === -1) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && label[i - w] === -1) { label[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && label[i + w] === -1) { label[i + w] = id; stack.push(i + w); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (best < 0) return [];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === best;
  // directed edges between corners (corner index = y * (w + 1) + x), region on the right (clockwise)
  const W1 = w + 1, next = new Map<number, number[]>();
  const edge = (x0: number, y0: number, x1: number, y1: number) => { const a = y0 * W1 + x0, b = y1 * W1 + x1; const list = next.get(a); if (list) list.push(b); else next.set(a, [b]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) edge(x, y, x + 1, y);         // top: left to right
    if (!on(x + 1, y)) edge(x + 1, y, x + 1, y + 1); // right: down
    if (!on(x, y + 1)) edge(x + 1, y + 1, x, y + 1); // bottom: right to left
    if (!on(x - 1, y)) edge(x, y + 1, x, y);         // left: up
  }
  // chain the edges into loops; keep the longest (holes make shorter, inner loops)
  let longest: number[] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [start];
      let at = start;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const outs = next.get(at);
        if (!outs?.length) break;
        const to = outs.pop()!;
        if (!outs.length) next.delete(at);
        if (to === start) break;
        loop.push(to); at = to;
      }
      if (loop.length > longest.length) longest = loop;
    }
  }
  return longest.map(c => ({ x: c % W1, y: Math.floor(c / W1) }));
}
