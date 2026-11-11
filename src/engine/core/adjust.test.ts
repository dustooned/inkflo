// Vendored from 2Dope src/core/adjust.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { adjustHex, adjustRGB, applyBlur, applyHSB, keepOutside, symmetryCopies } from './adjust';

describe('adjustments', () => {
  it('leaves colours alone at zero and turns hue around the wheel', () => {
    expect(adjustRGB(200, 40, 40, { hue: 0, sat: 0, bright: 0 })).toEqual([200, 40, 40]);
    const [r, g, b] = adjustRGB(255, 0, 0, { hue: 120, sat: 0, bright: 0 });
    expect([r, g, b]).toEqual([0, 255, 0]);
    expect(adjustHex('#ff0000', { hue: 240, sat: 0, bright: 0 })).toBe('#0000ff');
  });

  it('desaturates to grey and brightens to white or black at the ends', () => {
    const [r, g, b] = adjustRGB(200, 40, 40, { hue: 0, sat: -100, bright: 0 });
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(adjustRGB(90, 30, 200, { hue: 0, sat: 0, bright: 100 })).toEqual([255, 255, 255]);
    expect(adjustRGB(90, 30, 200, { hue: 0, sat: 0, bright: -100 })).toEqual([0, 0, 0]);
  });

  it('keeps alpha and skips transparent pixels', () => {
    const src = new Uint8ClampedArray([255, 0, 0, 128, 9, 9, 9, 0]);
    const dst = new Uint8ClampedArray(8);
    applyHSB(src, dst, { hue: 120, sat: 0, bright: 0 });
    expect([...dst]).toEqual([0, 255, 0, 128, 9, 9, 9, 0]);
  });

  it('blurs a dot into its neighbours without darkening its colour', () => {
    const w = 9, h = 9;
    const src = new Uint8ClampedArray(w * h * 4);
    const c = (4 * w + 4) * 4;
    src.set([255, 0, 0, 255], c);
    const dst = new Uint8ClampedArray(src.length);
    applyBlur(src, dst, w, h, 2);
    expect(dst[c + 3]!).toBeLessThan(255);
    expect(dst[c + 3]!).toBeGreaterThan(0);
    const n = (4 * w + 5) * 4;
    expect(dst[n + 3]!).toBeGreaterThan(0);
    expect(dst[n]!).toBeGreaterThan(250); // still red, not dark red
    let total = 0;
    for (let i = 3; i < dst.length; i += 4) total += dst[i]!;
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(300);
  });
});

describe('symmetry', () => {
  it('mirrors and rotates points around the centre', () => {
    expect(symmetryCopies('off', 50, 50, 10, 20, 0)).toHaveLength(1);
    const v = symmetryCopies('vertical', 50, 50, 10, 20, 0);
    expect(v[1]).toMatchObject({ x: 90, y: 20 });
    const q = symmetryCopies('quadrant', 50, 50, 10, 20, 0);
    expect(q.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[10, 20], [90, 20], [10, 80], [90, 80]]);
    const r = symmetryCopies('radial', 50, 50, 50, 10, 0);
    expect(r).toHaveLength(8);
    expect(Math.round(r[2]!.x)).toBe(90);
    expect(Math.round(r[2]!.y)).toBe(50);
  });
});

describe('keepOutside', () => {
  it('puts back the pixels outside the selection and keeps the adjusted ones inside', () => {
    // a 4×2 document, block = columns 1..2 of both rows; only document pixel (2, 1) is selected
    const mask = new Uint8Array(8); mask[1 * 4 + 2] = 1;
    const rect = { x: 1, y: 0, w: 2, h: 2 };
    const before = new Uint8ClampedArray(16).fill(10), out = new Uint8ClampedArray(16).fill(200);
    keepOutside(out, before, mask, 4, rect);
    const block = (x: number, y: number) => out[(y * 2 + x) * 4];
    expect([block(0, 0), block(1, 0), block(0, 1), block(1, 1)]).toEqual([10, 10, 10, 200]);
  });
});
