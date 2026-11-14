/**
 * Bins: named groups of reusable things (images, balloons, layouts), like an editor's media
 * bins. Pure functions that return new arrays, so each change is one undo step.
 */
export interface BinItem { key: string; name: string; bin?: string }
export interface BinState<T extends BinItem> { bins?: string[]; items?: T[] }

export const UNSORTED = 'Unsorted';
export const ALL = '';

export const cleanBin = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 40);

/** Bins in order: the stored list, then any bin an item names, then Unsorted when used. */
export function binsOf<T extends BinItem>(s: BinState<T>): string[] {
  const out = [...(s.bins ?? [])];
  for (const a of s.items ?? []) if (a.bin && !out.includes(a.bin)) out.push(a.bin);
  if ((s.items ?? []).some((a) => !a.bin) && !out.includes(UNSORTED)) out.push(UNSORTED);
  return out;
}

export const binOf = (a: BinItem) => a.bin || UNSORTED;

/** Items in a bin (ALL = every item), optionally filtered by name. */
export function itemsIn<T extends BinItem>(items: T[] | undefined, bin: string, search = ''): T[] {
  const q = search.trim().toLowerCase();
  return (items ?? []).filter((a) => (bin === ALL || binOf(a) === bin) && (!q || a.name.toLowerCase().includes(q)));
}
/** Kept for the image bins' callers. */
export const assetsIn = itemsIn;

/** A name not already used, from `wanted` ("Props", "Props 2", …). */
export function uniqueBin(bins: string[], wanted: string): string {
  const base = cleanBin(wanted) || 'Bin';
  let name = base;
  for (let i = 2; bins.some((b) => b.toLowerCase() === name.toLowerCase()); i++) name = `${base.slice(0, 36)} ${i}`;
  return name;
}

export function withBin<T extends BinItem>(a: T, bin: string): T {
  const { bin: _old, ...rest } = a;
  return (bin && bin !== UNSORTED ? { ...rest, bin } : rest) as T;
}

export function moveToBin<T extends BinItem>(items: T[], keys: string[], bin: string): T[] {
  const set = new Set(keys);
  return items.map((a) => set.has(a.key) ? withBin(a, bin) : a);
}

export function renameBin<T extends BinItem>(s: BinState<T>, from: string, to: string): { bins: string[]; items: T[] } {
  const name = cleanBin(to);
  const bins = binsOf(s);
  if (!name || from === UNSORTED) return { bins, items: s.items ?? [] };
  const target = bins.some((b) => b !== from && b.toLowerCase() === name.toLowerCase()) ? uniqueBin(bins.filter((b) => b !== from), name) : name;
  return {
    bins: bins.map((b) => b === from ? target : b),
    items: (s.items ?? []).map((a) => a.bin === from ? { ...a, bin: target } : a),
  };
}

/** Remove a bin; its items go to Unsorted (nothing is deleted). */
export function deleteBin<T extends BinItem>(s: BinState<T>, bin: string): { bins: string[]; items: T[] } {
  return {
    bins: binsOf(s).filter((b) => b !== bin && b !== UNSORTED),
    items: (s.items ?? []).map((a) => a.bin === bin ? withBin(a, UNSORTED) : a),
  };
}

/** Move a bin to a new position in the list. */
export function reorderBin(bins: string[], bin: string, to: number): string[] {
  const rest = bins.filter((b) => b !== bin);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, bin);
  return rest;
}
