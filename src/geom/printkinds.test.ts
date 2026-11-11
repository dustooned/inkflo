import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { bookletSheets, checkCount, kindById, miniZineCells, PRINT_KINDS, printOrder, printOf, readerSpreads, specFor, spineWidth } from './printkinds';
import { PdfDoc, PdfPage } from '../io/pdf';
import { newBook } from '../doc/model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from '../doc/schema';

describe('print kinds', () => {
  it('has unique ids, sane sizes, and every standard kind', () => {
    const ids = PRINT_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of PRINT_KINDS) {
      expect(k.w).toBeGreaterThan(1);
      expect(k.h).toBeGreaterThan(1);
      expect(k.safe).toBeGreaterThanOrEqual(0);
    }
    expect(kindById('manga-b6')!.rtl).toBe(true);
    expect(kindById('manga-b6')!.w).toBeCloseTo(128 / 25.4, 3);
    expect(specFor(kindById('us-trade')!).binding).toBe('perfect');
  });

  it('page counts: saddle stitch needs multiples of 4, bound books even numbers', () => {
    expect(checkCount(22, 'saddle')).toMatchObject({ blanks: 2, total: 24 });
    expect(checkCount(22, 'saddle').message).toMatch(/22 pages; booklets need multiples of 4\. 2 blank pages will be added/);
    expect(checkCount(24, 'saddle')).toMatchObject({ blanks: 0, message: '' });
    expect(checkCount(23, 'perfect')).toMatchObject({ blanks: 1, total: 24 });
    expect(checkCount(1, 'saddle').total).toBe(4);
    expect(checkCount(5, 'none').blanks).toBe(0);
  });

  it('blank pages go where asked', () => {
    expect(printOrder(6, 'saddle', 'end')).toEqual([0, 1, 2, 3, 4, 5, null, null]);
    expect(printOrder(6, 'saddle', 'beforeBack')).toEqual([0, 1, 2, 3, 4, null, null, 5]);
    expect(printOrder(6, 'saddle', 'afterCover')).toEqual([0, null, null, 1, 2, 3, 4, 5]);
  });

  it('booklet imposition: nested and folded, sheets read 1…n', () => {
    const sheets = bookletSheets(8);
    expect(sheets).toEqual([
      { front: { left: 7, right: 0 }, back: { left: 1, right: 6 } },
      { front: { left: 5, right: 2 }, back: { left: 3, right: 4 } },
    ]);
    // every page appears once
    const all = sheets.flatMap((s) => [s.front.left, s.front.right, s.back.left, s.back.right]).sort((a, b) => a! - b!);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // each side's two pages add up to n-1 (the spread across the fold)
    for (const s of sheets) {
      expect(s.front.left! + s.front.right!).toBe(7);
      expect(s.back.left! + s.back.right!).toBe(7);
    }
    expect(() => bookletSheets(6)).toThrow();
  });

  it('reader spreads: cover alone, pairs after, right to left for manga', () => {
    expect(readerSpreads(5)).toEqual([[null, 0], [1, 2], [3, 4]]);
    expect(readerSpreads(4, true)).toEqual([[0, null], [2, 1], [null, 3]]);
  });

  it('mini-zine: 8 cells, top row upside down, cover bottom right', () => {
    const cells = miniZineCells();
    expect(cells.map((c) => c.slot).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(cells.find((c) => c.slot === 0)).toMatchObject({ row: 1, col: 3, rotated: false });
    expect(cells.filter((c) => c.rotated).every((c) => c.row === 0)).toBe(true);
  });

  it('spine width and book print settings', () => {
    expect(spineWidth(444)).toBe(1);
    const book = newBook('P');
    expect(printOf(book).kind).toBe('us-comic');
    book.print = { ...specFor(kindById('manga-a5')!), blanks: 'beforeBack' };
    const back = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 't', book, art: {} }));
    expect(back.book.print).toEqual(book.print);
  });
});

describe('pdf writer', () => {
  const deflate = async (b: Uint8Array) => new Uint8Array(deflateSync(b));

  it('writes a valid file: header, objects at their xref offsets, trailer', async () => {
    const doc = new PdfDoc(deflate, 'Test (book)');
    const rgba = new Uint8Array(2 * 2 * 4).fill(255);
    rgba[3] = 128; // one translucent pixel → a soft mask
    const img = await doc.addImage(rgba, 2, 2);
    const p = new PdfPage(612, 792).image(img, 10, 10, 100, 100).image(img, 200, 10, 100, 100, true).text('Hello “there” × 2', 50, 700, 12, true).cropMarks(36, 36, 540, 720, 9);
    doc.addPage(p, { trim: [36, 36, 576, 756], bleed: [27, 27, 585, 765] });
    doc.addPage(new PdfPage(612, 792).line(0, 0, 612, 792, 1, 0.5, [4, 2]));
    const bytes = await doc.build();
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/TrimBox [36 36 576 756]');
    expect(text).toContain('/SMask');
    // every xref offset points at "n 0 obj"
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    const table = text.slice(start).split('\n').slice(3).filter((l) => / n $/.test(l));
    table.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10)), Number(l.slice(0, 10)) + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    // the page content stream inflates to our drawing commands
    const m = /<< {2}\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)!;
    const content = inflateSync(bytes.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1]))).toString('latin1');
    expect(content).toContain('/Im1 Do');
    expect(content).toContain('(Hello "there" x 2) Tj');
    expect(content).toContain('-1 0 0 -1'); // the rotated image
  });
});
