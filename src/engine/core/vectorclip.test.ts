// Vendored from 2Dope src/core/vectorclip.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { PRESETS } from './brush';
import { symmetryCopies } from './adjust';
import type { StrokePoint, StrokeRecord } from './stroke';
import { clipStrokeToMask, eraseVectorsInMask } from './vectorclip';

const W = 100, H = 100;
const pt = (x: number, y: number, pressure = 0.5): StrokePoint => ({ x, y, pressure, tiltX: 0, tiltY: 0, t: x });
const line = (id: string, from: [number, number], to: [number, number], n = 20): StrokeRecord => ({
  id,
  tool: 'pen',
  brush: { ...PRESETS[1]!, size: 2, taperStart: 10, taperEnd: 10 },
  color: '#000000',
  seed: 1,
  points: Array.from({ length: n + 1 }, (_, i) => pt(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n, i / n)),
});
/** Columns x0..x1-1 selected, every row. */
function cols(x0: number, x1: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1;
  return m;
}
const inside = (m: Uint8Array, p: StrokePoint) => m[Math.floor(p.y) * W + Math.floor(p.x)] === 1;

describe('clipStrokeToMask', () => {
  const mask = cols(30, 70);

  it('keeps a stroke wholly inside as the same record', () => {
    const r = line('a', [35, 50], [65, 50]);
    expect(clipStrokeToMask(r, mask, W, H)).toEqual([r]);
    expect(clipStrokeToMask(r, mask, W, H)[0]).toBe(r);
  });

  it('drops a stroke wholly outside', () => {
    expect(clipStrokeToMask(line('a', [2, 50], [25, 50]), mask, W, H)).toEqual([]);
  });

  it('cuts one crossing on the mask edge, keeping pressure and time', () => {
    const [p, ...rest] = clipStrokeToMask(line('a', [10, 50], [50, 50]), mask, W, H);
    expect(rest).toEqual([]);
    expect(p!.id).toBe('a~c0');
    expect(p!.points[0]!.x).toBeGreaterThanOrEqual(30);
    expect(p!.points[0]!.x).toBeLessThan(30.2);
    expect(p!.points.every((q) => inside(mask, q))).toBe(true);
    expect(p!.points[p!.points.length - 1]).toEqual(pt(50, 50, 1));
    // pressure and time follow the original line where it was cut
    expect(p!.points[0]!.pressure).toBeCloseTo((p!.points[0]!.x - 10) / 40, 2);
    expect(p!.points[0]!.t).toBeCloseTo(p!.points[0]!.x, 5);
  });

  it('cuts two crossings into the one inside piece, both ends on the edges', () => {
    const out = clipStrokeToMask(line('a', [0, 50], [99, 50], 33), mask, W, H);
    expect(out).toHaveLength(1);
    const ps = out[0]!.points;
    expect(ps[0]!.x).toBeGreaterThanOrEqual(30);
    expect(ps[0]!.x).toBeLessThan(30.5);
    expect(ps[ps.length - 1]!.x).toBeLessThan(70);
    expect(ps[ps.length - 1]!.x).toBeGreaterThan(69.5);
  });

  it('splits a line that leaves and comes back into two pieces with distinct ids', () => {
    const out = clipStrokeToMask(line('a', [40, 50], [99, 50], 30), cols(30, 50).map((v, i) => v | (i % W >= 80 ? 1 : 0)), W, H);
    expect(out.map((r) => r.id)).toEqual(['a~c0', 'a~c1']);
  });

  it('finds a gap between two points (an unselected strip narrower than a segment)', () => {
    const two = cols(30, 45).map((v, i) => v | (i % W >= 55 && i % W < 70 ? 1 : 0));
    const sparse: StrokeRecord = { ...line('s', [0, 0], [0, 0]), points: [pt(35, 50), pt(65, 50)] };
    const out = clipStrokeToMask(sparse, two, W, H);
    expect(out).toHaveLength(2);
    expect(out[0]!.points[out[0]!.points.length - 1]!.x).toBeLessThan(45);
    expect(out[1]!.points[0]!.x).toBeGreaterThanOrEqual(55);
  });

  it('keeps both ends of a closed loop that starts inside and goes out, with no point outside', () => {
    const loop: StrokeRecord = { ...line('loop', [0, 0], [0, 0]), points: [pt(50, 40), pt(90, 40), pt(90, 60), pt(50, 60), pt(50, 40)] };
    const out = clipStrokeToMask(loop, mask, W, H);
    expect(out).toHaveLength(2);
    expect(out.flatMap((r) => r.points).every((q) => inside(mask, q))).toBe(true);
    expect(out[0]!.points[0]).toEqual(pt(50, 40));
    expect(out[1]!.points[out[1]!.points.length - 1]).toEqual(pt(50, 40));
  });

  it('removes the taper only at cut ends', () => {
    const [p] = clipStrokeToMask(line('a', [40, 50], [90, 50]), mask, W, H);
    expect(p!.brush.taperStart).toBe(10);
    expect(p!.brush.taperEnd).toBe(0);
    const [q] = clipStrokeToMask(line('b', [10, 50], [60, 50]), mask, W, H);
    expect(q!.brush.taperStart).toBe(0);
    expect(q!.brush.taperEnd).toBe(10);
  });

  it('clips a symmetry copy on its own side', () => {
    // a line on the right, its mirror on the left; only the right half is selected
    const right = line('r', [60, 50], [90, 50]);
    const mirror: StrokeRecord = { ...right, id: 'm', points: right.points.map((p) => { const c = symmetryCopies('vertical', 50, 50, p.x, p.y, 0)[1]!; return { ...p, x: c.x, y: c.y }; }) };
    const sel = cols(50, 100);
    expect(clipStrokeToMask(right, sel, W, H)).toEqual([right]);
    expect(clipStrokeToMask(mirror, sel, W, H)).toEqual([]);
  });

  it('keeps the outside instead when asked', () => {
    const out = clipStrokeToMask(line('a', [10, 50], [50, 50]), mask, W, H, 'outside');
    expect(out).toHaveLength(1);
    expect(out[0]!.points.every((q) => !inside(mask, q))).toBe(true);
  });
});

describe('eraseVectorsInMask', () => {
  const mask = cols(30, 70);
  const h = line('h', [5, 50], [95, 50], 45);
  const path = (...xs: number[]) => xs.map((x) => pt(x, 50));

  for (const mode of ['whole', 'crossing'] as const) {
    it(`(${mode}) erases only inside the selection and keeps the outside parts as they were`, () => {
      const out = eraseVectorsInMask([h], path(20, 50, 80), 2, mode, mask, W, H)!;
      expect(out.length).toBe(2);
      expect(out.every((r) => r.points.every((q) => !inside(mask, q)))).toBe(true);
      expect(out[0]!.points[0]).toEqual(h.points[0]);
      expect(out[1]!.points[out[1]!.points.length - 1]).toEqual(h.points[h.points.length - 1]);
    });

    it(`(${mode}) changes nothing when the eraser touches the line only outside the selection`, () => {
      expect(eraseVectorsInMask([h], path(10, 20), 2, mode, mask, W, H)).toBeNull();
    });
  }

  it('erases a short stretch inside and keeps the rest of the inside part (crossing mode)', () => {
    const v = line('v', [50, 20], [50, 80]); // crosses h at (50, 50): crossing mode cuts there
    const out = eraseVectorsInMask([h, v], [pt(40, 50)], 2, 'crossing', mask, W, H)!;
    expect(out).toContain(v);
    const pieces = out.filter((r) => r !== v);
    // outside left and right stay; inside, only the stretch from the edge to the crossing went
    expect(pieces.some((r) => r.points.some((q) => q.x > 55 && q.x < 69))).toBe(true);
    expect(pieces.every((r) => r.points.every((q) => !(q.x > 31 && q.x < 49)))).toBe(true);
  });

  it('leaves untouched lines alone', () => {
    const other = line('o', [40, 80], [60, 80]);
    const out = eraseVectorsInMask([h, other], [pt(50, 50)], 2, 'whole', mask, W, H)!;
    expect(out).toContain(other);
  });
});
