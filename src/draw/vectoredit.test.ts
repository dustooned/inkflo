import { describe, expect, it } from 'vitest';
import { brushWidth, eraseStrokes, hitStroke, pointAt, reshape, scaleWidth, simplify, smooth } from './vectoredit';
import { toRecord } from './replay';
import type { Stroke } from '../doc/model';
import { newBook, newLayer, newPage } from '../doc/model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from '../doc/schema';

const line = (y: number, x0 = 1, x1 = 3, n = 21, seed = 1): Stroke => ({
  pts: Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y })),
  pressure: Array.from({ length: n }, () => 0.8),
  w: 0.03,
  brushId: 'maru-pen',
  seed,
});
let seed = 100;
const next = () => seed++;

describe('vector line editing', () => {
  it('hits the topmost line within reach, counting its width', () => {
    const a = line(1);
    const b = line(1.02, 1, 3, 21, 2);
    expect(hitStroke([a, b], { x: 2, y: 1.01 }, 0.01)!.index).toBe(1);
    expect(hitStroke([a], { x: 2, y: 1.2 }, 0.01)).toBeNull();
    expect(hitStroke([a], { x: 2, y: 1.02 }, 0.01)!.at).toBeCloseTo(10, 5);
  });

  it('pointAt inserts a point mid-segment and keeps pressure aligned', () => {
    const { stroke, index } = pointAt(line(1), 4.5);
    expect(stroke.pts).toHaveLength(22);
    expect(stroke.pressure).toHaveLength(22);
    expect(index).toBe(5);
    expect(stroke.pts[5]!.x).toBeCloseTo(1.45, 9);
    expect(pointAt(line(1), 4.05).index).toBe(4); // close to a point: reuse it
  });

  it('pull moves the grabbed point fully and neighbours with a falloff; ends far away stay', () => {
    const s = reshape(line(1), 10, { x: 0, y: 0.2 }, 0.5);
    expect(s.pts[10]!.y).toBeCloseTo(1.2, 9);
    expect(s.pts[12]!.y - 1).toBeGreaterThan(0);
    expect(s.pts[12]!.y - 1).toBeLessThan(0.2);
    expect(s.pts[0]!.y).toBe(1);
    expect(s.pts[20]!.y).toBe(1);
  });

  it('width brush thickens only near the path, and scaling the line changes w', () => {
    const s = brushWidth(line(1), [{ x: 1.5, y: 1 }], 0.2, 2)!;
    expect(s.pw![5]).toBeCloseTo(2, 5);
    expect(s.pw![20]).toBe(1);
    expect(brushWidth(line(1), [{ x: 1.5, y: 3 }], 0.2, 2)).toBeNull();
    expect(scaleWidth(line(1), 2).w).toBeCloseTo(0.06);
  });

  it('simplify drops points a straight line does not need; smooth keeps the ends', () => {
    const s = simplify(line(1), 0.005);
    expect(s.pts).toHaveLength(2);
    expect(s.pressure).toHaveLength(2);
    const wobbly: Stroke = { ...line(1), pts: line(1).pts.map((p, i) => ({ x: p.x, y: p.y + (i % 2 ? 0.02 : -0.02) })) };
    const sm = smooth(wobbly, 4);
    expect(sm.pts[0]).toEqual(wobbly.pts[0]);
    expect(Math.abs(sm.pts[10]!.y - 1)).toBeLessThan(0.01);
  });
});

describe('vector eraser', () => {
  const h = line(2, 1, 3, 41, 1); // horizontal through y=2
  const v: Stroke = { ...line(0, 0, 0, 2, 2), pts: [{ x: 2.5, y: 1 }, { x: 2.5, y: 3 }], pressure: [0.8, 0.8] }; // vertical at x=2.5

  it('whole removes a touched line', () => {
    const out = eraseStrokes([h, v], [{ x: 1.5, y: 2 }], 0.02, 'whole', 'ink', 300, next)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(v);
  });

  it('touched part cuts a gap with square ends at the cut', () => {
    const tapered = { ...h, brushId: 'g-pen' }; // a tapered pen: its cut ends go square
    const out = eraseStrokes([tapered], [{ x: 1.5, y: 1.9 }, { x: 1.5, y: 2.1 }], 0.02, 'intersection', 'ink', 300, next)!;
    expect(out).toHaveLength(2);
    const [left, right] = out;
    expect(left!.pts.at(-1)!.x).toBeLessThan(1.5);
    expect(right!.pts[0]!.x).toBeGreaterThan(1.5);
    expect(left!.flat).toEqual([false, true]);
    expect(right!.flat).toEqual([true, false]);
    expect(left!.seed).not.toBe(right!.seed);
    // the cut ends lose their taper when replayed
    expect(toRecord(left!, 'ink', 300).brush.taperEnd).toBe(0);
  });

  it('to crossings removes an overshoot past a crossing line', () => {
    // the horizontal overshoots the vertical at x=2.5: erase its right tail
    const out = eraseStrokes([h, v], [{ x: 2.8, y: 2 }], 0.02, 'crossing', 'ink', 300, next)!;
    const kept = out.find((s) => s.pts[0]!.y === 2)!;
    expect(kept.pts.at(-1)!.x).toBeCloseTo(2.5, 2);
    expect(out).toContain(v);
  });
});

describe('vector data', () => {
  it('vector layers, point widths and flat ends round-trip through book.json', () => {
    const book = newBook('V');
    const page = newPage();
    const l = newLayer('ink');
    l.vector = true;
    l.strokes.push({ ...line(1), pw: line(1).pts.map(() => 1.5), flat: [true, false] });
    page.groups.at(-1)!.layers.push(l);
    book.pages = [page];
    book.lastPageId = page.id;
    const back = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 't', book, art: {} }));
    const got = back.book.pages[0]!.groups.at(-1)!.layers.at(-1)!;
    expect(got.vector).toBe(true);
    expect(got.strokes[0]).toEqual(l.strokes[0]);
  });

  it('point widths reach the renderer as point w', () => {
    const r = toRecord({ ...line(1), pw: line(1).pts.map((_, i) => (i === 3 ? 2 : 1)) }, 'ink', 300);
    expect(r.points[3]!.w).toBe(2);
  });
});
