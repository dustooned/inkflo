// Vendored from 2Dope src/core/history.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { History } from './history';

/** A command that appends its name on do and removes it on undo. */
function step(log: string[], name: string, drawing?: string) {
  return { label: name, drawings: drawing ? [{ id: drawing }] : undefined, do: () => { log.push(name); }, undo: () => { log.splice(log.lastIndexOf(name), 1); } };
}

describe('History.combine', () => {
  it('makes the last steps one undo step that undoes backwards and redoes in order', () => {
    const h = new History(), log: string[] = [];
    h.push(step(log, 'a'), false);
    h.push(step(log, 'b', 'd1'), false);
    h.push(step(log, 'c', 'd2'), false);
    h.combine(2, 'b+c');
    expect(h.peekUndo()?.label).toBe('b+c');
    expect(h.peekUndo()?.drawings?.map((d) => d.id)).toEqual(['d1', 'd2']);
    h.undo();
    expect(log).toEqual(['a']);
    expect(h.peekUndo()?.label).toBe('a');
    h.redo();
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('ignores a count it cannot combine', () => {
    const h = new History(), log: string[] = [];
    h.push(step(log, 'a'), false);
    h.combine(2, 'x');
    h.combine(1, 'x');
    expect(h.peekUndo()?.label).toBe('a');
  });
});
