import type { Book, Page, Pt } from '../doc/model';
import { derivePanels, layoutOf } from './carve';
import { describeTransform } from './layoutcode';
import { parseLine } from './lettering';

/**
 * A page as plain data for games, visual novels and custom readers: panel shapes in reading
 * order, each with its beat and lines (speaker, kind, words). Units are inches with the origin
 * at the page's top-left, and `norm` gives the same shapes in 0–1 page units.
 */
export interface PageData {
  page: number;
  size: { width: number; height: number; unit: 'in' };
  layout: { gutter: number; border: number; curve: number };
  panels: {
    number: number;
    polygon: Pt[];
    norm: Pt[];
    box: { x: number; y: number; width: number; height: number };
    moved: { move: Pt; turn: number; scale: number } | null;
    description: string;
    lines: { speaker: string | null; kind: string; text: string }[];
  }[];
}

const r = (n: number) => Math.round(n * 1000) / 1000;

export function pageData(book: Book, page: Page): PageData {
  const W = page.widthIn, H = page.heightIn;
  const L = layoutOf(page);
  return {
    page: book.pages.indexOf(page) + 1,
    size: { width: W, height: H, unit: 'in' },
    layout: { gutter: r(L.gutter), border: r(L.border), curve: L.curve },
    panels: derivePanels(page).map((p) => {
      const beat = page.beats[p.index];
      return {
        number: p.index + 1,
        polygon: p.pts.map((q) => ({ x: r(q.x), y: r(q.y) })),
        norm: p.pts.map((q) => ({ x: r(q.x / W), y: r(q.y / H) })),
        box: { x: r(p.bbox.x0), y: r(p.bbox.y0), width: r(p.bbox.x1 - p.bbox.x0), height: r(p.bbox.y1 - p.bbox.y0) },
        moved: p.transform && p.source ? (() => { const d = describeTransform(p.transform, p.source.centroid); return { move: { x: r(d.move.x), y: r(d.move.y) }, turn: r(d.turn), scale: r(d.scale) }; })() : null,
        description: beat?.desc ?? '',
        lines: (beat?.lines ?? []).map((line) => { const l = parseLine(line); return { speaker: l.speaker, kind: l.style, text: l.text }; }),
      };
    }),
  };
}

/** The whole book: title, author and every page. */
export function bookData(book: Book): { title: string; author: string; pages: PageData[] } {
  return { title: book.title, author: book.author, pages: book.pages.map((p) => pageData(book, p)) };
}
