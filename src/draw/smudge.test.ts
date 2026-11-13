import { describe, expect, it } from 'vitest';
import { mixSmudgePixel } from './smudge';

describe('smudge mixing', () => {
  it('blends two opaque paint colours', () => {
    const out = new Uint8ClampedArray([0, 0, 200, 255]);
    mixSmudgePixel(out, 0, new Uint8ClampedArray([200, 0, 0, 255]), 0, 0.5);
    expect([...out]).toEqual([100, 0, 100, 255]);
  });

  it('moves pigment into transparency without darkening the colour', () => {
    const out = new Uint8ClampedArray(4);
    mixSmudgePixel(out, 0, new Uint8ClampedArray([200, 20, 30, 255]), 0, 0.5);
    expect([...out]).toEqual([200, 20, 30, 128]);
  });
});
