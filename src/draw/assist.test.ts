import { describe, expect, it } from 'vitest';
import { AssistLock, DEFAULT_RULER, focusLines, speedLines, type Ruler } from './assist';
import { pointInPoly } from '../geom/carve';

/** Largest distance of any point from the line through a and b. */
const offLine = (pts: { x: number; y: number }[], a: { x: number; y: number }, b: { x: number; y: number }) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.max(...pts.map((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / l));
};
const ruler = (patch: Partial<Ruler>): Ruler => ({ ...DEFAULT_RULER, ...patch });
const wobbly = (n: number, dx: number, dy: number) => Array.from({ length: n }, (_, i) => ({ x: 1 + i * dx + (i % 2 ? 0.02 : -0.02), y: 1 + i * dy + (i % 3 ? 0.03 : -0.01), pressure: 0.5 }));

function run(r: Ruler, pts: { x: number; y: number; pressure: number }[]) {
  const lock = new AssistLock<(typeof pts)[number]>(r, pts[0]!, 0.05);
  const out = pts.flatMap((p) => lock.push(p));
  return [...out, ...lock.flush()];
}

describe('rulers', () => {
  it('straight: a wobbly stroke becomes a straight line in its own direction', () => {
    const out = run(ruler({ kind: 'straight' }), wobbly(20, 0.1, 0));
    expect(offLine(out, out[0]!, out.at(-1)!)).toBeLessThan(1e-9); // the wobble is gone: one line
    expect(out.at(-1)!.x).toBeGreaterThan(2.5);
    expect(out.every((p) => p.pressure === 0.5)).toBe(true); // pressure kept
  });

  it('parallel: locks to the ruler angle whatever the hand does', () => {
    const out = run(ruler({ kind: 'parallel', angle: 90 }), wobbly(20, 0.02, 0.1));
    for (const p of out) expect(p.x).toBeCloseTo(out[0]!.x, 6);
  });

  it('radial: points along the ray toward the centre', () => {
    const r = ruler({ kind: 'radial', center: { x: 5, y: 5 } });
    const out = run(r, wobbly(15, 0.1, 0.1));
    const start = out[0]!;
    for (const p of out) {
      const cross = (p.x - 5) * (start.y - 5) - (p.y - 5) * (start.x - 5);
      expect(Math.abs(cross)).toBeLessThan(1e-9);
    }
  });

  it('perspective: picks the vanishing point (or vertical) that matches the motion', () => {
    const r = ruler({ kind: 'perspective', vps: [{ x: -10, y: 1 }, { x: 10, y: -6 }], vertical: true });
    const down = run(r, wobbly(15, 0.01, 0.1));
    for (const p of down) expect(p.x).toBeCloseTo(down[0]!.x, 6); // vertical
    const across = run(r, wobbly(15, 0.1, 0));
    // on the line toward the left VP at (-10, 1)
    expect(offLine(across, { x: -10, y: 1 }, across[0]!)).toBeLessThan(1e-9);
  });

  it('strength below 1 keeps some of the hand', () => {
    const exact = run(ruler({ kind: 'parallel', angle: 0, strength: 1 }), wobbly(20, 0.1, 0));
    const soft = run(ruler({ kind: 'parallel', angle: 0, strength: 0.5 }), wobbly(20, 0.1, 0));
    const spread = (pts: { y: number }[]) => Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(spread(exact)).toBeLessThan(1e-9);
    expect(spread(soft)).toBeGreaterThan(0.01);
  });

  it('off passes points straight through', () => {
    const pts = wobbly(5, 0.1, 0);
    expect(run(ruler({ kind: 'off' }), pts)).toEqual(pts);
  });
});

describe('line generators', () => {
  const panel = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];

  it('focus lines run from the panel edge toward the centre, tapering, leaving a clear zone', () => {
    const lines = focusLines(panel, { x: 2, y: 1.5 }, { count: 40, inner: 0.5, jitter: 0.3, seed: 7 });
    expect(lines.length).toBeGreaterThan(30);
    for (const l of lines) {
      const [outer, inner] = l.pts;
      const dOut = Math.hypot(outer!.x - 2, outer!.y - 1.5);
      const dIn = Math.hypot(inner!.x - 2, inner!.y - 1.5);
      expect(dIn).toBeLessThan(dOut);
      expect(dIn).toBeGreaterThan(0.3); // clear zone
      expect(l.pressure).toEqual([1, 0.05]);
    }
  });

  it('speed lines are parallel, inside the panel, tapered at both ends, and deterministic', () => {
    const a = speedLines(panel, 0, { count: 25, jitter: 0.5, length: 0.7, seed: 3 });
    expect(a.length).toBeGreaterThan(15);
    for (const l of a) {
      expect(l.pts[0]!.y).toBeCloseTo(l.pts[2]!.y, 9); // horizontal
      expect(pointInPoly(l.pts[1]!, panel)).toBe(true);
      expect(l.pressure).toEqual([0.05, 1, 0.05]);
    }
    expect(speedLines(panel, 0, { count: 25, jitter: 0.5, length: 0.7, seed: 3 })).toEqual(a);
  });
});
