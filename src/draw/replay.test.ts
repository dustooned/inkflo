import { describe, expect, it } from 'vitest';
import { toRecord, SAMPLE_MS } from './replay';
import { brushFor, knownBrush, PASS_STYLE } from './brushes';
import { dabsForStroke } from '../engine/brush/dabs';
import { strokeLength } from '../engine/core/stroke';
import type { Stroke } from '../doc/model';

const stroke: Stroke = {
  pts: [{ x: 1, y: 1 }, { x: 1.5, y: 1.2 }, { x: 2, y: 1.1 }, { x: 2.4, y: 1.6 }],
  pressure: [0.2, 0.7, 1, 0.4],
  w: 0.03,
  brushId: 'g-pen',
  seed: 42,
};

const dabs = (s: Stroke, dpi: number, pass: 'pencil' | 'ink' = 'ink') => {
  const r = toRecord(s, pass, dpi);
  return dabsForStroke(r.brush, r.seed, r.points, strokeLength(r.points));
};

describe('stroke replay', () => {
  it('scales page units to pixels and keeps pressure', () => {
    const r = toRecord(stroke, 'ink', 300);
    expect(r.points[1]).toEqual({ x: 450, y: 360, pressure: 0.7, tiltX: 0, tiltY: 0, t: SAMPLE_MS });
    expect(r.brush.size).toBeCloseTo(9);
    expect(r.color).toBe(PASS_STYLE.ink.color);
  });

  it('a stroke without pressure draws at full pressure', () => {
    const { pressure: _drop, ...plain } = stroke;
    expect(toRecord(plain, 'ink', 300).points.every((p) => p.pressure === 1)).toBe(true);
  });

  it('is deterministic: the same stroke always makes the same dabs', () => {
    expect(dabs(stroke, 300)).toEqual(dabs(stroke, 300));
    expect(dabs(stroke, 300).length).toBeGreaterThan(10);
  });

  it('renders at any dpi: 600 dpi is the 300 dpi stroke at twice the scale', () => {
    // More dabs at higher resolution is expected (spacing has a pixel floor); the shape must match.
    const profile = (ds: ReturnType<typeof dabs>, scale: number) => {
      // dab size (in 300 dpi pixels) at each 10% of the distance along the stroke
      const dist = [0];
      for (let i = 1; i < ds.length; i++) dist.push(dist[i - 1]! + Math.hypot(ds[i]!.x - ds[i - 1]!.x, ds[i]!.y - ds[i - 1]!.y));
      const total = dist[dist.length - 1]!;
      const out: number[] = [];
      for (let f = 0.05; f < 1; f += 0.1) out.push(ds[dist.findIndex((d) => d >= f * total)]!.size / scale);
      return out;
    };
    const a = profile(dabs(stroke, 300), 1);
    const b = profile(dabs(stroke, 600), 2);
    a.forEach((size, i) => expect(b[i]).toBeCloseTo(size, 0));
    expect(dabs(stroke, 600)[0]!.x).toBeCloseTo(dabs(stroke, 300)[0]!.x * 2, 5);
    expect(toRecord(stroke, 'ink', 600).brush.taperEnd).toBe(toRecord(stroke, 'ink', 300).brush.taperEnd * 2);
  });

  it('pencil draws in blue at 55% and never touches the shared preset', () => {
    const r = toRecord({ ...stroke, brushId: 'pencil-hb' }, 'pencil', 300);
    expect(r.color).toBe('#4E7EA8');
    expect(r.brush.opacity).toBeCloseTo(0.55);
    expect(brushFor('pencil-hb', 'pencil').opacity).toBe(1);
  });

  it('an unknown brush falls back to the pass default instead of failing', () => {
    expect(knownBrush('mystery')).toBe(false);
    expect(toRecord({ ...stroke, brushId: 'mystery' }, 'ink', 300).brush.name).toBe('G-pen');
  });
});
