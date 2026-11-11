import { cloneBrush, dyn, NO_TILT_SHADE, PRESETS, type BrushSettings } from '../engine/core/brush';
import { readBrush } from '../engine/core/brushlib';
import { hashBytes } from '../engine/io/hash';
import type { Pass } from '../doc/model';

/**
 * The brush library (BRUSH-AND-INK §4) and brush lookup.
 *
 * - **Library brushes** are the ten comic presets (inkflo choices, tuned by eye; open to tuning
 *   in the Brush Studio) plus 2Dope's ten presets.
 * - **User brushes** are edited copies, kept on the device.
 * - **Book snapshots**: the first time a brush draws in a book, its exact settings are copied into
 *   `book.brushes` under `<id>~<hash>`, and strokes point at that snapshot. Editing a brush later
 *   never changes strokes already drawn, and a book opens the same on any device.
 */

export type LinePass = Exclude<Pass, 'colour'>;
export type BrushGroup = 'ink' | 'pencil' | 'paint' | 'texture' | '2dope' | 'mine';

export interface BrushEntry {
  id: string;
  name: string;
  group: BrushGroup;
  /** The colour it draws in: pencil blue or ink black. */
  pass: LinePass;
  /** Default width, inches. */
  w: number;
  /** One line about what it is for. */
  note: string;
  settings: BrushSettings;
}

export const DEFAULT_BRUSH: Record<LinePass, string> = { pencil: 'pencil-hb', ink: 'g-pen' };

export const PASS_STYLE: Record<LinePass, { color: string; opacity: number }> = {
  pencil: { color: '#4E7EA8', opacity: 0.55 },
  ink: { color: '#1B1C22', opacity: 1 },
};

const engine = (name: string): BrushSettings => cloneBrush(PRESETS.find((p) => p.name === name) ?? PRESETS[0]!);
const noShade = { ...NO_TILT_SHADE };

/** A hard inking base everything comic starts from. */
function inkBase(name: string): BrushSettings {
  return {
    ...engine('Ink'),
    name,
    hardness: 0.98,
    spacing: 0.05,
    flow: 1,
    opacity: 1,
    grain: 0,
    opacityDyn: dyn('off'),
    flowDyn: dyn('off'),
    tiltShade: noShade,
    smoothing: 0.25,
    pulledString: false,
  };
}

export const LIBRARY: BrushEntry[] = [
  {
    id: 'g-pen', name: 'G-pen', group: 'ink', pass: 'ink', w: 0.022, note: 'The default inker: strong pressure swell, crisp ends',
    settings: { ...inkBase('G-pen'), sizeDyn: dyn('pressure', 0.06, 0.55), taperStart: 30, taperEnd: 40, taperShape: 0.3 },
  },
  {
    id: 'maru-pen', name: 'Maru pen', group: 'ink', pass: 'ink', w: 0.012, note: 'Technical lines, little swell, no taper',
    settings: { ...inkBase('Maru pen'), sizeDyn: dyn('pressure', 0.45, 1), taperStart: 0, taperEnd: 0, hardness: 1 },
  },
  {
    id: 'mapping-pen', name: 'Mapping pen', group: 'ink', pass: 'ink', w: 0.008, note: 'Fine detail, very pressure-sensitive',
    settings: { ...inkBase('Mapping pen'), sizeDyn: dyn('pressure', 0.02, 1.4), taperStart: 20, taperEnd: 30 },
  },
  {
    id: 'brush-pen', name: 'Brush pen', group: 'ink', pass: 'ink', w: 0.05, note: 'Thick-to-thin, long tapers',
    settings: { ...inkBase('Brush pen'), hardness: 0.88, sizeDyn: dyn('pressure', 0.02, 1.3), taperStart: 60, taperEnd: 90, taperShape: 0.6, smoothing: 0.35 },
  },
  {
    id: 'dry-ink', name: 'Dry ink', group: 'ink', pass: 'ink', w: 0.04, note: 'Grainy, builds up, drags on the paper',
    settings: { ...inkBase('Dry ink'), hardness: 0.9, flow: 0.7, spacing: 0.08, grain: 0.6, grainScale: 0.8, opacityDyn: dyn('pressure', 0.5, 1), sizeDyn: dyn('pressure', 0.3, 1) },
  },
  {
    id: 'pencil-hb', name: 'Pencil HB', group: 'pencil', pass: 'pencil', w: 0.03, note: 'Grainy blue pencil, tilt to shade',
    settings: { ...engine('Pencil'), name: 'Pencil HB', smoothing: 0 },
  },
  {
    id: 'rough-pencil', name: 'Rough pencil', group: 'pencil', pass: 'pencil', w: 0.045, note: 'Loose layout lines, a little scatter',
    settings: { ...engine('Pencil'), name: 'Rough pencil', spacing: 0.25, scatter: 0.15, grain: 0.5, hardness: 0.6, sizeDyn: dyn('pressure', 0.4, 1), smoothing: 0 },
  },
  {
    id: 'ink-wash', name: 'Ink wash', group: 'paint', pass: 'ink', w: 0.15, note: 'Watery grey wash that builds and blends',
    settings: { ...inkBase('Ink wash'), hardness: 0.2, flow: 0.25, opacity: 0.7, spacing: 0.1, wetPull: 0.4, sizeDyn: dyn('pressure', 0.5, 1), opacityDyn: dyn('pressure', 0.3, 1), taperStart: 0, taperEnd: 0 },
  },
  {
    id: 'flat-brush', name: 'Flat brush', group: 'paint', pass: 'ink', w: 0.08, note: 'Chisel tip at 45°, for blacks and spotting',
    settings: { ...inkBase('Flat brush'), roundness: 0.25, angle: 45, hardness: 0.9, sizeDyn: dyn('pressure', 0.4, 1), taperStart: 0, taperEnd: 0 },
  },
  {
    id: 'tone-brush', name: 'Tone brush', group: 'texture', pass: 'ink', w: 0.12, note: 'Hard-edged texture for tone and stipple',
    settings: { ...inkBase('Tone brush'), hardness: 1, antiAlias: false, grain: 0.9, grainScale: 0.4, sizeDyn: dyn('off'), taperStart: 0, taperEnd: 0, smoothing: 0 },
  },
  // 2Dope's presets, as they are
  ...PRESETS.map((p): BrushEntry => ({
    id: `2dope-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: p.name,
    group: '2dope',
    pass: /pencil|charcoal/i.test(p.name) ? 'pencil' : 'ink',
    w: Math.max(0.01, Math.min(0.2, p.size / 300)),
    note: 'From 2Dope',
    settings: cloneBrush(p),
  })),
];

export const GROUP_LABEL: Record<BrushGroup, string> = { ink: 'Inking', pencil: 'Pencils', paint: 'Brush & wash', texture: 'Texture', '2dope': '2Dope set', mine: 'My brushes' };

// ---------------------------------------------------------------------------------------------
// User brushes and book snapshots (set by the Studio when a book opens)

let userBrushes: BrushEntry[] = [];
let bookBrushes: Record<string, BrushSettings> = {};

export function setUserBrushes(list: BrushEntry[]): void {
  userBrushes = list;
}
export function getUserBrushes(): BrushEntry[] {
  return userBrushes;
}
export function setBookBrushes(map: Record<string, BrushSettings> | undefined): void {
  bookBrushes = map ?? {};
}

/** Every brush the picker shows. */
export function allBrushes(): BrushEntry[] {
  return [...LIBRARY, ...userBrushes];
}

export function entry(id: string): BrushEntry | null {
  const base = id.split('~')[0]!;
  return allBrushes().find((b) => b.id === base) ?? null;
}

export function knownBrush(id: string): boolean {
  return id in bookBrushes || !!entry(id);
}

/**
 * A fresh copy of the settings a stroke draws with: the book's snapshot when there is one, else
 * the library or user brush, else the pass default (an old or foreign page never fails).
 */
export function brushFor(id: string, pass: LinePass): BrushSettings {
  const snap = bookBrushes[id];
  if (snap) return cloneBrush(snap);
  const e = entry(id) ?? entry(DEFAULT_BRUSH[pass])!;
  return cloneBrush(e.settings);
}

/** The snapshot id for a brush's current settings: `<id>~<hash of settings>`. */
export function snapshotId(e: BrushEntry): string {
  return `${e.id}~${hashBytes(new TextEncoder().encode(JSON.stringify(e.settings)))}`;
}

/** Read stored user brushes back (anything unreadable is dropped). */
export function readUserBrushes(v: unknown): BrushEntry[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): BrushEntry[] => {
    const o = x as Partial<BrushEntry> | null;
    const settings = o ? readBrush(o.settings) : null;
    if (!o || !settings || typeof o.id !== 'string' || typeof o.name !== 'string') return [];
    const w = typeof o.w === 'number' && o.w > 0 && o.w < 1 ? o.w : 0.03;
    return [{ id: o.id, name: o.name.slice(0, 40), group: 'mine', pass: o.pass === 'pencil' ? 'pencil' : 'ink', w, note: typeof o.note === 'string' ? o.note.slice(0, 80) : 'My brush', settings }];
  });
}

export { readBrush };
