import { describe, expect, it } from 'vitest';
import { darknessField, gradientField, screenAlpha, stopDensity, threshold, type ToneShape } from './halftone';

const SHAPES: ToneShape[] = ['dot', 'square', 'diamond', 'line', 'cross'];

/** Mean ink coverage of a flat tone over a patch many cells wide. */
function coverage(shape: ToneShape, d: number, angle = 45, smooth = false): number {
  const w = 600, h = 600, alpha = new Uint8ClampedArray(w * h);
  screenAlpha(alpha, { width: w, height: h, x0: 0.13, y0: 0.27, scale: 600 }, { shape, frequency: 60, angle }, () => d, smooth);
  let sum = 0;
  for (const v of alpha) sum += v;
  return sum / 255 / alpha.length;
}

describe('halftone screening', () => {
  it('inks exactly the requested tone for every shape (crisp dots, 600 dpi, 60 lpi)', () => {
    for (const shape of SHAPES) {
      for (const d of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        expect(Math.abs(coverage(shape, d) - d), `${shape} at ${d * 100}%`).toBeLessThan(0.012);
      }
    }
  });

  it('keeps the tone with smoothed screen edges, and at other angles', () => {
    for (const d of [0.2, 0.5, 0.8]) {
      expect(Math.abs(coverage('dot', d, 45, true) - d)).toBeLessThan(0.015);
      expect(Math.abs(coverage('dot', d, 15) - d)).toBeLessThan(0.012);
    }
  });

  it('prints 0% as paper and 100% as solid', () => {
    expect(coverage('dot', 0)).toBe(0);
    expect(coverage('dot', 1)).toBe(1);
  });

  it('grows round dots from the cell centre and leaves holes at the corners past 50%', () => {
    expect(threshold('dot', 0, 0)).toBeLessThan(0.01);
    expect(threshold('dot', 0.49, 0.49)).toBeGreaterThan(0.99);
    expect(threshold('dot', 0.2, 0)).toBeCloseTo(threshold('dot', 0, 0.2), 3);
  });
});

describe('tone fields', () => {
  it('interpolates a stack of stops', () => {
    const stops = [{ at: 0, density: 0 }, { at: 0.5, density: 0.6 }, { at: 1, density: 0.2 }];
    expect(stopDensity(stops, 0.25)).toBeCloseTo(0.3);
    expect(stopDensity(stops, 0.75)).toBeCloseTo(0.4);
    expect(stopDensity(stops, 2)).toBeCloseTo(0.2);
  });

  it('runs linear and radial gradients from one point to another', () => {
    const lin = gradientField({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, stops: [{ at: 0, density: 0 }, { at: 1, density: 1 }] });
    expect(lin(1, 5)).toBeCloseTo(0.5);
    expect(lin(-1, 0)).toBe(0);
    const rad = gradientField({ kind: 'radial', from: { x: 1, y: 1 }, to: { x: 1, y: 3 }, stops: [{ at: 0, density: 1 }, { at: 1, density: 0 }] });
    expect(rad(1, 2)).toBeCloseTo(0.5);
  });

  it('a screened gradient covers the average of its tones', () => {
    const w = 1200, h = 300, alpha = new Uint8ClampedArray(w * h);
    const field = gradientField({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, stops: [{ at: 0, density: 0.1 }, { at: 1, density: 0.9 }] });
    screenAlpha(alpha, { width: w, height: h, x0: 0, y0: 0, scale: 600 }, { shape: 'dot', frequency: 60, angle: 45 }, field, false);
    let sum = 0;
    for (const v of alpha) sum += v;
    expect(Math.abs(sum / 255 / alpha.length - 0.5)).toBeLessThan(0.02);
  });

  it('reads a painted grey as its tone, averaged over the cell', () => {
    const w = 200, h = 200, rgba = new Uint8ClampedArray(w * h * 4);
    // opaque mid grey (luma 0.3 → 70% tone) on the left half, nothing on the right
    for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) { const k = (y * w + x) * 4; rgba[k] = rgba[k + 1] = rgba[k + 2] = Math.round(0.3 * 255); rgba[k + 3] = 255; }
    const field = darknessField(rgba, w, h, { x0: 0, y0: 0, scale: 100 }, 0.1);
    expect(field(0.4, 1)).toBeCloseTo(0.7, 2);
    expect(field(1.6, 1)).toBe(0);
    expect(field(1.0, 1)).toBeCloseTo(0.35, 1); // a cell straddling the edge carries the average
  });
});
