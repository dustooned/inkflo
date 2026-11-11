import { describe, expect, it } from 'vitest';
import { newBook, newPage } from '../doc/model';
import { derivePanels, presetCuts } from './carve';
import { centreCrossing, construction, downbeatPanel, gridCuts, gridLines, nearestGuide, revealIssues, snapGridCut, staggerCentre } from './composition';
import { printOf } from './printkinds';

describe('comic composition', () => {
  it('fits rabatment to both orientations and projects drawing onto a guide', () => {
    expect(construction('rabatment', 4, 6).circles).toEqual([{ x: 2, y: 2, r: 2 }, { x: 2, y: 4, r: 2 }]);
    expect(construction('rabatment', 6, 4).circles[1]).toEqual({ x: 4, y: 2, r: 2 });
    expect(nearestGuide('thirds', 6, 9, { x: 2.1, y: 1 }, 0.15)).toEqual({ point: { x: 2, y: 1 }, angle: 90 });
    expect(nearestGuide('off', 6, 9, { x: 2.1, y: 1 }, 0.15)).toBeUndefined();
  });

  it('carves unequal modules and only snaps a cut near a single module edge', () => {
    const page = { ...newPage(), widthIn: 8, heightIn: 10 };
    const grid = { columns: [1, 2, 1], rows: [1, 3], gutter: 0.15 };
    expect(gridLines(page, grid)).toEqual({ x: [2, 6], y: [2.5] });
    page.cuts = gridCuts(page, grid);
    expect(derivePanels(page)).toHaveLength(6);
    expect(snapGridCut(page, grid, [{ x: 2.08, y: 1 }, { x: 1.94, y: 7 }], 0.1)).toEqual([{ x: 2, y: 1 }, { x: 2, y: 7 }]);
    const diagonal = [{ x: 2.08, y: 1 }, { x: 5.95, y: 7 }];
    expect(snapGridCut(page, grid, diagonal, 0.1)).toBe(diagonal);
  });

  it('staggers a simple centre crossing and keeps a spatial downbeat in the lower right', () => {
    const page = newPage();
    page.cuts = presetCuts(page, 'grid4');
    page.downbeat = { x: 0.8, y: 0.8 };
    expect(centreCrossing(page)).toBe(true);
    page.cuts = staggerCentre(page)!;
    expect(centreCrossing(page)).toBe(false);
    const panels = derivePanels(page);
    expect(panels).toHaveLength(4);
    expect(downbeatPanel(page, panels)?.index).toBe(3);
  });

  it('warns when setup and reveal are visible at once, and uses the correct side for manga', () => {
    const book = newBook('Test');
    const setup = newPage();
    const reveal = newPage();
    const left = newPage();
    const right = newPage();
    book.pages.push(setup, reveal, left, right);
    setup.beats.push({ id: 'setup', desc: '', lines: [] });
    const beat = { id: 'reveal', desc: '', lines: [], reveal: { pageId: setup.id, beatId: 'setup' } };
    reveal.beats.push(beat);
    left.beats.push(beat);
    right.beats.push(beat);
    expect(revealIssues(book, reveal, derivePanels(reveal))[0]?.text).toContain('shares a spread');
    for (const rtl of [false, true]) {
      book.print = { ...printOf(book), rtl };
      expect(revealIssues(book, left, derivePanels(left))[0]?.text).toContain('first-read side');
      expect(revealIssues(book, right, derivePanels(right))).toEqual([]);
    }
    setup.beats = [];
    expect(revealIssues(book, right, derivePanels(right))[0]?.text).toContain('missing setup');
  });
});
