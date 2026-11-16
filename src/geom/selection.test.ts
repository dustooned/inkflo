import { expect, it } from 'vitest';
import { outlinesOverlap, strokeTouchesOutline } from './selection';
import { grabSelection, selectionCenter, selectionFrame } from '../ui/selectiongesture';

const rectangle = (x: number, y: number, w: number, h: number) =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

it('finds an overlapping panel even when every lasso corner starts outside it', () => {
  const panel = rectangle(2, 1, 1, 4);
  expect(outlinesOverlap(rectangle(0, 2, 6, 1), panel)).toBe(true);
  expect(outlinesOverlap(rectangle(0, 6, 6, 1), panel)).toBe(false);
});

it('selects the painted edge of a vector line even when its centreline is outside the lasso', () => {
  const stroke = { pts: [{ x: 1, y: 2 }, { x: 4, y: 2 }], w: 0.2, brushId: 'g-pen', seed: 1 };
  expect(strokeTouchesOutline(stroke, rectangle(2, 2.06, 1, 0.1))).toBe(true);
  expect(strokeTouchesOutline(stroke, rectangle(2, 2.2, 1, 0.1))).toBe(false);
  expect(strokeTouchesOutline({ ...stroke, pts: [{ x: 1, y: 2 }] }, rectangle(1.04, 2.03, 0.03, 0.03))).toBe(true);
});

it('keeps the middle of a tiny fitted selection draggable at different panel sizes', () => {
  const bounds = { x0: 1, y0: 1, x1: 1.01, y1: 1.01 };
  for (const scale of [24, 96, 192]) {
    const frame = selectionFrame(bounds, scale);
    expect(grabSelection(frame, selectionCenter(bounds), scale, true)?.kind).toBe('move');
    expect(grabSelection(frame, { x: frame.x1, y: frame.y1 }, scale, true)?.kind).toBe('resize');
  }
});
