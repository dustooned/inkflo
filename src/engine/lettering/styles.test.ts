// Vendored from 2Dope src/lettering/styles.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { defaultCaption } from './spec';
import { applyStyle, BUILTIN_STYLES, captureStyle, readStyle, STYLE_FORMAT } from './styles';

describe('caption styles', () => {
  const source = { ...defaultCaption(100, 100, 'shout'), text: 'POW', font: 'bangers', fill: '#ffee00', shape: 1.4, look: { spikes: 9 }, values: { tracking: 40, reveal: 30 }, tails: [{ x: 10, y: 20, join: 'lightning' as const, width: 2, zigs: 5 }] };
  it('captures the look, not the words, place or animation', () => {
    const s = captureStyle(source, 'st1', 'Loud');
    expect(s.look).toMatchObject({ font: 'bangers', fill: '#ffee00', style: 'shout', shape: 1.4, look: { spikes: 9 } });
    expect(s.tracking).toBe(40);
    expect(s.tail).toEqual({ join: 'lightning', width: 2, zigs: 5 });
    expect(JSON.stringify(s)).not.toContain('POW');
  });
  it('applies to another caption, keeping its words, place, tail tips and other settings', () => {
    const target = { ...defaultCaption(400, 300), text: 'Hello', values: { reveal: 50 }, tails: [{ x: 380, y: 420, bend: [390, 380] as [number, number], join: 'merged' as const, width: 1.2 }] };
    const out = applyStyle(target, captureStyle(source, 'st1', 'Loud'));
    expect(out).toMatchObject({ text: 'Hello', x: 400, y: 300, font: 'bangers', style: 'shout', fill: '#ffee00' });
    expect(out.values).toEqual({ reveal: 50, tracking: 40 });
    expect(out.tails[0]).toMatchObject({ x: 380, y: 420, bend: [390, 380], join: 'lightning', zigs: 5 });
  });
  it('round-trips through a file, checks everything, and refuses other files', () => {
    const s = readStyle(JSON.parse(JSON.stringify(captureStyle(source, 'st1', 'Loud'))));
    expect(applyStyle(defaultCaption(0, 0), s).style).toBe('shout');
    const bad = readStyle({ ...captureStyle(source, 'x', 'Bad'), look: { inkWidth: 99, fill: 'red', size: 'enormous' } });
    expect(bad.look).toMatchObject({ inkWidth: 0.6 });
    expect(bad.look.fill).toBe('#ffffff');
    expect(() => readStyle({ format: 'something-else' })).toThrow();
    expect(() => readStyle({ format: STYLE_FORMAT, v: 2 })).toThrow(/newer/);
    expect(readStyle({ ...captureStyle(source, 'x', 'F'), font: { name: 'Mine', ext: 'exe', data: 'AAAA' } }).font).toBeUndefined();
  });
  it('ships ready-made styles that all read back cleanly', () => {
    for (const s of BUILTIN_STYLES) expect(readStyle(JSON.parse(JSON.stringify(s))).look).toEqual(s.look);
  });
});
