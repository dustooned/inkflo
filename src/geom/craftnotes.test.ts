import { describe, expect, it } from 'vitest';
import type { Beat } from '../doc/model';
import { intentDots, turnIndex, turnNotes } from './craftnotes';

const beat = (over: Partial<Beat> = {}): Beat => ({ id: 'b', desc: '', lines: [], ...over });

describe('craft notes', () => {
  it('shows a dot per answered prompt and ignores blanks', () => {
    expect(intentDots(undefined)).toEqual([false, false, false, false, false]);
    expect(intentDots(beat({ intent: { moment: 'Maya hesitates', word: '  ' } }))).toEqual([true, false, false, false, false]);
  });
  it('finds the first marked turn inside the panel count', () => {
    expect(turnIndex([beat(), beat({ turn: true }), beat({ turn: true })], 3)).toBe(1);
    expect(turnIndex([beat(), beat({ turn: true })], 1)).toBeNull();
  });
  it('says nothing without a turn, and flags a turn that is not last or is empty', () => {
    expect(turnNotes([beat({ desc: 'x' })], 1)).toEqual([]);
    const notes = turnNotes([beat({ turn: true }), beat({ desc: 'x' })], 2);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/1 more panel comes/);
    expect(turnNotes([beat({ desc: 'x' }), beat({ turn: true, lines: ['MAYA: No.'] })], 2)).toEqual([]);
    expect(turnNotes([beat({ turn: true, intent: { image: 'A door' } })], 1)).toEqual([]);
  });
});
