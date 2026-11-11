// Vendored from 2Dope src/fill/fill.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { computeFill, DEFAULT_FILL } from './fill';

const W = 200;
const H = 200;

/** A ring of line art with soft (anti-aliased) edges, optionally with a gap of `gapDeg` degrees at angle 0. */
function ring(cx: number, cy: number, R: number, thick: number, gapPx = 0): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      let v = Math.min(1, Math.max(0, (thick / 2 + 0.75 - Math.abs(d - R)) / 1.5));
      // gap: cut a window of `gapPx` pixels centered on the +x axis
      if (gapPx > 0 && dx > 0 && Math.abs(dy) < gapPx / 2) v = 0;
      a[y * W + x] = Math.round(v * 255);
    }
  }
  return a;
}

describe('fill', () => {
  const cx = 100;
  const cy = 100;
  const R = 50;
  const thick = 6;

  it('fills the inside of a closed ring and nothing outside', () => {
    const alpha = ring(cx, cy, R, thick);
    const r = computeFill(alpha, W, H, cx, cy)!;
    expect(r).not.toBeNull();
    expect(r.mask[cy * W + cx]).toBe(1);
    expect(r.mask[cy * W + (cx + R + 20)]).toBe(0);
    expect(r.mask[5 * W + 5]).toBe(0);
    const inner = R - thick / 2;
    const expected = Math.PI * inner * inner;
    expect(r.count).toBeGreaterThan(expected * 0.98);
    expect(r.count).toBeLessThan(Math.PI * (R + thick) * (R + thick));
  });

  it('leaves no halo: every partly transparent line pixel on the inside is covered by fill', () => {
    const alpha = ring(cx, cy, R, thick);
    const r = computeFill(alpha, W, H, cx, cy)!;
    let checked = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = alpha[y * W + x]!;
        const inside = Math.hypot(x - cx, y - cy) < R;
        if (inside && a > 0 && a < 250) {
          expect(r.mask[y * W + x]).toBe(1);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('never paints a pixel the line does not cover, outside the region (no leak through a line)', () => {
    const alpha = ring(cx, cy, R, thick);
    const r = computeFill(alpha, W, H, cx, cy)!;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > R + thick) expect(r.mask[y * W + x]).toBe(0);
      }
    }
  });

  it('a thin line separates two areas: filling one side does not touch the other', () => {
    const a = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      a[y * W + 99] = 200;
      a[y * W + 100] = 200; // 2 px wide vertical line
    }
    const r = computeFill(a, W, H, 20, 100, { ...DEFAULT_FILL, gap: 0 })!;
    expect(r.mask[100 * W + 50]).toBe(1);
    expect(r.mask[100 * W + 150]).toBe(0);
    expect(r.mask[100 * W + 101]).toBe(0); // alpha 0 beyond the line: never entered
  });

  it('leaks through a gap when gap closing is off, and does not when it is on', () => {
    const alpha = ring(cx, cy, R, thick, 3);
    const off = computeFill(alpha, W, H, cx, cy, { ...DEFAULT_FILL, gap: 0 })!;
    expect(off.mask[5 * W + 5]).toBe(1); // leaked to the outside
    const on = computeFill(alpha, W, H, cx, cy, { ...DEFAULT_FILL, gap: 8 })!;
    expect(on.mask[5 * W + 5]).toBe(0);
    expect(on.mask[cy * W + cx]).toBe(1);
    // the inner end of the gap is filled, and nothing leaks out of its far end
    expect(on.mask[cy * W + (cx + R - 4)]).toBe(1);
    expect(on.mask[cy * W + (cx + R + 4)]).toBe(0);
    expect(on.mask[cy * W + (cx + R + 10)]).toBe(0);
  });

  it('a gap wider than the setting still leaks (the setting is a limit)', () => {
    const alpha = ring(cx, cy, R, thick, 20);
    const on = computeFill(alpha, W, H, cx, cy, { ...DEFAULT_FILL, gap: 6 })!;
    expect(on.mask[5 * W + 5]).toBe(1);
  });

  it('clicking right next to a line still fills (seed distance caps the closing radius)', () => {
    const alpha = ring(cx, cy, R, thick);
    const inner = Math.round(R - thick / 2 - 3);
    const r = computeFill(alpha, W, H, cx + inner, cy, { ...DEFAULT_FILL, gap: 12 })!;
    expect(r).not.toBeNull();
    expect(r.mask[cy * W + cx]).toBe(1);
  });

  it('clicking on a line picks the nearest open pixel; buried in a solid block does nothing', () => {
    const alpha = ring(cx, cy, R, thick);
    const onLine = computeFill(alpha, W, H, cx + R - 2, cy)!;
    expect(onLine).not.toBeNull();
    const block = new Uint8Array(W * H).fill(255);
    expect(computeFill(block, W, H, 100, 100)).toBeNull();
  });

  it('fills the whole page when there is no line art, and reports a tight bounding box', () => {
    const empty = new Uint8Array(W * H);
    const r = computeFill(empty, W, H, 10, 10)!;
    expect(r.count).toBe(W * H);
    const ringFill = computeFill(ring(cx, cy, R, thick), W, H, cx, cy)!;
    expect(ringFill.x0).toBeGreaterThanOrEqual(cx - R - 1);
    expect(ringFill.x1).toBeLessThanOrEqual(cx + R + 1);
  });
});
