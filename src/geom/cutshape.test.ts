import { describe, expect, it } from 'vitest';
import type { Pt } from '../doc/model';
import { adjustCut, recognizeCut, smoothCut } from './cutshape';

const S = 80; // pixels per inch on screen
const wobble = (pts: Pt[], amp = 0.01) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * amp, y: p.y + Math.cos(i * 2.3) * amp }));
const along = (n: number, f: (t: number) => Pt) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

describe('knife Auto Shape', () => {
  it('snaps a nearly straight swipe to a line', () => {
    const cut = recognizeCut(wobble(along(30, (t) => ({ x: 1 + 4 * t, y: 3 + 0.02 * t }))), S);
    expect(cut.kind).toBe('line');
    expect(cut.pts).toHaveLength(2);
  });

  it('snaps a bowed swipe to one clean arc', () => {
    const cut = recognizeCut(wobble(along(40, (t) => ({ x: 3 + 2 * Math.cos(Math.PI * (1 - t)), y: 5 - 1.2 * Math.sin(Math.PI * t) }))), S);
    expect(cut.kind).toBe('arc');
    // every point lies on the fitted circle
    const s = cut.shape!;
    if (s.kind !== 'arc') throw new Error('not an arc');
    for (const p of cut.pts) expect(Math.abs(Math.hypot(p.x * S - s.cx, p.y * S - s.cy) - s.r)).toBeLessThan(1);
  });

  it('snaps a zig-zag to crisp corners', () => {
    const corners = [{ x: 1, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 3 }];
    const trail = corners.slice(1).flatMap((b, i) => along(10, (t) => ({ x: corners[i]!.x + (b.x - corners[i]!.x) * t, y: corners[i]!.y + (b.y - corners[i]!.y) * t })));
    expect(recognizeCut(trail, S).kind).toBe('polyline');
  });

  it('reads a long shallow zig-zag across a page as a zig-zag, not a line', () => {
    const c = [{ x: -0.6, y: 8.6 }, { x: 1.5, y: 8.1 }, { x: 3.3, y: 8.7 }, { x: 5.1, y: 8.1 }, { x: 7.2, y: 8.6 }];
    const trail = c.slice(1).flatMap((b, i) => along(10, (t) => ({ x: c[i]!.x + (b.x - c[i]!.x) * t + Math.sin(i * 10 + t * 10) * 0.01, y: c[i]!.y + (b.y - c[i]!.y) * t })));
    expect(recognizeCut(trail, S).kind).toBe('polyline');
  });

  it('reads a shallow bow across a page as an arc', () => {
    const trail = wobble(along(40, (t) => ({ x: -0.6 + 7.8 * t, y: 7 + 0.8 * (2 * t - 1) ** 2 })), 0.02);
    expect(recognizeCut(trail, S).kind).toBe('arc');
  });

  it('smooths a free swipe that is no simple shape, keeping its ends', () => {
    const trail = wobble(along(60, (t) => ({ x: 1 + 5 * t, y: 4 + Math.sin(t * 9) * 0.4 + t * t })), 0.04);
    const cut = recognizeCut(trail, S);
    expect(cut.kind).toBe('smooth');
    expect(cut.pts[0]).toEqual(trail[0]);
    expect(cut.pts.at(-1)!.x).toBeCloseTo(trail.at(-1)!.x);
    // smoother: smaller total turning than the hand-drawn trail
    const turning = (p: Pt[]) => p.slice(2).reduce((sum, q, i) => {
      const a = Math.atan2(p[i + 1]!.y - p[i]!.y, p[i + 1]!.x - p[i]!.x), b = Math.atan2(q.y - p[i + 1]!.y, q.x - p[i + 1]!.x);
      return sum + Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    }, 0);
    expect(turning(cut.pts)).toBeLessThan(turning(trail) * 0.6);
    expect(smoothCut(trail.slice(0, 2), S)).toHaveLength(2);
  });

  it('keeps the start and moves the end with the pen while held', () => {
    const line = recognizeCut(along(20, (t) => ({ x: 1 + 4 * t, y: 3 })), S);
    const moved = adjustCut(line, { x: 5, y: 3 }, { x: 5, y: 4 }, S);
    expect(moved.pts[0]!.x).toBeCloseTo(1);
    expect(moved.pts.at(-1)!.y).toBeCloseTo(4);
    const smooth = { kind: 'smooth' as const, pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] };
    const bent = adjustCut(smooth, { x: 2, y: 0 }, { x: 2, y: 1 }, S);
    expect(bent.pts.map((p) => p.y)).toEqual([0, 0.5, 1]);
  });
});
