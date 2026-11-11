// Vendored from 2Dope src/fill/autopaint.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import type { FillResult } from './fill';

export const AUTO_PAINT_THRESHOLD = 24;
export const AUTO_PAINT_KEY = '2dope.inkpaint';
export const autoPaintLimit = (lite: boolean) => lite ? 1280 * 720 : 2048 * 2048;
export interface InkPaintPrefs { enabled: boolean; ink: string }
export function readInkPaint(value: unknown): InkPaintPrefs {
  const v = value as Partial<InkPaintPrefs> | null;
  return { enabled: v?.enabled === true, ink: typeof v?.ink === 'string' && /^#[0-9a-f]{6}$/i.test(v.ink) ? v.ink : '#18181b' };
}

/** Border-connected empty pixels. The page edge and selection edge never close an outline. */
function exterior(alpha: Uint8Array, w: number, h: number, queue: Int32Array): Uint8Array {
  const seen = new Uint8Array(w * h); let head = 0, tail = 0;
  const add = (i: number) => { if (!seen[i] && alpha[i]! < AUTO_PAINT_THRESHOLD) { seen[i] = 2; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++]!;
    if (seen[i] === 1) continue;
    const row = i - i % w; let left = i, right = i;
    while (left > row && seen[left - 1] !== 1 && alpha[left - 1]! < AUTO_PAINT_THRESHOLD) left--;
    while (right + 1 < row + w && seen[right + 1] !== 1 && alpha[right + 1]! < AUTO_PAINT_THRESHOLD) right++;
    let up = false, down = false;
    for (let j = left; j <= right; j++) {
      seen[j] = 1;
      if (row >= w && seen[j - w] !== 1 && alpha[j - w]! < AUTO_PAINT_THRESHOLD) { if (!up) add(j - w); up = true; } else up = false;
      if (row + w < seen.length && seen[j + w] !== 1 && alpha[j + w]! < AUTO_PAINT_THRESHOLD) { if (!down) add(j + w); down = true; } else down = false;
    }
  }
  return seen;
}

/** Only areas that changed from open to enclosed, plus a two-pixel overlap beneath actual ink.
 * No gap closing, old-region recolouring, selection-as-wall or painting outside the page.
 * Call after committing the stroke; predicted points and live buffers are never inputs.
 */
export function newlyEnclosed(before: Uint8Array, after: Uint8Array, w: number, h: number): FillResult | null {
  const n = w * h;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || n > autoPaintLimit(false) || before.length !== n || after.length !== n) throw new Error('Unsupported Auto Paint page size.');
  let added = false;
  for (let i = 0; i < n; i++) if (before[i]! < AUTO_PAINT_THRESHOLD && after[i]! >= AUTO_PAINT_THRESHOLD) { added = true; break; }
  if (!added) return null;
  const queue = new Int32Array(n), mask = exterior(before, w, h, queue), open = exterior(after, w, h, queue);
  let tail = 0;
  for (let i = 0; i < n; i++) {
    mask[i] = mask[i] && !open[i] && after[i]! < AUTO_PAINT_THRESHOLD ? 1 : 0;
    if (mask[i]) queue[tail++] = i;
  }
  if (!tail) return null;
  // Grow solely through ink-covered pixels; this cannot enter transparent space beyond a line.
  let head = 0;
  for (let step = 0; step < 2; step++) {
    const end = tail;
    const add = (i: number) => { if (!mask[i] && after[i]! > 0) { mask[i] = 1; queue[tail++] = i; } };
    while (head < end) {
      const i = queue[head++]!, x = i % w;
      if (x) add(i - 1); if (x + 1 < w) add(i + 1);
      if (i >= w) add(i - w); if (i + w < n) add(i + w);
    }
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let k = 0; k < tail; k++) { const i = queue[k]!, x = i % w, y = (i - x) / w; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { mask, count: tail, x0, y0, x1, y1 };
}
