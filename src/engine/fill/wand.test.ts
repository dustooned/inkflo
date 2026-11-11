// Vendored from 2Dope src/fill/wand.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { colorRegion } from './wand';

/** A w×h RGBA image filled by a colour function. */
function image(w: number, h: number, at: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(at(x, y), (y * w + x) * 4);
  return px;
}
const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

describe('colorRegion', () => {
  // left half red, right half a slightly different red, a black wall at x = 6
  const px = image(10, 4, (x) => (x === 6 ? [0, 0, 0, 255] : x < 3 ? [200, 0, 0, 255] : [215, 0, 0, 255]));

  it('takes only the exact colour at threshold 0', () => {
    const r = colorRegion(px, 10, 4, 1, 1, 0)!;
    expect(count(r.mask)).toBe(12);
    expect([r.x0, r.x1, r.y0, r.y1]).toEqual([0, 2, 0, 3]);
  });

  it('grows across similar colours as the threshold rises, but stops at a wall', () => {
    const r = colorRegion(px, 10, 4, 1, 1, 0.1)!;
    expect(count(r.mask)).toBe(24); // x 0..5, not the wall, not beyond it
    expect(r.x1).toBe(5);
  });

  it('takes everything connected at threshold 1', () => {
    expect(count(colorRegion(px, 10, 4, 1, 1, 1)!.mask)).toBe(40);
  });

  it('treats empty paper as one colour, whatever its stored RGB', () => {
    const paper = image(6, 2, (x) => (x === 3 ? [0, 0, 255, 255] : x < 3 ? [10, 20, 30, 0] : [99, 0, 0, 0]));
    expect(count(colorRegion(paper, 6, 2, 0, 0, 0)!.mask)).toBe(6);
  });

  it('is 4-connected (a diagonal does not leak)', () => {
    const diag = image(3, 3, (x, y) => (x === y ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(count(colorRegion(diag, 3, 3, 0, 0, 0)!.mask)).toBe(1);
  });

  it('returns null outside the image', () => {
    expect(colorRegion(px, 10, 4, -1, 0, 0.5)).toBeNull();
    expect(colorRegion(px, 10, 4, 10, 0, 0.5)).toBeNull();
  });
});
