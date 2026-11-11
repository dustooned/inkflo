// Vendored from 2Dope src/brush/dabs.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { cloneBrush, dyn, NO_TILT_SHADE, PRESETS } from '../core/brush';
import { strokeLength, type StrokePoint } from '../core/stroke';
import { dabBounds, dabsForStroke, DabWalker, taperAt } from './dabs';

const brush = { ...cloneBrush(PRESETS[0]!), size: 100, sizeDyn: dyn('off'), opacityDyn: dyn('off'), flowDyn: dyn('off'), tiltShade: NO_TILT_SHADE, scatter: 0, taperStart: 20, taperEnd: 30 };
const line = (length: number): StrokePoint[] => [{ x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 0, t: 0 }, { x: length, y: 0, pressure: 1, tiltX: 0, tiltY: 0, t: 100 }];

describe('raster taper and paint stamps', () => {
  it('gives large brushes fine tips at the exact end between stamp positions', () => {
    const b = { ...brush, size: 500, spacing: 0.3 };
    const dabs = dabsForStroke(b, 7, line(713), 713);
    expect(dabs[0]!.size).toBe(0.5);
    expect(dabs.at(-1)!.x).toBe(713);
    expect(dabs.at(-1)!.size).toBe(0.5);
    expect(Math.max(...dabs.map(d => d.size))).toBeGreaterThan(400);
  });

  it('does not inflate short flicks into a wide brush-sized blob', () => {
    const dabs = dabsForStroke(brush, 1, line(20), 20);
    expect(Math.max(...dabs.map(d => d.size))).toBeLessThanOrEqual(20);
    expect(Math.max(...dabs.map(d => d.size))).toBeGreaterThan(10);
    expect(taperAt(brush, 0.1, 400) * brush.size).toBeLessThanOrEqual(0.2);
  });

  it('keeps taps visible with either start or end taper enabled', () => {
    for (const b of [brush, { ...brush, taperStart: 0 }, { ...brush, taperEnd: 0 }]) {
      expect(dabsForStroke(b, 1, line(0), 0)[0]!.size).toBe(100);
    }
  });

  it('retains a fine taper when tilting expands the tip for side shading', () => {
    const b = { ...brush, tiltShade: { ...NO_TILT_SHADE, enabled: true, size: 3 } };
    const points = line(600).map(p => ({ ...p, tiltX: 80 }));
    const dabs = dabsForStroke(b, 1, points, 600);
    expect(dabs[1]!.size).toBeLessThanOrEqual(dabs[1]!.x * 2);
    expect(dabs.at(-1)!.size).toBe(0.5);
  });

  it('does not add a taper to untapered brushes', () => {
    const b = { ...brush, taperStart: 0, taperEnd: 0 };
    expect(dabsForStroke(b, 1, line(100), 100).every(d => d.size === 100)).toBe(true);
  });

  it('retains interpolated pressure for textured deposition and deterministic cloned previews', () => {
    const points = line(320); points[0]!.pressure = 0.1;
    const w = new DabWalker(brush, 5, strokeLength(points));
    w.push(points[0]!);
    const preview = w.clone().push(points[1]!);
    expect(w.push(points[1]!)).toEqual(preview);
    expect(preview[0]!.pressure).toBeGreaterThan(0.1);
    expect(preview.at(-1)!.pressure).toBeGreaterThan(0.9);
  });

  it('includes all four rotated image-tip corners in the undo bounds', () => {
    const d = dabsForStroke({ ...brush, taperStart: 0, taperEnd: 0 }, 1, line(0), 0)[0]!;
    const b = dabBounds({ ...d, angle: Math.PI / 4 });
    expect(b.x0).toBeLessThan(-70);
    expect(b.x1).toBeGreaterThan(70);
    expect(b.y0).toBeLessThan(-70);
    expect(b.y1).toBeGreaterThan(70);
  });
});
