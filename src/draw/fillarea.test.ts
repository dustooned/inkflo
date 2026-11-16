import { describe, expect, it } from 'vitest';
import { flatAround } from './fillarea';

const W = 12;
const H = 6;
function image(rows: string[], colours: Record<string, [number, number, number, number]>) {
  const d = new Uint8ClampedArray(W * H * 4);
  rows.forEach((r, y) => [...r].forEach((c, x) => { const v = colours[c] ?? [0, 0, 0, 0]; d.set(v, (y * W + x) * 4); }));
  return d;
}
const C = { r: [200, 60, 50, 255], b: [40, 80, 200, 255], R: [205, 62, 52, 255] } as Record<string, [number, number, number, number]>;

describe('flat fill area', () => {
  it('takes the joined pixels of one colour and stops at another colour', () => {
    const img = image(['rrrrbbbb', 'rrrrbbbb'], C);
    const a = flatAround(img, W, H, 1, 0)!;
    expect(a.count).toBe(8);
    expect([a.x0, a.x1, a.y0, a.y1]).toEqual([0, 3, 0, 1]);
  });
  it('treats near colours as one flat but not far ones', () => {
    expect(flatAround(image(['rrRR'], C), W, H, 0, 0)!.count).toBe(4);
    expect(flatAround(image(['rrRR'], C), W, H, 0, 0, 2)!.count).toBe(2);
  });
  it('returns null on clear pixels and outside the image', () => {
    expect(flatAround(image(['rr'], C), W, H, 5, 0)).toBeNull();
    expect(flatAround(image(['rr'], C), W, H, -1, 0)).toBeNull();
  });
  it('does not jump across a clear gap', () => {
    const a = flatAround(image(['rr  rr'], C), W, H, 0, 0)!;
    expect(a.count).toBe(2);
  });
});
