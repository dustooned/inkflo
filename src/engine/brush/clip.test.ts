// Vendored from 2Dope src/brush/clip.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { anySelected } from './clip';

/** A w×h mask with columns x0..x1-1 selected. */
function columns(w: number, h: number, x0: number, x1: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
}

describe('anySelected', () => {
  it('finds an all-selected rect', () => {
    expect(anySelected(new Uint8Array(16).fill(1), 4, { x: 0, y: 0, w: 4, h: 4 })).toBe(true);
  });

  it('finds nothing in an unselected mask', () => {
    expect(anySelected(new Uint8Array(16), 4, { x: 0, y: 0, w: 4, h: 4 })).toBe(false);
  });

  it('finds a partly selected rect', () => {
    expect(anySelected(columns(10, 10, 6, 8), 10, { x: 4, y: 2, w: 3, h: 3 })).toBe(true);
  });

  it('ignores a rect that only touches an unselected column', () => {
    const m = columns(10, 10, 6, 8);
    expect(anySelected(m, 10, { x: 5, y: 0, w: 1, h: 10 })).toBe(false);
    expect(anySelected(m, 10, { x: 8, y: 0, w: 2, h: 10 })).toBe(false);
  });

  it('clamps a rect past the right and bottom edges', () => {
    const m = new Uint8Array(100);
    m[99] = 1;
    expect(anySelected(m, 10, { x: 8, y: 8, w: 20, h: 20 })).toBe(true);
    expect(anySelected(m, 10, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(anySelected(m, 10, { x: 0, y: 10, w: 5, h: 5 })).toBe(false);
  });

  it('is false for empty or degenerate rects', () => {
    const m = new Uint8Array(16).fill(1);
    expect(anySelected(m, 4, { x: 1, y: 1, w: 0, h: 2 })).toBe(false);
    expect(anySelected(m, 4, { x: 1, y: 1, w: 2, h: -1 })).toBe(false);
    expect(anySelected(m, 4, { x: -5, y: -5, w: 3, h: 3 })).toBe(false);
    expect(anySelected(m, 0, { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });
});
