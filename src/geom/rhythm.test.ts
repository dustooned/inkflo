import { describe, expect, it } from 'vitest';
import type { Beat, TransitionId } from '../doc/model';
import { rhythmNote, rhythmOf } from './rhythm';

const beats = (...ts: (TransitionId | undefined)[]): Beat[] => ts.map((transition, i) => ({ id: 'b' + i, desc: '', lines: [], ...(transition ? { transition } : {}) }));

describe('rhythm', () => {
  it('leaves panels without a beat or a transition unset and never counts them', () => {
    const r = rhythmOf(beats('action', undefined), 4);
    expect(r.segments.map((s) => s.transition)).toEqual(['action', null, null, null]);
    expect(r.set).toBe(1);
    expect(r.runs).toEqual([]);
  });
  it('finds runs of two or more and counts each type', () => {
    const r = rhythmOf(beats('scene', 'action', 'action', 'action', 'aspect'), 5);
    expect(r.runs).toEqual([{ transition: 'action', from: 1, to: 3 }]);
    expect(r.counts).toEqual({ scene: 1, action: 3, aspect: 1 });
    expect(r.dominant).toBe('action');
  });
  it('has no dominant type on a tie, and a run ends at an unset panel', () => {
    expect(rhythmOf(beats('action', 'scene'), 2).dominant).toBeNull();
    expect(rhythmOf(beats('action', undefined, 'action'), 3).runs).toEqual([]);
  });
  it('only comments on a run of three or more, and only as a note', () => {
    expect(rhythmNote(rhythmOf(beats('action', 'action'), 2))).toBe('');
    expect(rhythmNote(rhythmOf(beats('moment', 'moment', 'moment'), 3))).toMatch(/3 panels in a row/);
  });
});
