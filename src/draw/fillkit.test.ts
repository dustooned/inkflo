import { describe, expect, it } from 'vitest';
import { FillKit, flatColours, openEnds, panelUnion, scaleMask } from './fillkit';
import type { Panel } from '../geom/carve';
import type { Fill, Stroke } from '../doc/model';
import { parseBookFile, stringifyBookFile, FORMAT, SCHEMA } from '../doc/schema';
import { newBook, newLayer, newPage } from '../doc/model';

// a 100×100 px world at 10 dpi: 10" square, one panel inset 1"
const W = 100;
const H = 100;
const DPI = 10;
const panel = (x0: number, y0: number, x1: number, y1: number, index = 0): Panel => ({
  index,
  pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  centroid: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
  bbox: { x0, y0, x1, y1 },
});
const P = panel(1, 1, 9, 9);

function lines(...rects: [number, number, number, number, number?][]): Uint8Array {
  const a = new Uint8Array(W * H);
  for (const [x0, y0, x1, y1, v] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * W + x] = v ?? 255;
  return a;
}
const kit = (alpha: Uint8Array, panels = [P]) => new FillKit(() => alpha, W, H, DPI, panels);
const fill = (x: number, y: number, extra: Partial<Fill> = {}): Fill => ({ at: { x, y }, color: '#C8553D', gap: 0, ...extra });

describe('fill kit', () => {
  it('the panel border is a wall even where the art does not close', () => {
    const k = kit(new Uint8Array(W * H));
    const m = k.mask(fill(5, 5))!;
    // the whole panel and not a pixel of the gutter
    expect(m.res.x0).toBeGreaterThanOrEqual(7); // 2px trap under the border, which the gutter covers
    expect(m.res.x1).toBeLessThanOrEqual(92);
    expect(m.res.count).toBeGreaterThan(70 * 70);
  });

  it('two carved panels that share a cut edge are walled from each other', () => {
    // the starter page shape: panels meet on the cut with no gap between their polygons
    const left = panel(0, 0, 5, 10, 0);
    const right = panel(5, 0, 10, 10, 1);
    // ink started off the page crosses the left panel and stops partway into the right one
    const k = kit(lines([0, 50, 70, 52]), [left, right]);
    const m = k.mask(fill(2, 2))!;
    expect(m.res.x1).toBeLessThan(52); // never enters the right panel
    expect(m.res.y1).toBeLessThan(52); // and does not go round the stroke's end
    expect(k.mask(fill(2, 8))!.res.y0).toBeGreaterThan(50);
  });

  it('a Gutters fill stays in its region (the gutter bands)', () => {
    const band = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 48; x <= 52; x++) band[y * W + x] = 1; // a vertical band
    const k = new FillKit(() => new Uint8Array(W * H), W, H, DPI, [P], band);
    const m = k.mask(fill(5, 5))!;
    expect(m.res.mask[50 * W + 50]).toBe(1);
    expect(m.res.mask[50 * W + 30]).toBe(0); // the panel either side is a wall
  });

  it('a vertical line splits the panel; the fill grows under the line', () => {
    const k = kit(lines([50, 0, 51, 99]));
    const m = k.mask(fill(3, 5))!;
    expect(m.res.x1).toBeGreaterThanOrEqual(50); // under the line
    expect(m.res.x1).toBeLessThan(53); // not past it
  });

  it('threshold: a faint line stops a low threshold, not a high one', () => {
    const a = lines([50, 0, 51, 99, 60]);
    expect(kit(a).mask(fill(3, 5, { threshold: 40 }))!.res.x1).toBeLessThan(53);
    expect(kit(a).mask(fill(3, 5, { threshold: 100 }))!.res.x1).toBeGreaterThan(80);
  });

  it('gap closing bridges a break in the line', () => {
    const a = lines([50, 0, 51, 45], [50, 49, 51, 99]); // 3px gap
    expect(kit(a).mask(fill(3, 5))!.res.x1).toBeGreaterThan(80); // leaks
    expect(kit(a).mask(fill(3, 5, { gap: 0.6 }))!.res.x1).toBeLessThan(53); // closed
  });

  it('grow and shrink move the edge by whole pixels', () => {
    const a = lines([50, 0, 51, 99]);
    const base = kit(a).mask(fill(3, 5))!.res.count;
    expect(kit(a).mask(fill(3, 5, { grow: 0.2 }))!.res.count).toBeGreaterThan(base);
    expect(kit(a).mask(fill(3, 5, { grow: -0.2 }))!.res.count).toBeLessThan(base);
  });

  it('enclose and fill takes every closed area inside the loop, not the big outside', () => {
    // two small boxes inside the panel
    const a = lines([20, 20, 40, 20], [20, 40, 40, 40], [20, 20, 20, 40], [40, 20, 40, 40], [50, 20, 70, 20], [50, 40, 70, 40], [50, 20, 50, 40], [70, 20, 70, 40]);
    const loop = [{ x: 1.5, y: 1.5 }, { x: 7.5, y: 1.5 }, { x: 7.5, y: 4.5 }, { x: 1.5, y: 4.5 }];
    const m = kit(a).mask(fill(1.5, 1.5, { lasso: loop }))!;
    expect(m.res.mask[30 * W + 30]).toBe(1);
    expect(m.res.mask[30 * W + 60]).toBe(1);
    expect(m.res.mask[80 * W + 80]).toBe(0);
  });

  it('auto flats finds one seed per closed area', () => {
    const a = lines([50, 0, 51, 99], [0, 50, 99, 51]); // a cross: four areas in the panel
    const seeds = kit(a).flats(P, { gap: 0 });
    expect(seeds).toHaveLength(4);
    expect(new Set(flatColours(4)).size).toBe(4);
  });

  it('leftover fills a speck with the colour around it', () => {
    const a = lines([30, 30, 32, 32]); // a dot of line, unfilled around it
    const colour = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = (i - x) / W;
      const speck = x >= 33 && x <= 34 && y >= 30 && y <= 31;
      if (!speck && !a[i]) colour.set([0x11, 0x22, 0x33, 255], i * 4);
    }
    const m = kit(a).mask(fill(3.4, 3.05, { leftover: { path: [{ x: 3.35, y: 3.05 }], r: 0.3 } }), colour)!;
    expect(m.res.mask[30 * W + 33]).toBe(1);
    expect(m.rgbAt!.get(30 * W + 33)).toBe(0x112233);
  });

  it('panelUnion and scaleMask behave at the edges', () => {
    const u = panelUnion([P], DPI, W, H);
    expect(u[50 * W + 50]).toBe(1);
    expect(u[5 * W + 5]).toBe(0);
    const r = { mask: new Uint8Array(W * H), x0: 50, y0: 50, x1: 50, y1: 50, count: 1 };
    r.mask[50 * W + 50] = 1;
    expect(scaleMask(r, -1, W, H, u)).toBeNull();
  });
});

describe('closure check', () => {
  const s = (pts: [number, number][]): Stroke => ({ pts: pts.map(([x, y]) => ({ x, y })), w: 0.1, brushId: 'g-pen', seed: 1 });

  it('finds an end that stops short, not one that meets a line', () => {
    const wall = lines([60, 10, 61, 90]); // a vertical line at x=6"
    const strokes = [s([[2, 5], [5.95, 5]]), s([[2, 3], [4, 3]])];
    const ends = openEnds(strokes, kit(wall).walls('refs'), W, H, DPI, 0.5);
    // stroke 1 meets the wall at its right end; its left end and both ends of stroke 2 are open
    expect(ends.map((e) => `${e.x},${e.y}`).sort()).toEqual(['2,3', '2,5', '4,3']);
  });

  it('two strokes meeting at a corner close each other', () => {
    const a = lines([20, 20, 40, 20], [40, 20, 40, 40]);
    const ends = openEnds([s([[2, 2], [4, 2]]), s([[4, 2], [4, 4]])], kit(a).walls('refs'), W, H, DPI, 0.3);
    expect(ends.map((e) => `${e.x},${e.y}`).sort()).toEqual(['2,2', '4,4']);
  });

  it('a loop that closes on itself has no open ends', () => {
    const loop = s([[3, 3], [6, 3], [6, 6], [3, 6], [3, 3.05]]);
    const a = lines([30, 30, 60, 30], [60, 30, 60, 60], [30, 60, 60, 60], [30, 30, 30, 60]);
    expect(openEnds([loop], kit(a).walls('refs'), W, H, DPI, 0.3)).toEqual([]);
  });
});

describe('fill data', () => {
  it('the new fill fields round-trip through book.json', () => {
    const book = newBook('Fills');
    const page = newPage();
    const l = newLayer('colour');
    l.fills.push(
      { at: { x: 1, y: 1 }, color: '#112233', gap: 0.02, threshold: 80, grow: -0.01, refer: 'all' },
      { at: { x: 1, y: 1 }, color: '#112233', gap: 0, exact: true },
      { at: { x: 1, y: 1 }, color: '#112233', gap: 0, lasso: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] },
      { at: { x: 1, y: 1 }, color: '#112233', gap: 0, leftover: { path: [{ x: 1, y: 1 }], r: 0.05 } },
    );
    page.groups.at(-1)!.layers.push(l);
    book.pages = [page];
    book.lastPageId = page.id;
    const back = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }));
    expect(back.book.pages[0]!.groups.at(-1)!.layers.at(-1)!.fills).toEqual(l.fills);
  });
});
