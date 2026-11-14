import { describe, expect, it } from 'vitest';
import type { BookAsset } from '../doc/model';
import { newBook } from '../doc/model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from '../doc/schema';
import { ALL, assetsIn, binsOf, deleteBin, moveToBin, renameBin, reorderBin, uniqueBin, UNSORTED } from './bins';

const a = (key: string, name: string, bin?: string): BookAsset => ({ key: `assets/${key}-1.png`, name, width: 10, height: 10, ...(bin ? { bin } : {}) });

describe('asset bins', () => {
  const book = () => ({ bins: ['Props', 'Empty'], assets: [a('a', 'Sword', 'Props'), a('b', 'Sky'), a('c', 'Car', 'Cars')] });

  it('lists stored bins, bins named by assets, then Unsorted', () => {
    expect(binsOf(book())).toEqual(['Props', 'Empty', 'Cars', UNSORTED]);
    expect(binsOf({ assets: [a('a', 'x', 'P')] })).toEqual(['P']);
  });

  it('filters by bin and name', () => {
    const b = book();
    expect(assetsIn(b.assets, 'Props').map((x) => x.name)).toEqual(['Sword']);
    expect(assetsIn(b.assets, UNSORTED).map((x) => x.name)).toEqual(['Sky']);
    expect(assetsIn(b.assets, ALL, 'c').map((x) => x.name)).toEqual(['Car']);
  });

  it('moves, renames and deletes without losing images', () => {
    const b = book();
    const moved = moveToBin(b.assets, [b.assets[1]!.key], 'Props');
    expect(assetsIn(moved, 'Props')).toHaveLength(2);
    expect(moveToBin(moved, [b.assets[1]!.key], UNSORTED)[1]).not.toHaveProperty('bin');
    const r = renameBin(b, 'Props', 'cars');
    expect(r.bins).toEqual(['cars 2', 'Empty', 'Cars', UNSORTED]);
    expect(r.assets[0]!.bin).toBe('cars 2');
    const d = deleteBin(b, 'Cars');
    expect(d.bins).toEqual(['Props', 'Empty']);
    expect(d.assets).toHaveLength(3);
    expect(d.assets[2]).not.toHaveProperty('bin');
  });

  it('names and orders bins', () => {
    expect(uniqueBin(['Bin', 'Bin 2'], 'bin')).toBe('bin 3');
    expect(uniqueBin(['Props'], 'Cars')).toBe('Cars');
    expect(reorderBin(['A', 'B', 'C'], 'C', 0)).toEqual(['C', 'A', 'B']);
  });

  it('round-trips through the book file', () => {
    const book = newBook('T');
    book.assets = [{ key: 'assets/8ppw6wtu-mz.png', name: 'Sword', width: 20, height: 10, bin: 'Props' }];
    book.bins = ['Props', 'Empty'];
    const f = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }));
    expect(f.book.bins).toEqual(['Props', 'Empty']);
    expect(f.book.assets![0]!.bin).toBe('Props');
  });
});
