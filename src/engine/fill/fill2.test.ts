// Vendored from 2Dope src/fill/fill2.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { brushMask, DEFAULT_FILL, fillFrom, lassoFill, leftoverHoles, polygonMask, prepareFill } from './fill';

const W = 120;
const H = 80;

/** Hard 2-px lines: a box split in two cells (left 10..58, right 62..110), on an empty page. */
function twoCells(): Uint8Array {
  const a = new Uint8Array(W * H);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * W + x] = 255;
  };
  line(8, 8, 111, 9); // top
  line(8, 70, 111, 71); // bottom
  line(8, 8, 9, 71); // left
  line(110, 8, 111, 71); // right
  line(59, 8, 60, 71); // middle
  return a;
}

describe('prepared fill map', () => {
  it('fills from a prepared map like a one-off fill, and exact mode refuses seeds on a line', () => {
    const map = prepareFill(twoCells(), W, H, DEFAULT_FILL);
    const r = fillFrom(map, 30, 40)!;
    expect(r.mask[40 * W + 30]).toBe(1);
    expect(r.mask[40 * W + 80]).toBe(0);
    expect(fillFrom(map, 59, 40, true)).toBeNull();
    expect(fillFrom(map, 59, 40)).not.toBeNull(); // a tap on a line moves to the nearest open pixel
  });
});

describe('lasso fill', () => {
  it('polygonMask covers the inside of a loop', () => {
    const p = polygonMask(
      [
        [10, 10],
        [50, 10],
        [50, 40],
        [10, 40],
      ],
      W,
      H,
    )!;
    expect(p.mask[20 * W + 20]).toBe(1);
    expect(p.mask[5 * W + 5]).toBe(0);
    expect([p.x0, p.y0, p.x1, p.y1]).toEqual([10, 10, 49, 39]);
  });

  it('fills both cells inside the loop and leaves the background outside', () => {
    const map = prepareFill(twoCells(), W, H, DEFAULT_FILL);
    const loop = polygonMask(
      [
        [4, 4],
        [116, 4],
        [116, 76],
        [4, 76],
      ],
      W,
      H,
    )!;
    const r = lassoFill(map, loop)!;
    expect(r.mask[40 * W + 30]).toBe(1);
    expect(r.mask[40 * W + 80]).toBe(1);
    expect(r.mask[2 * W + 2]).toBe(0); // the page around the box reaches outside the loop
  });

  it('a loop around one cell fills only that cell', () => {
    const map = prepareFill(twoCells(), W, H, DEFAULT_FILL);
    const loop = polygonMask(
      [
        [5, 5],
        [57, 5],
        [57, 75],
        [5, 75],
      ],
      W,
      H,
    )!;
    const r = lassoFill(map, loop)!;
    expect(r.mask[40 * W + 30]).toBe(1);
    expect(r.mask[40 * W + 80]).toBe(0);
  });
});

describe('leftover brush', () => {
  it('fills a small unfilled speck with the colour around it, and leaves big empty areas alone', () => {
    const line = new Uint8Array(W * H);
    const fill = new Uint8ClampedArray(W * H * 4);
    // a filled red square 20..60 with a 3×3 hole at 40..42
    for (let y = 20; y < 60; y++) {
      for (let x = 20; x < 60; x++) {
        if (x >= 40 && x <= 42 && y >= 40 && y <= 42) continue;
        const o = (y * W + x) * 4;
        fill.set([255, 0, 0, 255], o);
      }
    }
    const brush = brushMask([[41, 41]], 4, W, H)!;
    const holes = leftoverHoles(fill, line, W, H, brush, { threshold: 24, maxArea: 50, under: 0, fallback: 0x0000ff });
    expect(holes).toHaveLength(1);
    expect(holes[0]!.pixels).toHaveLength(9);
    expect(holes[0]!.rgb).toBe(0xff0000);
    // scrubbing over the empty page outside: nothing
    const out = brushMask([[90, 10]], 4, W, H)!;
    expect(leftoverHoles(fill, line, W, H, out, { threshold: 24, maxArea: 50, under: 0, fallback: 0x0000ff })).toHaveLength(0);
  });

  it('a hole walled in by lines with nothing filled around it takes the fallback colour', () => {
    const line = twoCells();
    const fill = new Uint8ClampedArray(W * H * 4);
    const brush = brushMask([[30, 40]], 3, W, H)!;
    const holes = leftoverHoles(fill, line, W, H, brush, { threshold: 24, maxArea: 5000, under: 1, fallback: 0x00ff00 });
    expect(holes).toHaveLength(1);
    expect(holes[0]!.rgb).toBe(0x00ff00);
    expect(holes[0]!.pixels.length).toBeGreaterThan(48 * 60);
  });
});
