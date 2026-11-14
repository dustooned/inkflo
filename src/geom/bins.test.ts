import { describe, expect, it } from 'vitest';
import type { BookAsset } from '../doc/model';
import { newBook } from '../doc/model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from '../doc/schema';
import { ALL, assetsIn, binsOf, deleteBin, moveToBin, renameBin, reorderBin, uniqueBin, UNSORTED } from './bins';

const a = (key: string, name: string, bin?: string): BookAsset => ({ key: `assets/${key}-1.png`, name, width: 10, height: 10, ...(bin ? { bin } : {}) });

describe('asset bins', () => {
  const book = () => ({ bins: ['Props', 'Empty'], items: [a('a', 'Sword', 'Props'), a('b', 'Sky'), a('c', 'Car', 'Cars')] });

  it('lists stored bins, bins named by assets, then Unsorted', () => {
    expect(binsOf(book())).toEqual(['Props', 'Empty', 'Cars', UNSORTED]);
    expect(binsOf({ items: [a('a', 'x', 'P')] })).toEqual(['P']);
  });

  it('filters by bin and name', () => {
    const b = book();
    expect(assetsIn(b.items, 'Props').map((x) => x.name)).toEqual(['Sword']);
    expect(assetsIn(b.items, UNSORTED).map((x) => x.name)).toEqual(['Sky']);
    expect(assetsIn(b.items, ALL, 'c').map((x) => x.name)).toEqual(['Car']);
  });

  it('moves, renames and deletes without losing images', () => {
    const b = book();
    const moved = moveToBin(b.items, [b.items[1]!.key], 'Props');
    expect(assetsIn(moved, 'Props')).toHaveLength(2);
    expect(moveToBin(moved, [b.items[1]!.key], UNSORTED)[1]).not.toHaveProperty('bin');
    const r = renameBin(b, 'Props', 'cars');
    expect(r.bins).toEqual(['cars 2', 'Empty', 'Cars', UNSORTED]);
    expect(r.items[0]!.bin).toBe('cars 2');
    const d = deleteBin(b, 'Cars');
    expect(d.bins).toEqual(['Props', 'Empty']);
    expect(d.items).toHaveLength(3);
    expect(d.items[2]).not.toHaveProperty('bin');
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

  it('keeps saved balloons in the book file, without their script link', async () => {
    const { newLetter } = await import('./lettering');
    const { balloonForKit } = await import('../ui/balloonbins');
    const book = newBook('T');
    const l = newLetter(book, { x: 100, y: 100 }, 'shout');
    l.src = { beat: 'b1', line: 0 };
    l.speaker = 'MAYA';
    const saved = balloonForKit([l], 'Maya shouts', 'Maya');
    expect(saved.letters[0]).not.toHaveProperty('src');
    book.balloonKit = { bins: ['Maya'], items: [saved] };
    const f = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }));
    expect(f.book.balloonKit!.bins).toEqual(['Maya']);
    expect(f.book.balloonKit!.items[0]!.letters[0]!.cap.style).toBe('shout');
    expect(f.book.balloonKit!.items[0]!.letters[0]!.speaker).toBe('MAYA');
  });
});
