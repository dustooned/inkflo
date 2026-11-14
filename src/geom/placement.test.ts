import { describe, expect, it } from 'vitest';
import { newPage } from '../doc/model';
import { cutsForCount, derivePanels } from './carve';
import { applyPageTemplate, capturePageTemplate } from './pagetemplates';
import { fitImage, hitsImage, imageDpi, imagePoint } from './placement';

describe('placed artwork', () => {
  const image = { x: 0, y: 0, width: 1, height: 1, rotation: 45, pixelWidth: 1200, pixelHeight: 600 };
  const area = { x0: 2, y0: 1, x1: 6, y1: 4 };

  it('fits or fills without warping the source image', () => {
    const fit = fitImage(image, area);
    expect(fit).toMatchObject({ x: 4, y: 2.5, width: 4, height: 2, rotation: 0 });
    expect(imageDpi(fit)).toBe(300);
    expect(fitImage(image, area, true)).toMatchObject({ width: 6, height: 3 });
  });

  it('hits inside the rotated image bounds', () => {
    expect(hitsImage(image, imagePoint(image, 0.45, 0))).toBe(true);
    expect(hitsImage(image, imagePoint(image, 0.55, 0))).toBe(false);
  });
});

it('rescales a saved layout to a new trim without copying content', () => {
  const from = newPage();
  from.cuts = cutsForCount(from, 5);
  from.beats.push({ id: 'private-beat', desc: 'Private script', lines: ['MAYA: Hello.'] });
  const target = { ...newPage(), widthIn: 8, heightIn: 11 };
  applyPageTemplate(target, capturePageTemplate(from, 'My five-panel page'));
  expect(derivePanels(target)).toHaveLength(5);
  expect(target.beats).toEqual([]);
  expect(target.cuts.map((c) => c.id)).not.toEqual(from.cuts.map((c) => c.id));
  expect(target.cuts.some((c) => !!c.extended)).toBe(true);
});

describe('layout bins', () => {
  it('splits one panel with a template scaled into it', async () => {
    const { newPage } = await import('../doc/model');
    const { derivePanels, presetCuts } = await import('./carve');
    const { capturePageTemplate, splitPanelCuts } = await import('./pagetemplates');
    const page = newPage();
    page.cuts = presetCuts(page, 'rows2');
    const grid = { ...newPage(), widthIn: page.widthIn, heightIn: page.heightIn };
    grid.cuts = presetCuts(grid, 'grid4');
    const template = capturePageTemplate(grid, 'Four');
    const bottom = derivePanels(page)[1]!;
    const cuts = splitPanelCuts(page, bottom.centroid, template)!;
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    const after = derivePanels({ ...page, cuts: [...page.cuts, ...cuts] });
    expect(after).toHaveLength(5);
    // the top panel is untouched
    expect(after.filter((p) => p.bbox.y1 <= page.heightIn / 2 + 0.01)).toHaveLength(1);
    expect(splitPanelCuts(page, { x: -5, y: -5 }, template)).toBeNull();
  });
});
