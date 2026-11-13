import { expect, it } from 'vitest';
import { applyPoint } from '../engine/core/selxform';
import { placementOf, toSource } from './placement';

it('maps a page point on a moved, rotated and scaled panel back to where its art is stored', () => {
  const t = Math.PI / 6, k = 1.5;
  const m = [k * Math.cos(t), k * Math.sin(t), -k * Math.sin(t), k * Math.cos(t), 2, -1] as const;
  const pl = placementOf(m)!;
  expect(pl.k).toBeCloseTo(1.5);
  const stored = { x: 3.25, y: 4.5 };
  const [x, y] = applyPoint(m, stored.x, stored.y);
  const back = toSource(pl, { x, y });
  expect(back.x).toBeCloseTo(stored.x);
  expect(back.y).toBeCloseTo(stored.y);
});

it('leaves unplaced layers in page space', () => {
  expect(placementOf(null)).toBeNull();
  expect(placementOf([0, 0, 0, 0, 1, 1])).toBeNull();
  expect(toSource(null, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
});
