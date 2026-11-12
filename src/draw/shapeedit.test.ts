import { describe, expect, it } from 'vitest';
import { adjustShapeHandle, shapeHandles } from './shapeedit';

describe('QuickShape handles', () => {
  it('moves either endpoint and keeps the other fixed when snapping its angle', () => {
    const s = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 60, y: 0 } } as const;
    const next = adjustShapeHandle(s, { kind: 'end', end: 'a' }, { x: -5, y: 1 }, true);
    expect(next).toMatchObject({ a: { x: expect.closeTo(-5, 1), y: expect.closeTo(0) }, b: s.b });
    expect(adjustShapeHandle(s, { kind: 'end', end: 'b' }, { x: 10, y: 15 }, false)).toMatchObject({ a: s.a, b: { x: 70, y: 15 } });
  });

  it('resizes a rotated rectangle about the opposite corner', () => {
    const s = { kind: 'rect', cx: 0, cy: 0, w: 30, h: 15, rot: Math.PI / 2 } as const;
    const handles = shapeHandles(s);
    const next = adjustShapeHandle(s, handles[2]!.grab, { x: -10, y: 20 }, false);
    const moved = shapeHandles(next);
    expect(moved[0]!.at).toMatchObject({ x: expect.closeTo(handles[0]!.at.x), y: expect.closeTo(handles[0]!.at.y) });
    expect(moved[2]!.at).toMatchObject({ x: expect.closeTo(handles[2]!.at.x - 10), y: expect.closeTo(handles[2]!.at.y + 20) });
  });

  it('keeps a circle round while its opposite axis endpoint stays fixed', () => {
    const s = { kind: 'ellipse', cx: 0, cy: 0, rx: 25, ry: 25, rot: 0 } as const;
    const next = adjustShapeHandle(s, { kind: 'size', side: { x: 1, y: 0 } }, { x: 20, y: 5 }, true);
    expect(next).toMatchObject({ cx: 10, cy: 0, rx: 35, ry: 35 });
  });
});
