import { describe, expect, it } from 'vitest';
import { newBook } from '../doc/model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from '../doc/schema';
import { derivePanels, stripCuts } from '../geom/carve';
import { kindById } from '../geom/printkinds';
import { markKeys } from '../render/marks';
import { assetFit } from './bookassets';
import { webSize } from './webimage';

const KEY = 'assets/abc123-def456.png';

describe('comic strips and Artist marks', () => {
  it('cuts 3 and 4 panels side by side and 3 stacked, in reading order', () => {
    const strip = kindById('daily-strip')!;
    const page = { ...newBook('Strip').pages[0]!, widthIn: strip.w, heightIn: strip.h };
    page.cuts = stripCuts(page, 3);
    const three = derivePanels(page);
    expect(three).toHaveLength(3);
    expect(three.map((p) => Math.round(p.centroid.x * 10) / 10)).toEqual([2.2, 6.5, 10.8]);
    page.cuts = stripCuts(page, 4);
    expect(derivePanels(page)).toHaveLength(4);
    const stacked = kindById('stacked-strip')!;
    const col = { ...page, widthIn: stacked.w, heightIn: stacked.h };
    col.cuts = stripCuts(col, 3, true);
    const ys = derivePanels(col).map((p) => p.centroid.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys).toHaveLength(3);
  });

  it('keeps the Artist mark, its placements and hidden state through save and load', () => {
    const book = newBook('Marked');
    book.assets = [{ key: KEY, name: 'Signature', width: 300, height: 120 }];
    book.artistMark = KEY;
    book.pages[0]!.marks = [{ id: 'm1', key: KEY, x: 12, y: 3.6, width: 0.8 }, { id: 'm2', key: KEY, x: 1, y: 1, width: 0.5, hidden: true }];
    const back = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} })).book;
    expect(back.artistMark).toBe(KEY);
    expect(back.pages[0]!.marks).toEqual(book.pages[0]!.marks);
    expect(markKeys(back)).toEqual([KEY]);
  });

  it('drops an Artist mark that names a missing asset, and refuses non-asset keys', () => {
    const book = newBook('Broken');
    book.artistMark = KEY;
    expect(parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} })).book.artistMark).toBeUndefined();
    book.pages[0]!.marks = [{ id: 'm', key: 'https://example.com/x.png', x: 1, y: 1, width: 1 }];
    expect(() => parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }))).toThrow(/asset key/);
  });

  it('sizes a web image from its width and refuses sizes the browser cannot draw', () => {
    const strip = { widthIn: 13, heightIn: 4 };
    expect(webSize(strip, 1600)).toEqual({ width: 1600, height: 492, tooLarge: false });
    expect(webSize(strip, 50).width).toBe(200);
    expect(webSize({ widthIn: 4, heightIn: 12 }, 16000).tooLarge).toBe(true);
  });

  it('reports the working-copy size for an oversized source', () => {
    expect(assetFit(4000, 3000)).toEqual({ width: 4000, height: 3000, ratio: 1 });
    const big = assetFit(12000, 3000);
    expect(big.width).toBe(8000);
    expect(big.ratio).toBeLessThan(1);
    expect(assetFit(6000, 6000).width * assetFit(6000, 6000).height).toBeLessThanOrEqual(16_000_000);
  });
});
