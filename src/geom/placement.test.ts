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
