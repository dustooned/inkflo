// Vendored from 2Dope src/fill/gradient.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { gradientAt } from './gradient';

describe('gradient fills', () => {
  it('runs 0 to 1 along a linear gradient and stays clamped past its ends', () => {
    const g = { kind: 'linear' as const, x0: 0, y0: 0, x1: 0, y1: 100 };
    expect(gradientAt(g, 50, 0)).toBe(0);
    expect(gradientAt(g, 50, 50)).toBe(0.5);
    expect(gradientAt(g, 10, 200)).toBe(1);
    expect(gradientAt(g, 10, -20)).toBe(0);
  });

  it('runs outwards from the centre on a radial gradient', () => {
    const g = { kind: 'radial' as const, x0: 50, y0: 50, x1: 50, y1: 90 };
    expect(gradientAt(g, 50, 50)).toBe(0);
    expect(gradientAt(g, 70, 50)).toBe(0.5);
    expect(gradientAt(g, 0, 0)).toBe(1);
  });
});
