// Vendored from 2Dope src/core/selxform.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { applyPoint, IDENTITY, invert, isIdentity, matrixFor, transformedRect, transformRegion, transformVectors, unionRect } from './selxform';
import type { StrokeRecord } from './stroke';

const w = 12, h = 12;
const full = { x: 0, y: 0, w, h };

/** A plane with one opaque red pixel at (x, y) and a mask covering the 3×3 block around it. */
function scene(x: number, y: number) {
  const src = new Uint8ClampedArray(w * h * 4);
  src.set([255, 0, 0, 255], (y * w + x) * 4);
  const mask = new Uint8Array(w * h);
  for (let j = y - 1; j <= y + 1; j++) for (let i = x - 1; i <= x + 1; i++) mask[j * w + i] = 1;
  return { src, mask };
}
const alphaAt = (d: Uint8ClampedArray, x: number, y: number) => d[(y * w + x) * 4 + 3]!;

describe('selection transform matrix', () => {
  it('identity maps points to themselves, and detects itself', () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(applyPoint(matrixFor(IDENTITY, 5, 5), 3, 7)).toEqual([3, 7]);
  });

  it('moves, scales and rotates about the pivot', () => {
    expect(applyPoint(matrixFor({ ...IDENTITY, dx: 4, dy: -2 }, 5, 5), 5, 5)).toEqual([9, 3]);
    const s = applyPoint(matrixFor({ ...IDENTITY, scale: 2 }, 5, 5), 6, 5);
    expect(s[0]).toBeCloseTo(7); expect(s[1]).toBeCloseTo(5);
    const r = applyPoint(matrixFor({ ...IDENTITY, rotate: 90 }, 5, 5), 6, 5);
    expect(r[0]).toBeCloseTo(5); expect(r[1]).toBeCloseTo(6);
  });

  it('flips mirror about the pivot', () => {
    const [x, y] = applyPoint(matrixFor({ ...IDENTITY, flipH: true }, 5, 5), 7, 3);
    expect(x).toBeCloseTo(3); expect(y).toBeCloseTo(3);
    const v = applyPoint(matrixFor({ ...IDENTITY, flipV: true }, 5, 5), 7, 3);
    expect(v[0]).toBeCloseTo(7); expect(v[1]).toBeCloseTo(7);
  });

  it('inverts, and refuses a collapsed transform', () => {
    const m = matrixFor({ dx: 3, dy: 1, scale: 1.5, rotate: 30, flipH: true, flipV: false }, 6, 6);
    const back = applyPoint(invert(m)!, ...applyPoint(m, 2, 9));
    expect(back[0]).toBeCloseTo(2); expect(back[1]).toBeCloseTo(9);
    expect(invert(matrixFor({ ...IDENTITY, scale: 0 }, 5, 5))).toBeNull();
  });

  it('a transformed rect is clipped to the plane and unions with another', () => {
    const r = transformedRect(matrixFor({ ...IDENTITY, dx: 100 }, 5, 5), { x0: 2, y0: 2, x1: 8, y1: 8 }, w, h);
    expect(r).toBeNull();
    expect(unionRect({ x: 1, y: 1, w: 2, h: 2 }, { x: 5, y: 4, w: 3, h: 3 })).toEqual({ x: 1, y: 1, w: 7, h: 6 });
  });
});

describe('selection transform pixels', () => {
  it('an identity transform changes nothing', () => {
    const { src, mask } = scene(5, 5);
    expect(Array.from(transformRegion(src, w, h, mask, matrixFor(IDENTITY, 5, 5), full))).toEqual(Array.from(src));
  });

  it('moving lifts the pixel out of its old place and lands it exactly', () => {
    const { src, mask } = scene(4, 4);
    const out = transformRegion(src, w, h, mask, matrixFor({ ...IDENTITY, dx: 3, dy: 2 }, 4, 4), full);
    expect(alphaAt(out, 4, 4)).toBe(0);
    expect(Array.from(out.slice((6 * w + 7) * 4, (6 * w + 7) * 4 + 4))).toEqual([255, 0, 0, 255]);
  });

  it('flipping across the pivot puts the pixel on the other side', () => {
    const { src, mask } = scene(6, 5);
    const out = transformRegion(src, w, h, mask, matrixFor({ ...IDENTITY, flipH: true }, 5, 5), full);
    // the pixel centre is at 6.5, mirrored about the pivot at x = 5 -> 3.5, which is pixel 3
    expect(alphaAt(out, 6, 5)).toBe(0);
    expect(alphaAt(out, 3, 5)).toBe(255);
  });

  it('a quarter turn is exact for a pixel on the pivot row', () => {
    const { src, mask } = scene(8, 5);
    const out = transformRegion(src, w, h, mask, matrixFor({ ...IDENTITY, rotate: 90 }, 6, 6), full);
    expect(alphaAt(out, 8, 5)).toBe(0);
    let lit = 0;
    for (let i = 3; i < out.length; i += 4) if (out[i]! > 250) lit++;
    expect(lit).toBe(1);
  });

  it('unselected pixels never move, and moved art draws over them', () => {
    const { src, mask } = scene(4, 4);
    src.set([0, 0, 255, 255], (4 * w + 9) * 4); // blue, outside the selection
    const out = transformRegion(src, w, h, mask, matrixFor({ ...IDENTITY, dx: 5 }, 4, 4), full);
    expect(Array.from(out.slice((4 * w + 9) * 4, (4 * w + 9) * 4 + 4))).toEqual([255, 0, 0, 255]); // red over blue
    src.set([0, 255, 0, 255], (10 * w + 10) * 4);
    const still = transformRegion(src, w, h, mask, matrixFor({ ...IDENTITY, dx: 5 }, 4, 4), full);
    expect(Array.from(still.slice((10 * w + 10) * 4, (10 * w + 10) * 4 + 4))).toEqual([0, 255, 0, 255]);
  });

  it('a region result only covers the region', () => {
    const { src, mask } = scene(4, 4);
    const out = transformRegion(src, w, h, mask, matrixFor(IDENTITY, 4, 4), { x: 3, y: 3, w: 3, h: 3 });
    expect(out.length).toBe(3 * 3 * 4);
    expect(out[(1 * 3 + 1) * 4 + 3]).toBe(255);
  });
});

describe('selection transform vectors', () => {
  const stroke = (id: string, pts: [number, number][]): StrokeRecord => ({
    id, tool: 'pen', color: '#000000', seed: 1,
    brush: { size: 4 } as StrokeRecord['brush'],
    points: pts.map(([x, y]) => ({ x, y, pressure: 1, tiltX: 0, tiltY: 0, t: 0 })),
  });

  it('moves only strokes that sit wholly inside, scaling their width', () => {
    const mask = new Uint8Array(w * h);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) mask[y * w + x] = 1;
    const inside = stroke('a', [[3, 3], [6, 6]]);
    const crossing = stroke('b', [[5, 5], [10, 10]]);
    const m = matrixFor({ ...IDENTITY, dx: 2, scale: 2 }, 5, 5);
    const r = transformVectors([inside, crossing], mask, w, h, m, 2);
    expect(r.moved).toBe(1);
    expect(r.vectors[1]).toBe(crossing);
    expect(r.vectors[0]!.brush.size).toBe(8);
    expect(r.vectors[0]!.points[0]!.x).toBeCloseTo(1 + 2); // (3-5)*2+5+2
    expect(inside.points[0]!.x).toBe(3); // the original is untouched
  });

  it('returns the same array when nothing qualifies', () => {
    const list = [stroke('c', [[1, 1], [10, 10]])];
    expect(transformVectors(list, new Uint8Array(w * h), w, h, matrixFor(IDENTITY, 5, 5), 1).vectors).toBe(list);
  });
});

describe('freeform and exact masks', () => {
  it('stretches across and down on their own, and counts it in the overall scale', async () => {
    const { matrixFor, applyPoint, overallScale, isIdentity, IDENTITY } = await import('./selxform');
    const m = matrixFor({ ...IDENTITY, sx: 2, sy: 0.5 }, 10, 10);
    expect(applyPoint(m, 12, 12)).toEqual([14, 11]);
    expect(overallScale({ ...IDENTITY, sx: 4, sy: 1 })).toBe(2);
    expect(isIdentity({ ...IDENTITY, sx: 1, sy: 1 })).toBe(true);
    expect(isIdentity({ ...IDENTITY, sx: 1.5 })).toBe(false);
  });

  it('moves a selection mask with the transform', async () => {
    const { matrixFor, transformMask, IDENTITY } = await import('./selxform');
    const w = 8, h = 4;
    const mask = new Uint8Array(w * h);
    mask[1 * w + 1] = 1;
    const out = transformMask(mask, w, h, matrixFor({ ...IDENTITY, dx: 3 }, 1.5, 1.5), { x: 0, y: 0, w, h });
    expect(out[1 * w + 4]).toBe(1);
    expect(out[1 * w + 1]).toBe(0);
  });
});
