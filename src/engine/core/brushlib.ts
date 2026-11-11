// Vendored from 2Dope src/core/brushlib.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { cloneBrush, PRESETS, sanitizeBrushExtras, type BrushSettings } from './brush';
import { readVectorStyle } from './vectorstyle';

/**
 * Brush library categories (Procreate Dreams style). "Mine" holds the brushes you saved; your own
 * collections (brush sets) have ids of their own.
 */
export type BrushCategory = string;

export const CATEGORIES: { id: BrushCategory; label: string }[] = [
  { id: 'sketch', label: 'Sketching' },
  { id: 'ink', label: 'Inking' },
  { id: 'paint', label: 'Painting' },
  { id: 'vector', label: 'Vector' },
  { id: 'mine', label: 'My brushes' },
];

/** Where each built-in brush lives. */
const BUILT_IN: Record<string, BrushCategory> = {
  'Vector Ink':'vector', 'Vector Chisel':'vector', 'Vector Dry Ink':'vector', 'Vector Pencil':'vector', 'Vector Dots':'vector', 'Vector Pattern':'vector',
  Pencil: 'sketch',
  'Shading Pencil': 'sketch',
  Charcoal: 'sketch',
  Ink: 'ink',
  'Brush Pen': 'ink',
  'Fine Liner': 'ink',
  'Pixel Ink': 'ink',
  Marker: 'paint',
  'Textured Paint': 'paint',
  'Soft Airbrush': 'paint',
};

export function categoryOf(name: string, mine: readonly BrushSettings[], sets?: BrushSets): BrushCategory {
  if (mine.some((b) => b.name === name)) {
    const at = sets?.where[name];
    return at && sets!.sets.some((s) => s.id === at) ? at : 'mine';
  }
  return BUILT_IN[name] ?? 'paint';
}

/** Your own brush collections, and which collection each of your brushes is in (by name). */
export interface BrushSets {
  sets: { id: string; name: string }[];
  where: Record<string, string>;
}

export const NO_SETS: BrushSets = { sets: [], where: {} };

/** Every category to show: the built-in ones, My brushes, then your collections. */
export function allCategories(sets: BrushSets): { id: BrushCategory; label: string; own: boolean }[] {
  return [...CATEGORIES.map((c) => ({ ...c, own: false })), ...sets.sets.map((s) => ({ id: s.id, label: s.name, own: true }))];
}

/** A new collection (its id is new; the name is kept short). */
export function addSet(sets: BrushSets, name: string, id: string): BrushSets {
  return { sets: [...sets.sets, { id, name: name.trim().slice(0, 30) || 'Brushes' }], where: { ...sets.where } };
}

/** Put brushes in a collection ('mine' takes them out of any). */
export function moveTo(sets: BrushSets, names: string[], id: BrushCategory): BrushSets {
  const where = { ...sets.where };
  for (const n of names) {
    if (id === 'mine' || !sets.sets.some((s) => s.id === id)) delete where[n];
    else where[n] = id;
  }
  return { sets: sets.sets, where };
}

/** A brush was renamed: it stays where it was. */
export function renamedIn(sets: BrushSets, from: string, to: string): BrushSets {
  if (!(from in sets.where)) return sets;
  const where = { ...sets.where };
  where[to] = where[from]!;
  delete where[from];
  return { sets: sets.sets, where };
}

/** A brush was deleted. */
export function forget(sets: BrushSets, name: string): BrushSets {
  if (!(name in sets.where)) return sets;
  const where = { ...sets.where };
  delete where[name];
  return { sets: sets.sets, where };
}

/** A collection deleted: its brushes go back to My brushes (they are not deleted). */
export function removeSet(sets: BrushSets, id: string): BrushSets {
  const where: Record<string, string> = {};
  for (const [n, s] of Object.entries(sets.where)) if (s !== id) where[n] = s;
  return { sets: sets.sets.filter((s) => s.id !== id), where };
}

export function renameSet(sets: BrushSets, id: string, name: string): BrushSets {
  return { sets: sets.sets.map((s) => (s.id === id ? { ...s, name: name.trim().slice(0, 30) || s.name } : s)), where: sets.where };
}

/** Collections read back from storage (bad entries dropped). */
export function readSets(v: unknown): BrushSets {
  if (!v || typeof v !== 'object') return NO_SETS;
  const o = v as { sets?: unknown; where?: unknown };
  const sets = Array.isArray(o.sets) ? o.sets.filter((s): s is { id: string; name: string } => !!s && typeof s.id === 'string' && typeof s.name === 'string').slice(0, 50) : [];
  const where: Record<string, string> = {};
  if (o.where && typeof o.where === 'object') for (const [n, s] of Object.entries(o.where as Record<string, unknown>)) if (typeof s === 'string' && sets.some((x) => x.id === s)) where[n] = s;
  return { sets, where };
}

export function isBuiltIn(name: string): boolean {
  return PRESETS.some((p) => p.name === name);
}

/** A name not used by any brush yet: "Ink copy", "Ink copy 2", … */
export function uniqueName(want: string, taken: readonly string[]): string {
  const base = want.trim().slice(0, 40) || 'My brush';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const n = `${base} ${i}`;
    if (!taken.includes(n)) return n;
  }
  return `${base} ${Date.now()}`;
}

/**
 * A saved brush read back from storage: every field the engine needs is filled from the Pencil
 * so an older or hand-edited entry never breaks drawing. Null when it is not a brush at all.
 */
export function readBrush(v: unknown): BrushSettings | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<BrushSettings>;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  const base = cloneBrush(PRESETS[0]!);
  const out = { ...base, ...o, name: o.name.trim().slice(0, 40) } as BrushSettings;
  if(o.vectorStyle !== undefined) {
    try {out.vectorStyle=readVectorStyle(o.vectorStyle);}catch{return null;}
    for(const [key,min,max] of [['size',.1,4096],['roundness',.01,1],['spacing',.02,10],['scatter',0,2],['flow',0,1],['opacity',0,1]] as const) {
      if(typeof out[key]!=='number' || !Number.isFinite(out[key]) || out[key]<min || out[key]>max)return null;
    }
  }
  for (const k of Object.keys(base) as (keyof BrushSettings)[]) {
    const want = typeof base[k];
    if (typeof out[k] !== want) (out as unknown as Record<string, unknown>)[k] = base[k];
  }
  if (!Number.isFinite(out.size) || out.size <= 0) out.size = base.size;
  // an image tip must be a small image data URL; anything else falls back to the round tip
  if (out.tipImage !== undefined && !(typeof out.tipImage === 'string' && out.tipImage.startsWith('data:image/') && out.tipImage.length < 400_000)) delete out.tipImage;
  for (const k of ['hueJitter', 'satJitter', 'brightJitter', 'wetPull'] as const) {
    const v = out[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) delete out[k];
    else out[k] = Math.min(1, Math.max(0, v));
  }
  if (out.strokeColor !== undefined && typeof out.strokeColor !== 'boolean') delete out.strokeColor;
  if (out.grainImage !== undefined && !(typeof out.grainImage === 'string' && out.grainImage.startsWith('data:image/') && out.grainImage.length < 600_000)) delete out.grainImage;
  return sanitizeBrushExtras(out);
}
