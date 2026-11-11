// Vendored from 2Dope src/fill/autopaint.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { autoPaintLimit, newlyEnclosed, readInkPaint } from './autopaint';

function outline(w: number, h: number, gap = false): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let x = 3; x < w - 3; x++) { a[3 * w + x] = 255; a[(h - 4) * w + x] = 255; }
  for (let y = 3; y < h - 3; y++) { a[y * w + 3] = 255; a[y * w + w - 4] = 255; }
  if (gap) a[3 * w + Math.floor(w / 2)] = 0;
  return a;
}
describe('newly enclosed automatic paint', () => {
  it('detects a new closed shape but never floods an open line or one-pixel gap', () => {
    const empty = new Uint8Array(400), closed = outline(20, 20), open = outline(20, 20, true);
    expect(newlyEnclosed(empty, open, 20, 20)).toBeNull();
    const r = newlyEnclosed(open, closed, 20, 20)!;
    expect(r.mask[10 * 20 + 10]).toBe(1); expect(r.mask[0]).toBe(0); expect(r.count).toBeGreaterThan(100);
    expect(newlyEnclosed(closed, closed, 20, 20)).toBeNull();
  });
  it('never paints old enclosures when another stroke or a dividing line is added', () => {
    const before = outline(30, 20), after = before.slice();
    for (let y = 3; y < 17; y++) after[y * 30 + 15] = 255;
    expect(newlyEnclosed(before, after, 30, 20)).toBeNull();
    const partial = new Uint8Array(60 * 20), full = partial.slice();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) partial[y * 60 + x] = full[y * 60 + x] = before[y * 30 + x]!;
    const second = outline(30, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) full[y * 60 + 30 + x] = second[y * 30 + x]!;
    const r = newlyEnclosed(partial, full, 60, 20)!; expect(r.mask[10 * 60 + 10]).toBe(0); expect(r.mask[10 * 60 + 40]).toBe(1);
  });
  it('overlaps under actual line pixels without leaking beyond them or treating the page edge as ink', () => {
    const a = outline(20, 20), r = newlyEnclosed(new Uint8Array(400), a, 20, 20)!;
    expect(r.mask[3 * 20 + 10]).toBe(1); expect(r.mask[2 * 20 + 10]).toBe(0);
    const edge = new Uint8Array(400); for (let y = 0; y < 20; y++) edge[y * 20 + 10] = 255;
    expect(newlyEnclosed(new Uint8Array(400), edge, 20, 20)).toBeNull();
  });
  it('ignores faint or removed lines and refuses malformed/oversized inputs before allocation', () => {
    const faint = outline(20, 20).map(a => a ? 23 : 0);
    expect(newlyEnclosed(new Uint8Array(400), faint, 20, 20)).toBeNull();
    expect(newlyEnclosed(outline(20, 20), new Uint8Array(400), 20, 20)).toBeNull();
    expect(() => newlyEnclosed(new Uint8Array(), new Uint8Array(), 10000, 10000)).toThrow('size');
    expect(() => newlyEnclosed(new Uint8Array(4), new Uint8Array(4), 3, 3)).toThrow();
  });
  it('repairs device preferences and uses a smaller work budget in Lite', () => {
    expect(readInkPaint(null)).toEqual({ enabled: false, ink: '#18181b' });
    expect(readInkPaint({ enabled: 'yes', ink: 'bad' })).toEqual(readInkPaint(null));
    expect(readInkPaint({ enabled: true, ink: '#123ABC' })).toEqual({ enabled: true, ink: '#123ABC' });
    expect(autoPaintLimit(true)).toBe(1280 * 720); expect(autoPaintLimit(false)).toBe(2048 * 2048);
  });
  it('matches a simple pixel-flood oracle across varied small barrier maps', () => {
    let seed = 12345; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const w = 13, h = 11, n = w * h;
    function open(a: Uint8Array) {
      const seen = new Uint8Array(n), stack: number[] = [];
      const add = (i: number) => { if (!seen[i] && a[i]! < 24) { seen[i] = 1; stack.push(i); } };
      for (let i = 0; i < n; i++) if (i < w || i >= n - w || i % w === 0 || i % w === w - 1) add(i);
      while (stack.length) { const i = stack.pop()!; if (i % w) add(i - 1); if (i % w < w - 1) add(i + 1); if (i >= w) add(i - w); if (i + w < n) add(i + w); }
      return seen;
    }
    for (let trial = 0; trial < 150; trial++) {
      const before = Uint8Array.from({ length: n }, () => random() < .4 ? 255 : 0), after = before.map(a => a || (random() < .15 ? 255 : 0));
      const a = open(before), b = open(after), expected = a.map((v,i) => v && !b[i] && !after[i] ? 1 : 0);
      for (let step = 0; step < 2; step++) {
        const prior = expected.slice();
        for (let i = 0; i < n; i++) if (after[i] && !prior[i] && ((i % w > 0 && prior[i - 1]) || (i % w < w - 1 && prior[i + 1]) || (i >= w && prior[i - w]) || (i + w < n && prior[i + w]))) expected[i] = 1;
      }
      expect(newlyEnclosed(before, after, w, h)?.mask ?? new Uint8Array(n)).toEqual(expected);
    }
  });
  for (const [w, h] of [[1280, 720], [1920, 1080], [2048, 2048]]) it(`bounds enclosure work on ${w}×${h}`, () => {
    const after = outline(w!, h!), before = after.slice(); before[3 * w! + Math.floor(w! / 2)] = 0;
    const start = performance.now(), r = newlyEnclosed(before, after, w!, h!)!, ms = performance.now() - start;
    expect(r.mask[Math.floor(h! / 2) * w! + Math.floor(w! / 2)]).toBe(1); expect(r.mask[0]).toBe(0);
    console.log(`Auto Paint topology ${w}×${h}: ${ms.toFixed(0)} ms`); expect(ms).toBeLessThan(1500);
  });
});
