// Vendored from 2Dope src/lettering/markup.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { freshState, runsOf, stripMarkup, wrapMarkup } from './markup';
import { defaultCaption, readCaption } from './spec';
import { applyStyle, captureStyle } from './styles';

describe('per-word styling', () => {
  it('splits a line into bold, italic and coloured runs', () => {
    const r = runsOf('I *really* _do_ [#e02020]mean it[/] now', freshState());
    expect(r.map(x => [x.text, x.bold, x.italic, x.color])).toEqual([
      ['I ', false, false, null], ['really', true, false, null], [' ', false, false, null], ['do', false, true, null],
      [' ', false, false, null], ['mean it', false, false, '#e02020'], [' now', false, false, null],
    ]);
  });
  it('carries styling on to the next line, and strips markup for measuring', () => {
    const s = freshState();
    runsOf('this *goes', s);
    expect(runsOf('on* here', s).map(x => x.bold)).toEqual([true, false]);
    expect(stripMarkup('[#00AA00]*Hi*[/] _there_')).toBe('Hi there');
  });
  it('wraps a selection in markup, words only', () => {
    expect(wrapMarkup('say it loud', 4, 7, 'bold')).toEqual({ text: 'say *it* loud', start: 5, end: 7 });
    expect(wrapMarkup('say it loud', 3, 7, 'italic').text).toBe('say _it_ loud');
    expect(wrapMarkup('so red', 3, 6, { color: '#FF0000' }).text).toBe('so [#ff0000]red[/]');
    expect(wrapMarkup('abc', 1, 1, 'bold').text).toBe('abc');
  });
});

describe('under-fill, ink start and joined balloons in the caption model', () => {
  it('reads them back, clamped; a style keeps the under-fill but not the joined balloons', () => {
    const c = readCaption({ ...defaultCaption(100, 100), underFill: { color: '#223344', dx: 9, dy: -0.5 }, links: [{ text: 'And more!', x: 300, y: 200 }, { x: 'bad' }], values: { inkStart: 30 } });
    expect(c.underFill).toEqual({ color: '#223344', dx: 3, dy: -0.5 });
    expect(c.links).toEqual([{ text: 'And more!', x: 300, y: 200 }]);
    expect(c.values?.inkStart).toBe(30);
    const s = captureStyle(c, 's', 'Shadowed');
    const other = applyStyle(defaultCaption(0, 0), s);
    expect(other.underFill).toEqual({ color: '#223344', dx: 3, dy: -0.5 });
    expect(other.links).toBeUndefined();
    expect(readCaption({ ...defaultCaption(0, 0), links: Array.from({ length: 9 }, (_, i) => ({ text: String(i), x: i, y: i })) }).links).toHaveLength(3);
  });
});
