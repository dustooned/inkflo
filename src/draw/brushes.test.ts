import { afterEach, describe, expect, it } from 'vitest';
import { brushFor, entry, knownBrush, LIBRARY, readUserBrushes, setBookBrushes, setUserBrushes, snapshotId } from './brushes';
import { cloneBrush } from '../engine/core/brush';

afterEach(() => {
  setBookBrushes(undefined);
  setUserBrushes([]);
});

describe('brush library', () => {
  it('has unique ids and the comic inkers', () => {
    const ids = LIBRARY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['g-pen', 'maru-pen', 'mapping-pen', 'brush-pen', 'pencil-hb']) expect(entry(id)).not.toBeNull();
  });

  it('a snapshot id is stable for the same settings and changes when they change', () => {
    const g = entry('g-pen')!;
    expect(snapshotId(g)).toBe(snapshotId({ ...g, settings: cloneBrush(g.settings) }));
    expect(snapshotId({ ...g, settings: { ...g.settings, hardness: 0.5 } })).not.toBe(snapshotId(g));
    expect(snapshotId(g).startsWith('g-pen~')).toBe(true);
  });

  it('strokes draw with the book snapshot, not the brush as later edited', () => {
    const g = entry('g-pen')!;
    const id = snapshotId(g);
    setBookBrushes({ [id]: { ...cloneBrush(g.settings), hardness: 0.31 } });
    expect(brushFor(id, 'ink').hardness).toBe(0.31);
    expect(knownBrush(id)).toBe(true);
    // without the snapshot it falls back to the library brush of that id
    setBookBrushes(undefined);
    expect(brushFor(id, 'ink').hardness).toBe(g.settings.hardness);
  });

  it('user brushes are read back, junk is dropped', () => {
    const g = entry('g-pen')!;
    const list = readUserBrushes([{ ...g, id: 'my-1', name: 'Mine', group: 'ink' }, { id: 3 }, null, 'x']);
    expect(list).toHaveLength(1);
    expect(list[0]!.group).toBe('mine');
    setUserBrushes(list);
    expect(entry('my-1')?.name).toBe('Mine');
    expect(readUserBrushes('nope')).toEqual([]);
  });
});
