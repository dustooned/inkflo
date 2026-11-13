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
