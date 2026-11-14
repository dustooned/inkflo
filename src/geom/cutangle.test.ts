import { expect, it } from 'vitest';
import { angleLabel, cutAngle, snapCutEnd } from './cutangle';

const o = { x: 1, y: 1 };

it('measures cut angles as a reader sees them, without direction', () => {
  expect(cutAngle(o, { x: 3, y: 1 })).toBeCloseTo(0);
  expect(cutAngle(o, { x: 1, y: -1 })).toBeCloseTo(90);
  expect(cutAngle(o, { x: 2, y: 0 })).toBeCloseTo(45); // up and right
  expect(cutAngle(o, { x: 0, y: 2 })).toBeCloseTo(45); // the same line drawn the other way
  expect(cutAngle(o, { x: 2, y: 2 })).toBeCloseTo(135);
});

it('clicks to level, upright and diagonals within a few degrees, keeping the length', () => {
  const near = snapCutEnd(o, { x: 5, y: 1.1 }); // about 1.4° off level
  expect(near.snapped).toBe(true);
  expect(near.end.y).toBeCloseTo(1);
  expect(Math.hypot(near.end.x - 1, near.end.y - 1)).toBeCloseTo(Math.hypot(4, 0.1));
  expect(snapCutEnd(o, { x: 5, y: 2 }).snapped).toBe(false); // 14° stays free
  expect(snapCutEnd(o, { x: 1.05, y: 5 }).end.x).toBeCloseTo(1);
});

it('steps by 15° with Shift', () => {
  const s = snapCutEnd(o, { x: 5, y: 2 }, 15); // about 14° → 15°
  expect(s.angle).toBeCloseTo(165); // downward-right folds to 165°
  expect(angleLabel(0)).toBe('0° level');
  expect(angleLabel(90.2)).toBe('90° upright');
  expect(angleLabel(37.4)).toBe('37°');
});
