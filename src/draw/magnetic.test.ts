import { describe, expect, it } from 'vitest';
import { buildEdges, magneticPath } from './magnetic';

describe('magnetic lasso', () => {
  const size = 60;
  it('moves a loose swipe onto a high-contrast edge and stays near the swipe in blank space', () => {
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 20; x < size; x++) rgba[(y * size + x) * 4 + 3] = 255;
    const map = buildEdges(rgba, size, size, 1);
    const snapped = magneticPath(map, [{ x: 14, y: 5 }, { x: 16, y: 50 }], 10);
    expect(snapped.every((p) => p.x >= 18.4 && p.x <= 20.6)).toBe(true);
    const blank = magneticPath(map, [{ x: 45, y: 5 }, { x: 45, y: 50 }], 10);
    expect(blank.every((p) => p.x === 45)).toBe(true);
  });
});
