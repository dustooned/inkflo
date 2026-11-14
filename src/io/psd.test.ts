import { expect, it } from 'vitest';
import { newBook, newPage } from '../doc/model';
import { psdPlan } from './psd';

function book(pages = 3) {
  const b = newBook('The Last Train');
  while (b.pages.length < pages) b.pages.push(newPage());
  return b;
}

it('describes a single active page as one PSD with trim and pixel size', () => {
  const b = book();
  const page = b.pages[1]!;
  const p = psdPlan(b, { from: 2, to: 2 }, 'art', 300, 'the-last-train');
  expect(p.pages).toEqual([2]);
  expect(p.file).toBe('the-last-train-page-2.psd');
  expect(p.pagesLabel).toBe('Page 2');
  expect(p.trimLabel).toContain(`${page.widthIn}″ × ${page.heightIn}″ trim`);
  expect(p.pixelsLabel).toBe(`${Math.round(page.widthIn * 300).toLocaleString('en-US')} × ${Math.round(page.heightIn * 300).toLocaleString('en-US')} px at 300 dpi`);
  expect(p.contents.join(' ')).toMatch(/panel that has artwork/);
  expect(p.tooLarge).toBe(false);
});

it('names a range ZIP and lists template contents', () => {
  const b = book();
  const p = psdPlan(b, { from: 3, to: 1 }, 'template', 150, 'the-last-train');
  expect(p.pages).toEqual([1, 2, 3]);
  expect(p.file).toBe('the-last-train-template-pages-1-3.zip');
  expect(p.pagesLabel).toBe('Pages 1–3 (3 PSDs in a ZIP)');
  expect(p.contents.join(' ')).toMatch(/blank Pencil, Ink and Colour layers, masked/);
  expect(p.contents.at(-1)).toMatch(/\.inkflo/);
});

it('updates pixels with dpi and flags pages too large for the browser', () => {
  const b = book(1);
  expect(psdPlan(b, { from: 1, to: 1 }, 'art', 72, 'x').pixelsLabel).toMatch(/at 72 dpi$/);
  b.pages[0]!.widthIn = 60;
  b.pages[0]!.heightIn = 60;
  expect(psdPlan(b, { from: 1, to: 1 }, 'art', 600, 'x').tooLarge).toBe(true);
});
