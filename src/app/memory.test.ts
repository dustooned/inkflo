import { describe, expect, it } from 'vitest';
import { History, type Command } from '../engine/core/history';
import { forgetStepsFor } from './studio';

const step = (label: string, page: string, log: string[]): Command => ({
  label, drawings: [{ id: page }], do: () => log.push('do ' + label), undo: () => log.push('undo ' + label),
});

describe('freeing a page drawn on earlier', () => {
  it('drops that page’s steps and everything older, keeps newer steps on other pages', () => {
    const log: string[] = [];
    const h = new History();
    h.push(step('a1', 'A', log));
    h.push(step('b1', 'B', log));
    h.push(step('a2', 'A', log));
    h.push(step('c1', 'C', log));
    h.push(step('c2', 'C', log));
    expect(forgetStepsFor(h, 'A')).toBe(3);
    expect(h.peekUndo()?.label).toBe('c2');
    h.undo(); h.undo();
    expect(h.undo()).toBeNull();
    expect(log).toEqual(['undo c2', 'undo c1']);
  });

  it('clears redo when it would replay that page', () => {
    const h = new History();
    h.push(step('a1', 'A', []));
    h.push(step('b1', 'B', []));
    h.undo(); h.undo();
    expect(h.peekRedo()?.label).toBe('a1');
    forgetStepsFor(h, 'A');
    expect(h.peekRedo()).toBeNull();
  });

  it('does nothing for a page with no steps', () => {
    const h = new History();
    h.push(step('b1', 'B', []));
    expect(forgetStepsFor(h, 'A')).toBe(0);
    expect(h.peekUndo()?.label).toBe('b1');
  });
});
