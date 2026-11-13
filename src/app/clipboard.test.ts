import { expect, it } from 'vitest';
import type { Letter, Stroke } from '../doc/model';
import { moveStrokes, readClipboard, relabelLetters } from './clipboard';

const letter = (id: string, x: number, extra: Partial<Letter> = {}): Letter => ({
  id, cap: { x, y: 100, text: 'Hi', tails: [{ x: x - 10, y: 160, join: 'merged', width: 1.2 }] } as unknown as Letter['cap'], ...extra,
});

it('pastes lettering with fresh ids, kept joins, no script link, moved with its tails', () => {
  let n = 0;
  const out = relabelLetters([
    letter('a', 50, { src: { beat: 'b1', line: 0 }, generated: true }),
    letter('b', 90, { continuation: { after: 'a', join: 'merge' } }),
  ], { x: 20, y: -5 }, () => 'new' + n++);
  expect(out.map((l) => l.id)).toEqual(['new0', 'new1']);
  expect(out[1]!.continuation).toEqual({ after: 'new0', join: 'merge' });
  expect(out[0]!.src).toBeUndefined();
  expect(out[0]!.generated).toBeUndefined();
  expect(out[0]!.cap.x).toBe(70);
  expect(out[0]!.cap.tails[0]).toMatchObject({ x: 60, y: 155 });
  // a join to a balloon that was not copied is dropped
  expect(relabelLetters([letter('c', 0, { continuation: { after: 'gone', join: 'stack' } })], { x: 0, y: 0 }, () => 'x')[0]!.continuation).toBeUndefined();
});

it('moves strokes without touching the originals', () => {
  const s: Stroke = { pts: [{ x: 1, y: 2, p: 0.5 }], w: 0.02, brushId: 'g-pen' } as unknown as Stroke;
  const [moved] = moveStrokes([s], { x: 1, y: -1 });
  expect(moved!.pts[0]).toMatchObject({ x: 2, y: 1 });
  expect(s.pts[0]).toMatchObject({ x: 1, y: 2 });
});

it('reads inkflo data from another tab, and plain text from other apps', async () => {
  const strokes = { kind: 'strokes', type: 'ink', strokes: [], centre: { x: 1, y: 1 } };
  expect(await readClipboard('inkflo-clipboard:v1:' + JSON.stringify(strokes), [])).toEqual(strokes);
  expect(await readClipboard('  HOLD THAT DOOR!  ', [])).toEqual({ kind: 'text', text: 'HOLD THAT DOOR!' });
});
