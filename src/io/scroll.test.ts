import { expect, it } from 'vitest';
import { breakArtSize, breakHeight, type BreakArt } from './scroll';

const art = (width: number, height: number, fit: BreakArt['fit'] = 'width', end = false): BreakArt =>
  ({ image: { width, height } as unknown as BreakArt['image'], fit, end });

it('sizes break art to the strip width or its own size, never wider than the strip', () => {
  expect(breakArtSize(art(400, 100))).toEqual({ w: 800, h: 200 });
  expect(breakArtSize(art(400, 100, 'natural'))).toEqual({ w: 400, h: 100 });
  expect(breakArtSize(art(1600, 200, 'natural'))).toEqual({ w: 800, h: 100 });
  expect(breakArtSize(art(400, 100), 200)).toEqual({ w: 200, h: 50 });
});

it('adds the art to the gap between pages, and after the last page only when asked', () => {
  const plain = { gap: 80, breakArt: null };
  expect(breakHeight(plain, 0, 3)).toBe(80);
  expect(breakHeight(plain, 2, 3)).toBe(0);
  const withArt = { gap: 80, breakArt: art(400, 100) };
  expect(breakHeight(withArt, 0, 3)).toBe(280);
  expect(breakHeight(withArt, 2, 3)).toBe(0);
  expect(breakHeight({ gap: 80, breakArt: art(400, 100, 'width', true) }, 2, 3)).toBe(200);
  // the preview strip scales the gap with its width
  expect(breakHeight(withArt, 0, 3, 200)).toBe(70);
});

import { resolveScroll, scrollEstimate } from './scroll';
import { newBook } from '../doc/model';

it('fills in and clamps scroll options, and flattens JPG onto white', () => {
  const base = { range: { from: 1, to: 1 }, gap: 80, background: null };
  expect(resolveScroll(base)).toMatchObject({ width: 800, sliceHeight: 1280, format: 'png', background: null, trim: false });
  expect(resolveScroll({ ...base, format: 'jpeg' }).background).toBe('#ffffff');
  expect(resolveScroll({ ...base, format: 'webp' }).background).toBeNull();
  expect(resolveScroll({ ...base, width: 5, sliceHeight: 99999 })).toMatchObject({ width: 320, sliceHeight: 4000 });
});

it('estimates how many images the episode becomes at a given width and slice height', () => {
  const book = newBook('t');
  book.pages[0]!.widthIn = 8;
  book.pages[0]!.heightIn = 32;
  const base = { range: { from: 1, to: 1 }, gap: 80, background: '#ffffff' };
  // 8 x 32 in at 800 px wide is 3200 rows: three 1280-row images
  expect(scrollEstimate(book, base)).toEqual({ width: 800, rows: 3200, images: 3 });
  // wider means taller: 1080 px wide is 4320 rows, 1600-row slices give three
  expect(scrollEstimate(book, { ...base, width: 1080, sliceHeight: 1600 })).toEqual({ width: 1080, rows: 4320, images: 3 });
});
