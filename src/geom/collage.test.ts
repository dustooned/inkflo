import { expect, it } from 'vitest';
import type { PlacedImage } from '../doc/model';
import { cleanCutout, cutoutPath, toImageUnits } from './collage';
import { imagePoint } from './placement';

const image = (extra: Partial<PlacedImage> = {}): PlacedImage => ({ x: 3, y: 4, width: 2, height: 1, rotation: 30, pixelWidth: 400, pixelHeight: 200, ...extra });

it('maps page points into image units that follow rotation and size', () => {
  const img = image();
  const corner = imagePoint(img, 1, 0.5); // the placed top-right… in local inches
  const u = toImageUnits(img, corner);
  expect(u.x).toBeCloseTo(0.5);
  expect(u.y).toBeCloseTo(0.5);
  expect(toImageUnits(img, { x: 3, y: 4 })).toEqual({ x: 0, y: 0 });
});

it('draws the cut at the image scale, and tears it repeatably', () => {
  const cut = [{ x: -0.25, y: -0.25 }, { x: 0.25, y: -0.25 }, { x: 0.25, y: 0.25 }, { x: -0.25, y: 0.25 }];
  const plain = cutoutPath(image({ cutout: cut }), 100);
  expect(plain).toEqual([{ x: -50, y: -25 }, { x: 50, y: -25 }, { x: 50, y: 25 }, { x: -50, y: 25 }]);
  const torn = cutoutPath(image({ cutout: cut, torn: 1 }), 100);
  expect(torn.length).toBeGreaterThan(20);
  expect(cutoutPath(image({ cutout: cut, torn: 1 }), 100)).toEqual(torn);
  expect(cutoutPath(image(), 100)).toEqual([]);
});

it('cleans a hand-drawn cut and refuses a degenerate one', () => {
  expect(cleanCutout([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.001, y: 0 }])).toBeNull();
  const big = Array.from({ length: 3000 }, (_, i) => ({ x: Math.cos(i / 477) * 0.4, y: Math.sin(i / 477) * 0.4 }));
  expect(cleanCutout(big)!.length).toBeLessThanOrEqual(1024);
  expect(cleanCutout([{ x: -2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }])).toEqual([{ x: -0.6, y: 0 }, { x: 0, y: 0.6 }, { x: 0.6, y: 0 }]);
});

it('keeps a cut, its tear and its paper edge through save and load', async () => {
  const { newBook, newLayer } = await import('../doc/model');
  const { parseBookFile, stringifyBookFile, FORMAT, SCHEMA } = await import('../doc/schema');
  const book = newBook('Zine');
  const l = newLayer('colour');
  l.image = image({ cutout: [{ x: -0.3, y: -0.2 }, { x: 0.3, y: -0.2 }, { x: 0, y: 0.3 }], torn: 0.4, edge: { width: 0.05, color: '#ffffff' } });
  book.pages[0]!.groups.at(-1)!.layers.push(l);
  const back = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }));
  expect(back.book.pages[0]!.groups.at(-1)!.layers.at(-1)!.image).toEqual(l.image);
});

it('keeps a layer outline through save and load', async () => {
  const { newBook, newLayer } = await import('../doc/model');
  const { parseBookFile, stringifyBookFile, FORMAT, SCHEMA } = await import('../doc/schema');
  const book = newBook('Outline');
  const l = newLayer('ink');
  l.outline = { width: 0.04, color: '#000000' };
  book.pages[0]!.groups.at(-1)!.layers.push(l);
  const back = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }));
  expect(back.book.pages[0]!.groups.at(-1)!.layers.at(-1)!.outline).toEqual(l.outline);
});
