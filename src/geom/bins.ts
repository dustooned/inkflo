import type { Book, BookAsset } from '../doc/model';

/**
 * Asset bins: named groups of a book's images, like an editor's media bins. Pure functions that
 * return new arrays, so every change is one undo step (see ui/assetbins.ts).
 */
export const UNSORTED = 'Unsorted';
export const ALL = '';

export const cleanBin = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 40);

/** Bins in order: the stored list, then any bin an asset names, then Unsorted when used. */
export function binsOf(book: Pick<Book, 'bins' | 'assets'>): string[] {
  const out = [...(book.bins ?? [])];
  for (const a of book.assets ?? []) if (a.bin && !out.includes(a.bin)) out.push(a.bin);
  if ((book.assets ?? []).some((a) => !a.bin) && !out.includes(UNSORTED)) out.push(UNSORTED);
  return out;
}

export const binOf = (a: BookAsset) => a.bin || UNSORTED;

/** Assets in a bin (ALL = every asset), optionally filtered by name. */
export function assetsIn(assets: BookAsset[] | undefined, bin: string, search = ''): BookAsset[] {
  const q = search.trim().toLowerCase();
  return (assets ?? []).filter((a) => (bin === ALL || binOf(a) === bin) && (!q || a.name.toLowerCase().includes(q)));
}

/** A name not already used, from `wanted` ("Props", "Props 2", …). */
export function uniqueBin(bins: string[], wanted: string): string {
  const base = cleanBin(wanted) || 'Bin';
  let name = base;
  for (let i = 2; bins.some((b) => b.toLowerCase() === name.toLowerCase()); i++) name = `${base.slice(0, 36)} ${i}`;
  return name;
}

export const withBin = (a: BookAsset, bin: string): BookAsset => {
  const { bin: _old, ...rest } = a;
  return bin && bin !== UNSORTED ? { ...rest, bin } : rest;
};

export function moveToBin(assets: BookAsset[], keys: string[], bin: string): BookAsset[] {
  const set = new Set(keys);
  return assets.map((a) => set.has(a.key) ? withBin(a, bin) : a);
}

export function renameBin(book: Pick<Book, 'bins' | 'assets'>, from: string, to: string): { bins: string[]; assets: BookAsset[] } {
  const name = cleanBin(to);
  const bins = binsOf(book);
  if (!name || from === UNSORTED) return { bins, assets: book.assets ?? [] };
  const target = bins.some((b) => b !== from && b.toLowerCase() === name.toLowerCase()) ? uniqueBin(bins.filter((b) => b !== from), name) : name;
  return {
    bins: bins.map((b) => b === from ? target : b),
    assets: (book.assets ?? []).map((a) => a.bin === from ? { ...a, bin: target } : a),
  };
}

/** Remove a bin; its images go to Unsorted (nothing is deleted). */
export function deleteBin(book: Pick<Book, 'bins' | 'assets'>, bin: string): { bins: string[]; assets: BookAsset[] } {
  return {
    bins: binsOf(book).filter((b) => b !== bin && b !== UNSORTED),
    assets: (book.assets ?? []).map((a) => a.bin === bin ? withBin(a, UNSORTED) : a),
  };
}

/** Move a bin to a new position in the list. */
export function reorderBin(bins: string[], bin: string, to: number): string[] {
  const rest = bins.filter((b) => b !== bin);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, bin);
  return rest;
}
