import { describe, expect, it } from 'vitest';
import type { CaptionTail } from '../engine/lettering/spec';
import { bendHandle, curveSide, curveTail, followBody, moveTip, tailBase } from './tailbend';

const circle = Array.from({ length: 72 }, (_, i) => ({ x: 100 + 40 * Math.cos((i * Math.PI) / 36), y: 100 + 30 * Math.sin((i * Math.PI) / 36) }));
const tail = (x: number, y: number, extra: Partial<CaptionTail> = {}): CaptionTail => ({ x, y, join: 'merged', width: 1.2, ...extra });

describe('tail curves', () => {
  it('leaves the balloon on the side facing the tip', () => {
    const b = tailBase(circle, { x: 100, y: 100 }, { x: 100, y: 200 });
    expect(b.y).toBeCloseTo(130, 0);
    expect(b.x).toBeCloseTo(100, 0);
  });

  it('puts the curve handle halfway along a straight tail, or on its bend', () => {
    expect(bendHandle({ x: 0, y: 0 }, tail(10, 20))).toEqual({ x: 5, y: 10 });
    expect(bendHandle({ x: 0, y: 0 }, tail(10, 20, { bend: [3, 4] }))).toEqual({ x: 3, y: 4 });
  });

  it('curves left or right of the direction to the tip, and straightens', () => {
    const base = { x: 0, y: 0 };
    const down = tail(0, 100); // pointing down the page
    const right = curveTail(base, down, 1);
    const left = curveTail(base, down, -1);
    // facing down the page, right is toward −x
    expect(right.bend![0]).toBeLessThan(0);
    expect(left.bend![0]).toBeGreaterThan(0);
    expect(curveSide(base, right)).toBe(1);
    expect(curveSide(base, left)).toBe(-1);
    expect(curveSide(base, down)).toBe(0);
    expect(curveTail(base, right, 0)).not.toHaveProperty('bend');
  });

  it('keeps the curve when the tip or the balloon moves', () => {
    const t = tail(0, 100, { bend: [20, 50] });
    expect(moveTip(t, 10, 0)).toMatchObject({ x: 10, y: 100, bend: [25, 50] });
    expect(followBody(t, 0, -20).bend).toEqual([20, 40]);
    expect(followBody(tail(0, 1), 5, 5)).not.toHaveProperty('bend');
  });
});
