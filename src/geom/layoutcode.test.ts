import { describe, expect, it } from 'vitest';
import { newPage } from '../doc/model';
import { derivePanels, layoutOf, presetCuts } from './carve';
import { describeTransform, formatLayoutCode, parseLayoutCode, transformMatrix } from './layoutcode';

const page = () => newPage();

describe('layout code', () => {
  it('writes and reads back a grid, its style and a moved panel', () => {
    const p = page();
    p.cuts = presetCuts(p, 'grid4');
    p.layout = { ...layoutOf(p), gutter: 0.25, border: 3 / 72, curve: 1, cornerRadius: 0.1 };
    const panels = derivePanels(p);
    p.layout.panelTransforms = [{ at: { x: panels[1]!.centroid.x / p.widthIn, y: panels[1]!.centroid.y / p.heightIn }, matrix: transformMatrix(panels[1]!.centroid, { x: 0.3, y: -0.2 }, 6, 1.1), order: 1 }];
    const code = formatLayoutCode(p);
    expect(code).toMatch(/^gutter 0\.25$/m);
    expect(code).toMatch(/^border 3pt$/m);
    expect(code).toMatch(/^panel 2 move 0\.3,-0\.2 turn 6 scale 1\.1$/m);
    const back = parseLayoutCode(code, p);
    expect(back.errors).toEqual([]);
    expect(back.cuts.map((c) => c.id)).toEqual(p.cuts.map((c) => c.id));
    expect(back.layout.gutter).toBe(0.25);
    expect(back.layout.border).toBeCloseTo(3 / 72);
    expect(back.layout.cornerRadius).toBe(0.1);
    const t = back.layout.panelTransforms![0]!;
    t.matrix.forEach((v, i) => expect(v).toBeCloseTo(p.layout!.panelTransforms![0]!.matrix[i]!, 3));
  });

  it('describes a transform as move, turn and scale about the panel centre', () => {
    const c = { x: 2, y: 3 };
    const d = describeTransform({ at: { x: 0, y: 0 }, matrix: transformMatrix(c, { x: 1, y: 0.5 }, -12, 0.8), order: 1 }, c);
    expect(d.move.x).toBeCloseTo(1);
    expect(d.move.y).toBeCloseTo(0.5);
    expect(d.turn).toBeCloseTo(-12);
    expect(d.scale).toBeCloseTo(0.8);
  });

  it('turns typed cuts into panels, with numbers in inches', () => {
    const p = page();
    const r = parseLayoutCode('gutter 0.2\ncut 3.3,0 -> 3.3,10.187\ncut 0,5 -> 6.625,5\npanel 1 round 0.3', p);
    expect(r.errors).toEqual([]);
    expect(derivePanels({ ...p, cuts: r.cuts, layout: r.layout })).toHaveLength(4);
    expect(r.layout.panelCorners).toHaveLength(1);
  });

  it('explains mistakes in plain words and keeps going', () => {
    const r = parseLayoutCode('gutter wide\ncut 1,1\nfrobnicate\npanel 9 turn 5\nkeep cZZZZ\ncut 0,5 -> 7,5', page());
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 5, 4]);
    expect(r.errors[0]!.message).toMatch(/number of inches/);
    expect(r.errors[1]!.message).toMatch(/needs points/);
    expect(r.errors[2]!.message).toMatch(/isn't a layout word/);
    expect(r.errors[4]!.message).toMatch(/no panel 9/);
    expect(r.cuts).toHaveLength(1);
  });

  it('keeps drawn one-panel cuts by their short id', () => {
    const p = page();
    p.cuts = [{ id: 'cabc12', mode: 'panel', pts: [{ x: 3, y: -1 }, { x: 3, y: 11 }], extended: [{ x: 3, y: 0 }, { x: 3, y: 10.187 }] }];
    const code = formatLayoutCode(p);
    expect(code).toMatch(/keep cabc12/);
    expect(parseLayoutCode(code, p).cuts[0]).toBe(p.cuts[0]);
  });

  it('sets black gutters and an inked page edge, and writes them back', () => {
    const p = page();
    const r = parseLayoutCode('gutters black\nedge on\ncut 0,5 -> 6.625,5', p);
    expect(r.errors).toEqual([]);
    expect(r.layout.gutterPaper).toBe('#000000');
    expect(r.layout.edgeBorder).toBe(true);
    const code = formatLayoutCode({ ...p, cuts: r.cuts, layout: r.layout });
    expect(code).toMatch(/^gutters black$/m);
    expect(code).toMatch(/^edge on$/m);
    expect(parseLayoutCode('gutters none', p).layout.gutterPaper).toBeNull();
    expect(parseLayoutCode('gutters #1A2B3C', p).layout.gutterPaper).toBe('#1a2b3c');
    // deleting the lines goes back to white gutters and no edge
    const plain = parseLayoutCode('gutter 0.2', { ...p, layout: r.layout });
    expect(plain.layout.gutterPaper).toBeUndefined();
    expect(plain.layout.edgeBorder).toBeUndefined();
    expect(parseLayoutCode('edge maybe', p).errors[0]!.message).toMatch(/on or off/);
  });

  it('keeps every character for highlighting', () => {
    const src = '  cut 1,0 -> 1,9   # left strip';
    const r = parseLayoutCode(src, page());
    expect(r.lines[0]!.tokens.map((t) => t.text).join('')).toBe(src);
    expect(r.lines[0]!.tokens.map((t) => t.kind)).toContain('arrow');
  });
});

describe('page data for games', () => {
  it('lists panels in reading order with shapes and parsed lines', async () => {
    const { newBook } = await import('../doc/model');
    const { pageData } = await import('./pagedata');
    const b = newBook('Game');
    const p = b.pages[0]!;
    p.cuts = presetCuts(p, 'rows2');
    p.beats = [{ id: 'b1', desc: 'Rooftop', lines: ['MAYA (whisper): Look.', 'CAPTION: Midnight.'] }];
    const d = pageData(b, p);
    expect(d.page).toBe(1);
    expect(d.panels).toHaveLength(2);
    expect(d.panels[0]!.box.y).toBe(0);
    expect(d.panels[0]!.norm.every((q) => q.x >= 0 && q.x <= 1)).toBe(true);
    expect(d.panels[0]!.lines).toEqual([{ speaker: 'MAYA', kind: 'whisper', text: 'Look.' }, { speaker: null, kind: 'box', text: 'Midnight.' }]);
    expect(d.panels[1]!.description).toBe('');
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});
