import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex, shadeOf } from './tonecolour';

describe('tone colour', () => {
  it('round-trips hex and rejects anything else', () => {
    expect(hexToRgb('#c8503a')).toEqual([200, 80, 58]);
    expect(rgbToHex(200, 80, 58)).toBe('#c8503a');
    expect(hexToRgb('red')).toBeNull();
    expect(shadeOf('red')).toBe('red');
  });
  it('shades darker and keeps the hue', () => {
    const base = hexToRgb('#d9533f')!;
    const shade = hexToRgb(shadeOf('#d9533f'))!;
    expect(shade[0] + shade[1] + shade[2]).toBeLessThan(base[0] + base[1] + base[2]);
    expect(shade[0]).toBeGreaterThan(shade[1]);
    expect(shade[0]).toBeGreaterThan(shade[2]);
  });
  it('keeps greys grey and a deeper depth is darker', () => {
    const [r, g, b] = hexToRgb(shadeOf('#808080'))!;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(hexToRgb(shadeOf('#d9533f', 0.7))![0]).toBeLessThan(hexToRgb(shadeOf('#d9533f', 0.2))![0]);
  });
});
