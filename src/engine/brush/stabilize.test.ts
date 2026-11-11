// Vendored from 2Dope src/brush/stabilize.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import type { StrokePoint } from '../core/stroke';
import { InputFilter, Smoother } from './smoothing';

/** A straight horizontal stroke with hand shake (±3 px), one sample every 8 ms. */
const shaky = (fast = 1): StrokePoint[] => Array.from({ length: 80 }, (_, i) => ({ x: i * 4 * fast, y: 100 + (i % 2 ? 3 : -3), pressure: 0.5, tiltX: 0, tiltY: 0, t: i * 8 }));
const wobble = (pts: StrokePoint[]) => pts.slice(10).reduce((n, p) => n + Math.abs(p.y - 100), 0) / (pts.length - 10);

describe('stabilisation and motion filtering', () => {
  it('off by default: points pass straight through', () => {
    const s = new Smoother(0, false);
    const out = shaky().flatMap((p) => s.push(p));
    expect(out.map((p) => p.y)).toEqual(shaky().map((p) => p.y));
  });

  it('motion filtering removes shake; expression gives some back', () => {
    const run = (expression: number) => {
      const f = new InputFilter({ motion: 0.6, expression });
      return wobble(shaky().map((p) => f.push(p)));
    };
    expect(run(0)).toBeLessThan(0.5);
    expect(run(1)).toBeGreaterThan(run(0));
    expect(run(1)).toBeLessThan(3);
  });

  it('stabilisation steadies a fast stroke', () => {
    const f = new InputFilter({ stabilize: 0.6 });
    expect(wobble(shaky(3).map((p) => f.push(p)))).toBeLessThan(0.8);
  });

  it('the stroke still ends where the pen lifted', () => {
    const pts = shaky();
    const s = new Smoother(0, false, 1, { stabilize: 0.8, motion: 0.5 });
    const out = [...pts.flatMap((p) => s.push(p)), ...s.finish(pts[pts.length - 1]!)];
    const last = out[out.length - 1]!;
    expect(last.x).toBeCloseTo(pts[pts.length - 1]!.x);
    expect(last.y).toBeCloseTo(pts[pts.length - 1]!.y);
  });
});
