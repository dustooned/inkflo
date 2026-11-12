import { describe, expect, it } from 'vitest';
import { boxHandles, resizeBox, rotateAround } from './resizebox';

const box = { x0: 10, y0: 20, x1: 50, y1: 40 };
const minimum = { x: 8, y: 6 };

describe('box handles', () => {
  it('widens from the side midpoint without changing the center or height', () => {
    const right = boxHandles(box).find((h) => h.x === 1 && h.y === 0)!;
    expect(right.at).toEqual({ x: 50, y: 30 });
    expect(resizeBox(box, right, { x: 5, y: 13 }, minimum, true, false))
      .toEqual({ width: 50, height: 20, shift: { x: 0, y: 0 } });
  });

  it('keeps the opposite corner fixed during proportional resize and respects minimum size', () => {
    expect(resizeBox(box, { x: 1, y: 1 }, { x: 10, y: 0 }, minimum, false, true))
      .toEqual({ width: 50, height: 25, shift: { x: 5, y: 2.5 } });
    expect(resizeBox(box, { x: 1, y: 1 }, { x: -90, y: -90 }, minimum, false, true))
      .toEqual({ width: 12, height: 6, shift: { x: -14, y: -7 } });
  });

  it('rotates around the specified pivot and inverts the turn', () => {
    const center = { x: 6, y: 8 };
    const turned = rotateAround({ x: 9, y: 8 }, center, 90);
    expect(turned).toEqual({ x: 6, y: 11 });
    expect(rotateAround(turned, center, -90)).toEqual({ x: 9, y: 8 });
  });
});
