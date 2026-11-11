import type { BlankPlace, Binding, Book, PrintSpec } from '../doc/model';

/**
 * Print kinds (EXPLORE-DESK-UI §11) and the page maths of printing (§12): page-count rules,
 * blank pages, booklet imposition, reader spreads, the one-sheet mini-zine. Pure.
 *
 * Sizes are common industry values. Always confirm with your printer: the UI says so.
 */

export type KindGroup = 'Comics' | 'Manga' | 'Albums & magazines' | 'Zines' | 'Strips & web' | 'Single sheets';

export interface PrintKind {
  id: string;
  label: string;
  group: KindGroup;
  /** Trim in inches. */
  w: number;
  h: number;
  bleed: number;
  safe: number;
  binding: Binding;
  /** Suggested dpi (300 colour; line art prints sharper at 600). */
  dpi: number;
  rtl?: boolean;
  note: string;
}

const mm = (v: number) => Math.round((v / 25.4) * 10000) / 10000;

export const PRINT_KINDS: PrintKind[] = [
  { id: 'us-comic', label: 'US comic book (floppy)', group: 'Comics', w: 6.625, h: 10.1875, bleed: 0.125, safe: 0.25, binding: 'saddle', dpi: 300, note: 'Pages in multiples of 4.' },
  { id: 'us-trade', label: 'US graphic novel / trade', group: 'Comics', w: 6.625, h: 10.1875, bleed: 0.125, safe: 0.25, binding: 'perfect', dpi: 300, note: 'Spine width comes from the page count.' },
  { id: 'gn-6x9', label: 'Graphic novel (6 × 9 in)', group: 'Comics', w: 6, h: 9, bleed: 0.125, safe: 0.25, binding: 'perfect', dpi: 300, note: 'A common print-on-demand size.' },
  { id: 'manga-digest', label: 'Manga (US digest)', group: 'Manga', w: 5, h: 7.5, bleed: 0.125, safe: 0.25, binding: 'perfect', dpi: 600, rtl: true, note: 'Reads right to left.' },
  { id: 'manga-b6', label: 'Manga tankōbon (B6)', group: 'Manga', w: mm(128), h: mm(182), bleed: mm(3), safe: mm(5), binding: 'perfect', dpi: 600, rtl: true, note: 'Reads right to left.' },
  { id: 'manga-a5', label: 'Manga (A5)', group: 'Manga', w: mm(148), h: mm(210), bleed: mm(3), safe: mm(5), binding: 'perfect', dpi: 600, rtl: true, note: 'Reads right to left.' },
  { id: 'bd-album', label: 'European album (BD)', group: 'Albums & magazines', w: mm(225), h: mm(297), bleed: mm(3), safe: mm(10), binding: 'hardcover', dpi: 300, note: 'Larger panels; usually 46–62 pages.' },
  { id: 'mag-letter', label: 'Magazine (Letter)', group: 'Albums & magazines', w: 8.5, h: 11, bleed: 0.125, safe: 0.375, binding: 'saddle', dpi: 300, note: 'Pages in multiples of 4.' },
  { id: 'mag-a4', label: 'Magazine (A4)', group: 'Albums & magazines', w: mm(210), h: mm(297), bleed: mm(3), safe: mm(10), binding: 'saddle', dpi: 300, note: 'Pages in multiples of 4.' },
  { id: 'zine-half-letter', label: 'Zine, half-letter', group: 'Zines', w: 5.5, h: 8.5, bleed: 0, safe: 0.25, binding: 'saddle', dpi: 300, note: 'Letter sheets folded in half; prints on a home printer.' },
  { id: 'zine-a5', label: 'Zine, A5', group: 'Zines', w: mm(148), h: mm(210), bleed: 0, safe: mm(6), binding: 'saddle', dpi: 300, note: 'A4 sheets folded in half; prints on a home printer.' },
  { id: 'zine-quarter', label: 'Zine, quarter-letter', group: 'Zines', w: 4.25, h: 5.5, bleed: 0, safe: 0.2, binding: 'saddle', dpi: 300, note: 'Small and pocketable.' },
  { id: 'mini-zine', label: 'Mini-zine, 8 pages from 1 sheet', group: 'Zines', w: 2.75, h: 4.25, bleed: 0, safe: 0.15, binding: 'none', dpi: 300, note: 'One Letter sheet, folded and cut once. Exactly 8 pages.' },
  { id: 'picture-book', label: 'Picture book (8 × 10 in)', group: 'Albums & magazines', w: 8, h: 10, bleed: 0.125, safe: 0.375, binding: 'hardcover', dpi: 300, note: '' },
  { id: 'picture-square', label: 'Picture book, square (8.5 in)', group: 'Albums & magazines', w: 8.5, h: 8.5, bleed: 0.125, safe: 0.375, binding: 'hardcover', dpi: 300, note: '' },
  { id: 'daily-strip', label: 'Newspaper daily strip', group: 'Strips & web', w: 13, h: 4, bleed: 0, safe: 0.15, binding: 'none', dpi: 300, note: 'A landscape strip of 3–4 panels.' },
  { id: 'sunday', label: 'Sunday page (half tabloid)', group: 'Strips & web', w: 11, h: 8.5, bleed: 0, safe: 0.25, binding: 'none', dpi: 300, note: '' },
  { id: 'webtoon', label: 'Webtoon (vertical scroll)', group: 'Strips & web', w: 8, h: 32, bleed: 0, safe: 0.4, binding: 'web', dpi: 100, note: '800 px wide; sliced into images for upload.' },
  { id: 'carousel-45', label: 'Social carousel (4:5)', group: 'Strips & web', w: 10.8, h: 13.5, bleed: 0, safe: 0.5, binding: 'web', dpi: 100, note: '1080 × 1350 px slides.' },
  { id: 'carousel-sq', label: 'Social carousel (square)', group: 'Strips & web', w: 10.8, h: 10.8, bleed: 0, safe: 0.5, binding: 'web', dpi: 100, note: '1080 × 1080 px slides.' },
  { id: 'trading-card', label: 'Trading card', group: 'Single sheets', w: 2.5, h: 3.5, bleed: 0.125, safe: 0.125, binding: 'none', dpi: 300, note: '' },
  { id: 'postcard', label: 'Postcard (4 × 6 in)', group: 'Single sheets', w: 4, h: 6, bleed: 0.125, safe: 0.125, binding: 'none', dpi: 300, note: '' },
  { id: 'poster-11x17', label: 'Poster (11 × 17 in)', group: 'Single sheets', w: 11, h: 17, bleed: 0.125, safe: 0.25, binding: 'none', dpi: 300, note: '' },
  { id: 'poster-18x24', label: 'Poster (18 × 24 in)', group: 'Single sheets', w: 18, h: 24, bleed: 0.125, safe: 0.25, binding: 'none', dpi: 150, note: '' },
  { id: 'poster-a3', label: 'Poster (A3)', group: 'Single sheets', w: mm(297), h: mm(420), bleed: mm(3), safe: mm(6), binding: 'none', dpi: 300, note: '' },
];

export const BINDING_LABEL: Record<Binding, string> = { saddle: 'Saddle stitch (stapled)', perfect: 'Perfect bound (glued spine)', hardcover: 'Hardcover', none: 'Loose sheets', web: 'Web only' };

export type { BlankPlace, Binding, PrintSpec };

export const DEFAULT_PRINT: PrintSpec = { kind: 'us-comic', bleed: 0.125, safe: 0.25, binding: 'saddle', rtl: false, blanks: 'end' };

export function printOf(book: Pick<Book, 'print'>): PrintSpec {
  return { ...DEFAULT_PRINT, ...book.print };
}

export function kindById(id: string): PrintKind | null {
  return PRINT_KINDS.find((k) => k.id === id) ?? null;
}

export function specFor(kind: PrintKind, blanks: BlankPlace = 'end'): PrintSpec {
  return { kind: kind.id, bleed: kind.bleed, safe: kind.safe, binding: kind.binding, rtl: !!kind.rtl, blanks };
}

/** Pages must come in multiples of this. */
export function countRule(binding: Binding): number {
  return binding === 'saddle' ? 4 : binding === 'perfect' || binding === 'hardcover' ? 2 : 1;
}

export interface CountCheck {
  pages: number;
  rule: number;
  blanks: number;
  total: number;
  /** Plain words for the UI; empty when the count already fits. */
  message: string;
}

export function checkCount(pages: number, binding: Binding): CountCheck {
  const rule = countRule(binding);
  const total = Math.max(rule, Math.ceil(pages / rule) * rule);
  const blanks = total - pages;
  const why = rule === 4 ? 'booklets need multiples of 4' : 'bound books need an even number';
  const message = blanks ? `Your book has ${pages} page${pages === 1 ? '' : 's'}; ${why}. ${blanks} blank page${blanks === 1 ? '' : 's'} will be added.` : '';
  return { pages, rule, blanks, total, message };
}

/**
 * The page order for print: book page indexes, with `null` for each blank added to reach the
 * binding's page-count rule. Blanks go at the end, before the back cover, or after the cover.
 */
export function printOrder(pages: number, binding: Binding, place: BlankPlace = 'end'): (number | null)[] {
  const { blanks } = checkCount(pages, binding);
  const order: (number | null)[] = Array.from({ length: pages }, (_, i) => i);
  const fill = Array<null>(blanks).fill(null);
  if (!blanks) return order;
  if (place === 'afterCover' && pages >= 1) order.splice(1, 0, ...fill);
  else if (place === 'beforeBack' && pages >= 2) order.splice(pages - 1, 0, ...fill);
  else order.push(...fill);
  return order;
}

export interface SheetSide {
  /** Page slots on the left and right half of this side of the sheet. */
  left: number | null;
  right: number | null;
}
export interface BookletSheet {
  front: SheetSide;
  back: SheetSide;
}

/**
 * Saddle-stitch imposition (printer spreads) for a slot list whose length is a multiple of 4.
 * Sheet i (outermost first): front = [n−1−2i | 2i], back = [2i+1 | n−2−2i]. Folded and nested, the
 * sheets read 1, 2, 3 … n. Values are slot positions (look them up in the print order).
 */
export function bookletSheets(n: number): BookletSheet[] {
  if (n % 4) throw new Error('A booklet needs a multiple of 4 pages.');
  const out: BookletSheet[] = [];
  for (let i = 0; i < n / 4; i++) {
    out.push({ front: { left: n - 1 - 2 * i, right: 2 * i }, back: { left: 2 * i + 1, right: n - 2 - 2 * i } });
  }
  return out;
}

/** Reader spreads: the cover alone, then pairs side by side (right to left for manga), last alone if odd. */
export function readerSpreads(n: number, rtl = false): [number | null, number | null][] {
  const out: [number | null, number | null][] = [];
  if (!n) return out;
  out.push(rtl ? [0, null] : [null, 0]);
  for (let i = 1; i < n; i += 2) {
    const a = i;
    const b = i + 1 < n ? i + 1 : null;
    out.push(rtl ? [b, a] : [a, b]);
  }
  return out;
}

/**
 * The one-sheet mini-zine: a landscape sheet in a 4 × 2 grid, the usual fold-and-cut template.
 * Top row upside down: pages 5, 4, 3, 2. Bottom row upright: 6, 7, 8 (back), 1 (front).
 * Values are slot positions in the print order.
 */
export interface ZineCell {
  slot: number;
  col: number;
  row: number;
  rotated: boolean;
}
export function miniZineCells(): ZineCell[] {
  const top = [4, 3, 2, 1];
  const bottom = [5, 6, 7, 0];
  return [
    ...top.map((slot, col) => ({ slot, col, row: 0, rotated: true })),
    ...bottom.map((slot, col) => ({ slot, col, row: 1, rotated: false })),
  ];
}

/**
 * Creep for thick saddle-stitched booklets: inner sheets push out, so their pages shift toward
 * the spine by `paperIn` (sheet thickness) per sheet from the outside. Returns the shift for the
 * sheet at index i (outermost = 0) of `sheets`.
 */
export function creepShift(i: number, paperIn: number): number {
  return i * paperIn;
}

/** Spine width for a perfect-bound book: pages / 2 sheets × paper thickness (`ppi` = pages per inch). */
export function spineWidth(pages: number, ppi = 444): number {
  return Math.round((pages / ppi) * 1000) / 1000;
}
