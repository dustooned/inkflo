// Vendored from 2Dope src/fill/fill.perf.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { computeFill, DEFAULT_FILL } from './fill';

describe('fill performance', () => {
  it('fills a large closed shape on a 1920x1080 page quickly', () => {
    const W = 1920;
    const H = 1080;
    const a = new Uint8Array(W * H);
    const cx = 960;
    const cy = 540;
    const R = 400;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx, y - cy);
        a[y * W + x] = Math.round(Math.min(1, Math.max(0, (3 + 0.75 - Math.abs(d - R)) / 1.5)) * 255);
      }
    }
    const t0 = performance.now();
    const r = computeFill(a, W, H, cx, cy, { ...DEFAULT_FILL, gap: 8 })!;
    const ms = performance.now() - t0;
    expect(r.count).toBeGreaterThan(Math.PI * 390 * 390);
    expect(r.mask[5 * W + 5]).toBe(0);
    console.log(`fill 1920x1080 ring (gap 8): ${ms.toFixed(0)} ms, ${r.count} px`);
    expect(ms).toBeLessThan(1500);
  });
});
