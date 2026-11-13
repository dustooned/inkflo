import { describe, expect, it } from 'vitest';
import { clustersFor, overflowActions } from './chrome';

describe('desk chrome', () => {
  it.each([
    ['draw', ['ink', 'smudge', 'eraser', 'pencil', 'clone', 'vpen', 'vedit', 'lines', 'fill', 'tone', 'selection', 'pixels', 'image']],
    ['layout', ['knife', 'erase', 'resize', 'place', 'curve']],
    ['caption', ['select', 'letter', 'draw-balloon']],
    ['script', []],
    ['print', []],
  ] as const)('keeps each %s tool exactly once', (desk, ids) => {
    const tools = ids.map((id) => ({ id }));
    const seen = clustersFor(desk, tools).flatMap((cluster) => cluster.tools.map((tool) => tool.id));
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('preserves tool order inside clusters and puts unknown tools in paint', () => {
    expect(clustersFor('draw', [{ id: 'fill' }, { id: 'future' }, { id: 'pencil' }, { id: 'pixels' }])).toEqual([
      { id: 'paint', tools: [{ id: 'future' }, { id: 'pencil' }] },
      { id: 'colour', tools: [{ id: 'fill' }] },
      { id: 'edit', tools: [{ id: 'pixels' }] },
    ]);
  });

  it('keeps every action in order and handles an empty group', () => {
    expect(overflowActions([1, 2, 3, 4, 5, 6], 4)).toEqual({ shown: [1, 2, 3, 4], overflow: [5, 6] });
    expect(overflowActions([1, 2], 4)).toEqual({ shown: [1, 2], overflow: [] });
    expect(overflowActions([], 4)).toEqual({ shown: [], overflow: [] });
  });
});
