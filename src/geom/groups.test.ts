import { describe, expect, it } from 'vitest';
import { newLayer, newPage, type Page } from '../doc/model';
import { derivePanels, makeCut, presetCuts } from './carve';
import { groupAt, groupLabel, groupPanels, insertIndex, syncGroups } from './groups';

function grid4(): Page {
  const p = newPage(0);
  p.cuts = presetCuts(p, 'grid4');
  syncGroups(p, derivePanels(p));
  return p;
}
const panelGroups = (p: Page) => p.groups.filter((g) => g.kind === 'panel');

describe('panel groups', () => {
  it('every panel gets a group, in reading order, between Over panels / Gutters and Background', () => {
    const p = grid4();
    expect(p.groups.map((g) => g.kind)).toEqual(['over', 'gutter', 'panel', 'panel', 'panel', 'panel', 'background']);
    const owners = groupPanels(p, derivePanels(p));
    expect(panelGroups(p).map((g) => owners.get(g.id)!.index)).toEqual([0, 1, 2, 3]);
  });

  it('a mark in a gutter goes to the Gutters group; with no panels, to Background', () => {
    const p = grid4();
    const panels = derivePanels(p);
    // the 2 × 2 grid's gutters cross at the page centre
    expect(groupAt(p, panels, { x: p.widthIn / 2, y: p.heightIn / 2 }).kind).toBe('gutter'); // where the gutters cross
    expect(groupAt(p, panels, panels[0]!.centroid).kind).toBe('panel');
    expect(groupAt(p, [], { x: 1, y: 1 }).kind).toBe('background');
  });

  it('syncing again changes nothing', () => {
    const p = grid4();
    expect(syncGroups(p, derivePanels(p))).toBe(false);
  });

  it('splitting a panel keeps its group in one half and gives the other half a new group', () => {
    const p = grid4();
    const before = panelGroups(p).map((g) => g.id);
    const cut = makeCut(p, [{ x: 0.5, y: 1.2 }, { x: 3, y: 1.2 }], 'panel', true)!;
    p.cuts.push(cut);
    expect(syncGroups(p, derivePanels(p))).toBe(true);
    expect(panelGroups(p)).toHaveLength(5);
    for (const id of before) expect(panelGroups(p).some((g) => g.id === id)).toBe(true);
  });

  it('an uncut keeps both groups when both hold art; an empty duplicate goes away', () => {
    const p = grid4();
    const [a, b] = panelGroups(p);
    a!.layers.push({ ...newLayer('ink'), strokes: [{ pts: [{ x: 1, y: 1 }], w: 0.02, brushId: 'g-pen', seed: 1 }] });
    b!.layers.push({ ...newLayer('ink'), strokes: [{ pts: [{ x: 5, y: 1 }], w: 0.02, brushId: 'g-pen', seed: 2 }] });
    p.cuts = p.cuts.filter((c) => Math.abs(c.pts[0]!.y - c.pts[1]!.y) > 1); // remove the horizontal cut: 2 tall panels
    syncGroups(p, derivePanels(p));
    expect(panelGroups(p).map((g) => g.id)).toEqual(expect.arrayContaining([a!.id, b!.id]));
    expect(panelGroups(p)).toHaveLength(2); // the two empty bottom groups were merged away
  });

  it('a stroke goes to the group of the panel under it; outside panels, Background', () => {
    const p = grid4();
    const panels = derivePanels(p);
    expect(groupAt(p, panels, { x: 1, y: 1 }).id).toBe(panelGroups(p)[0]!.id);
    expect(groupAt(p, panels, { x: 5.5, y: 9 }).id).toBe(panelGroups(p)[3]!.id);
  });

  it('labels come from the beat, and new layers stack by type', () => {
    const p = grid4();
    p.beats = [{ id: 'b', desc: 'Rooftop at night', lines: [] }];
    const panels = derivePanels(p);
    const g = panelGroups(p)[0]!;
    expect(groupLabel(p, panels, g)).toBe('1 · Rooftop at night');
    expect(groupLabel(p, panels, panelGroups(p)[1]!)).toBe('Panel 2');
    g.layers.push(newLayer('ink'));
    expect(insertIndex(g, 'pencil')).toBe(0); // pencil above ink
    expect(insertIndex(g, 'colour')).toBe(1); // colour under ink
  });
});

describe('gutter bands', () => {
  it('the band along a cut is the gutter; panel middles are not', async () => {
    const { inGutter, gutterMask } = await import('./gutters');
    const p = grid4();
    expect(inGutter(p, { x: p.widthIn / 2, y: p.heightIn / 2 })).toBe(true);
    expect(inGutter(p, { x: p.widthIn / 4, y: p.heightIn / 4 })).toBe(false);
    const dpi = 20;
    const w = Math.round(p.widthIn * dpi);
    const h = Math.round(p.heightIn * dpi);
    const m = gutterMask(p, dpi, w, h);
    expect(m[Math.floor(h / 2) * w + Math.floor(w / 2)]).toBe(1);
    expect(m[Math.floor(h / 4) * w + Math.floor(w / 4)]).toBe(0);
  });
});
