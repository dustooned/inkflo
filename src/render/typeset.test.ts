import { describe, expect, it } from 'vitest';
import type { TextFrame } from '../doc/model';
import { DEFAULT_TYPE, layoutType, type Measure } from './typeset';

// every character is half the type size wide; a space too
const measure: Measure = (text, size) => text.length * size * 0.5;
const S = 72; // 1 pt = 1 px, so sizes read directly
const frame = (extra: Partial<TextFrame> = {}): TextFrame => ({ ...DEFAULT_TYPE, id: 't', x: 0, y: 0, w: 2, h: 2, text: '', indent: 0, ...extra });

describe('type frames', () => {
  it('wraps words to the frame width and steps baselines by the leading', () => {
    // 144 px wide at 10 px type: 5 px a character, so 28 characters a line
    const l = layoutType(frame({ size: 10, leading: 1.5, align: 'left', text: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh' }), S, measure);
    expect(l.lines.length).toBe(2);
    expect(l.lines[1]!.y - l.lines[0]!.y).toBeCloseTo(15);
    expect(l.overset).toBe(false);
  });

  it('justifies every line but the last of a paragraph', () => {
    const l = layoutType(frame({ size: 10, align: 'justify', text: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh' }), S, measure);
    const first = l.lines[0]!.words, last = l.lines.at(-1)!.words;
    const end = (w: { text: string; x: number }) => w.x + measure(w.text, 10);
    expect(end(first.at(-1)!)).toBeCloseTo(144);
    expect(end(last.at(-1)!)).toBeLessThan(144);
  });

  it('indents paragraphs after the first, centres and right-aligns', () => {
    const l = layoutType(frame({ size: 10, align: 'left', indent: 2, text: 'one\ntwo' }), S, measure);
    expect(l.lines[0]!.words[0]!.x).toBe(0);
    expect(l.lines[1]!.words[0]!.x).toBe(20);
    const c = layoutType(frame({ size: 10, align: 'center', text: 'ab' }), S, measure);
    expect(c.lines[0]!.words[0]!.x).toBeCloseTo((144 - 10) / 2);
    const r = layoutType(frame({ size: 10, align: 'right', text: 'ab' }), S, measure);
    expect(r.lines[0]!.words[0]!.x).toBeCloseTo(134);
  });

  it('flows into a second column, then reports overset text', () => {
    const words = Array.from({ length: 200 }, () => 'word').join(' ');
    const two = layoutType(frame({ size: 10, columns: 2, gutter: 0.2, align: 'left', text: words }), S, measure);
    const xs = new Set(two.lines.map((l) => Math.round(l.words[0]!.x)));
    expect(xs.size).toBe(2);
    expect(two.overset).toBe(true);
  });

  it('sets a drop cap across lines and narrows those lines', () => {
    const l = layoutType(frame({ size: 10, leading: 1.2, align: 'left', dropCap: 3, text: 'Once upon a time there was a long road through the hills and further still it went past the river and over the bridge to town' }), S, measure);
    expect(l.drop?.text).toBe('O');
    expect(l.lines[0]!.words[0]!.text).toBe('nce');
    expect(l.lines[0]!.words[0]!.x).toBeGreaterThan(0);
    expect(l.lines[3]!.words[0]!.x).toBe(0);
  });

  it('applies capitals and centres a short title vertically', () => {
    const l = layoutType(frame({ size: 20, caps: 'all', valign: 'middle', align: 'center', text: 'the end' }), S, measure);
    expect(l.lines[0]!.words.map((w) => w.text)).toEqual(['THE', 'END']);
    expect(l.lines[0]!.y).toBeGreaterThan(60);
  });
});
