import { describe, expect, it } from 'vitest';
import type { V } from '../engine/core/quickshape';
import { choiceOf, editInkShape, fitInkShape, inkShapeOutline, recognizeInkShape, shapeChoicesFor } from './quickcurve';

/** A hand-drawn wobble on a path (deterministic). */
const wobble = (p: V[], a: number) => p.map((q, i) => ({ x: q.x + Math.sin(i * 1.7) * a, y: q.y + Math.cos(i * 2.3) * a }));
const sCurve = () => wobble(Array.from({ length: 160 }, (_, i) => ({ x: i * 4, y: 120 * Math.sin((i / 159) * Math.PI * 2) })), 1.2);
const wave = () => wobble(Array.from({ length: 200 }, (_, i) => ({ x: i * 3, y: 70 * Math.sin((i / 199) * Math.PI * 3) })), 1);
const zigzag = (): V[] => {
  const corners = [{ x: 0, y: 0 }, { x: 150, y: 150 }, { x: 300, y: 0 }, { x: 450, y: 150 }];
  const out: V[] = [];
  for (let i = 0; i < corners.length - 1; i++) for (let k = 0; k < 30; k++) out.push({ x: corners[i]!.x + (corners[i + 1]!.x - corners[i]!.x) * k / 30, y: corners[i]!.y + (corners[i + 1]!.y - corners[i]!.y) * k / 30 });
  out.push(corners.at(-1)!);
  return out;
};

/** Largest turn between neighbouring segments of an outline, in degrees: a blocky path has big ones. */
function maxTurn(p: V[]): number {
  let max = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i]!.y - p[i - 1]!.y, p[i]!.x - p[i - 1]!.x), b = Math.atan2(p[i + 1]!.y - p[i]!.y, p[i + 1]!.x - p[i]!.x);
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    max = Math.max(max, (d * 180) / Math.PI);
  }
  return max;
}
/** Furthest distance from any drawn point to the shape's outline. */
function maxGap(drawn: V[], outline: V[]): number {
  return Math.max(...drawn.map((q) => Math.min(...outline.map((o) => Math.hypot(o.x - q.x, o.y - q.y)))));
}

describe('QuickShape curves', () => {
  it('snaps an S-curve and a wave to a smooth curve, not a blocky polyline', () => {
    for (const drawn of [sCurve(), wave()]) {
      const s = recognizeInkShape(drawn)!;
      expect(s.kind).toBe('curve');
      const outline = inkShapeOutline(s, 3);
      expect(maxTurn(outline)).toBeLessThan(12);
      expect(maxGap(drawn, outline)).toBeLessThan(10);
    }
  });

  it('reads a barely-wavy stroke as a line, and the Curve toggle brings the wave back', () => {
    const gentle = wobble(Array.from({ length: 200 }, (_, i) => ({ x: i * 3, y: 30 * Math.sin((i / 199) * Math.PI * 3) })), 1);
    expect(recognizeInkShape(gentle)!.kind).toBe('line');
    const curve = fitInkShape('curve', gentle)!;
    expect(curve.kind).toBe('curve');
    expect(maxGap(gentle, inkShapeOutline(curve, 3))).toBeLessThan(8);
  });

  it('keeps a polyline when the stroke has real corners', () => {
    const s = recognizeInkShape(zigzag())!;
    expect(s.kind).toBe('polyline');
  });

  it('still finds lines, arcs and ellipses as before', () => {
    expect(recognizeInkShape(Array.from({ length: 60 }, (_, i) => ({ x: i * 5, y: i * 2 })))!.kind).toBe('line');
    expect(recognizeInkShape(Array.from({ length: 90 }, (_, i) => { const a = Math.PI * i / 89; return { x: 200 * Math.cos(a), y: 200 * Math.sin(a) }; }))!.kind).toBe('arc');
    expect(recognizeInkShape(Array.from({ length: 121 }, (_, i) => { const a = 2 * Math.PI * i / 120; return { x: 150 * Math.cos(a), y: 80 * Math.sin(a) }; }))!.kind).toBe('ellipse');
  });

  it('offers toggles for open and closed strokes, and refits as the chosen shape', () => {
    const drawn = sCurve();
    const curve = recognizeInkShape(drawn)!;
    expect(shapeChoicesFor(curve).map((c) => c.id)).toEqual(['line', 'arc', 'curve', 'polyline']);
    expect(choiceOf(curve)).toBe('curve');
    expect(fitInkShape('line', drawn)!.kind).toBe('line');
    expect(fitInkShape('polyline', drawn)!.kind).toBe('polyline');
    expect(fitInkShape('curve', drawn)!.kind).toBe('curve');
    const ring = Array.from({ length: 121 }, (_, i) => { const a = 2 * Math.PI * i / 120; return { x: 150 * Math.cos(a), y: 80 * Math.sin(a) }; });
    const circle = fitInkShape('circle', ring)!;
    expect(choiceOf(circle)).toBe('circle');
    expect(shapeChoicesFor(circle).map((c) => c.id)).toContain('square');
  });

  it('bends a curve toward the pen while holding, keeping its start', () => {
    const s = recognizeInkShape(sCurve())!;
    if (s.kind !== 'curve') throw new Error('expected a curve');
    const moved = editInkShape(s, s.pts.at(-1)!, { x: s.pts.at(-1)!.x + 50, y: s.pts.at(-1)!.y }) as typeof s;
    expect(moved.pts[0]).toEqual(s.pts[0]);
    expect(moved.pts.at(-1)!.x).toBeCloseTo(s.pts.at(-1)!.x + 50);
  });
});
