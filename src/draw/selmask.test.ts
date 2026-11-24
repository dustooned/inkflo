import { describe, expect, it } from 'vitest';
import type { SelectionStep } from '../doc/model';
import { buildMask, colourCoverage, combine, featherMask, invertMask, maskBounds, polygonCoverage } from './selmask';

const square = (x: number, y: number, s: number) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] as const;
const count = (m: { data: Uint8Array }) => m.data.reduce((n, v) => n + (v ? 1 : 0), 0);
const rect = (x: number, y: number, s: number) => ({ kind: 'polygon' as const, pts: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });

describe('selection masks', () => {
  it('covers the pixels inside a polygon', () => {
    const m = polygonCoverage(square(2, 2, 4), 10, 10);
    expect(count(m)).toBe(16);
    expect(maskBounds(m)).toEqual({ x0: 2, y0: 2, x1: 5, y1: 5 });
  });

  it('adds and subtracts areas', () => {
    const a = polygonCoverage(square(0, 0, 4), 10, 10), b = polygonCoverage(square(2, 2, 4), 10, 10);
    expect(count(combine(structuredClone(a), b, 'add'))).toBe(16 + 16 - 4);
    expect(count(combine(structuredClone(a), b, 'subtract'))).toBe(16 - 4);
    expect(count(combine(null, b, 'subtract'))).toBe(0);
  });

  it('inverts', () => {
    const m = invertMask(polygonCoverage(square(0, 0, 4), 10, 10));
    expect(count(m)).toBe(100 - 16);
  });

  it('feathering softens the edge and keeps the middle', () => {
    const m = featherMask(polygonCoverage(square(10, 10, 12), 32, 32), 6);
    const at = (x: number, y: number) => m.data[y * 32 + x]!;
    expect(at(16, 16)).toBeGreaterThan(190);
    expect(at(10, 16)).toBeGreaterThan(20);
    expect(at(10, 16)).toBeLessThan(235);
    expect(at(2, 2)).toBe(0);
    const total = (mm: typeof m) => mm.data.reduce((n, v) => n + v, 0);
    expect(Math.abs(total(m) - 144 * 255)).toBeLessThan(144 * 255 * 0.05); // coverage is conserved
  });

  describe('colour picks', () => {
    // a 8 × 4 plane: left half red, right half blue, with a red island on the blue side
    const plane = () => {
      const px = new Uint8ClampedArray(8 * 4 * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) px.set(x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 8 + x) * 4);
      px.set([255, 0, 0, 255], (1 * 8 + 6) * 4);
      return px;
    };
    it('contiguous spreads only through touching pixels', () => {
      expect(count(colourCoverage(plane(), 8, 4, 0, 0, 0.1, true))).toBe(16);
    });
    it('non-contiguous takes every like pixel', () => {
      expect(count(colourCoverage(plane(), 8, 4, 0, 0, 0.1, false))).toBe(17);
    });
    it('a looser tolerance reaches near colours', () => {
      const px = plane();
      px.set([230, 10, 10, 255], (0 * 8 + 1) * 4);
      expect(colourCoverage(px, 8, 4, 0, 0, 0.02, true).data[1]).toBe(0);
      expect(colourCoverage(px, 8, 4, 0, 0, 0.15, true).data[1]).toBe(255);
    });
    it('a pick outside the plane selects nothing', () => {
      expect(count(colourCoverage(plane(), 8, 4, 50, 0, 0.1, true))).toBe(0);
    });
  });

  describe('recipes', () => {
    const blankPlane = () => new Uint8ClampedArray(20 * 20 * 4);
    it('replays steps in order, in inches', () => {
      const steps: SelectionStep[] = [
        { op: 'replace', shape: rect(0, 0, 0.1) },
        { op: 'add', shape: rect(0.1, 0.1, 0.05) },
        { op: 'subtract', shape: rect(0.02, 0.02, 0.02) },
      ];
      const m = buildMask(steps, 20, 20, 100, blankPlane)!;
      expect(count(m)).toBe(100 + 25 - 4);
    });
    it('invert then feather, and replaying twice gives the same mask', () => {
      const steps: SelectionStep[] = [{ op: 'replace', shape: rect(0.05, 0.05, 0.1) }, { op: 'invert' }, { op: 'feather', radius: 0.04 }];
      const a = buildMask(steps, 20, 20, 100, blankPlane)!, b = buildMask(steps, 20, 20, 100, blankPlane)!;
      expect([...a.data]).toEqual([...b.data]);
    });
    it('is null when nothing is selected, and reads pixels only for colour steps', () => {
      let reads = 0;
      const pixels = () => { reads++; return blankPlane(); };
      expect(buildMask([{ op: 'replace', shape: rect(5, 5, 1) }], 20, 20, 100, pixels)).toBeNull(); // off the plane
      expect(reads).toBe(0);
      expect(buildMask([{ op: 'replace', shape: { kind: 'colour', at: { x: 0.05, y: 0.05 }, tolerance: 0.1, contiguous: true } }], 20, 20, 100, pixels)).not.toBeNull();
      expect(reads).toBe(1);
    });
  });
});
