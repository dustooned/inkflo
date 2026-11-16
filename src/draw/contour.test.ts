import { describe, expect, it } from 'vitest';
import { simplify, traceOutline, type PxPt } from './contour';

const W = 20;
const H = 20;
const grid = (rows: string[]) => {
  const m = new Uint8Array(W * H);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') m[y * W + x] = 1; }));
  return m;
};
const BOX = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
const area = (p: PxPt[]) => Math.abs(p.reduce((s, q, i) => s + (q.x * p[(i + 1) % p.length]!.y - p[(i + 1) % p.length]!.x * q.y), 0)) / 2;

describe('contour', () => {
  it('traces a rectangle to its four corners', () => {
    const m = grid(['', '  ####', '  ####', '  ####']);
    const outline = traceOutline(m, W, H, BOX);
    expect(outline).toHaveLength(4);
    expect(area(outline)).toBe(12);
  });
  it('follows an L shape and keeps its area', () => {
    const m = grid(['##', '##', '##', '######', '######']);
    expect(area(traceOutline(m, W, H, BOX))).toBe(18);
  });
  it('ignores holes and returns the outer edge only', () => {
    const m = grid(['#####', '#   #', '#   #', '#####']);
    expect(area(traceOutline(m, W, H, BOX))).toBe(20);
  });
  it('keeps pixels that only touch at a corner apart', () => {
    const m = grid(['#', ' #']);
    expect(area(traceOutline(m, W, H, BOX))).toBe(1);
  });
  it('returns nothing for an empty mask', () => {
    expect(traceOutline(new Uint8Array(W * H), W, H, BOX)).toEqual([]);
  });
  it('simplifies a staircase diagonal into far fewer points without changing its area much', () => {
    const rows = Array.from({ length: 12 }, (_, y) => '#'.repeat(y + 1));
    const raw = traceOutline(grid(rows), W, H, BOX);
    const slim = simplify(raw, 0.8);
    expect(slim.length).toBeLessThan(raw.length / 2);
    expect(Math.abs(area(slim) - area(raw))).toBeLessThan(area(raw) * 0.08);
  });
});
