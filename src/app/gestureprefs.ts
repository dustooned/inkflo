import { GESTURES, canonicalChord, chordMatches, gestureRow, sentence, type GestureRow, type Surface } from './gestures';

/**
 * Device preferences for gestures: which are on and which chord a key row uses. Like the other
 * prefs it lives in localStorage, never in a book, never on the undo stack. Anything that does not
 * validate is dropped on read, so a stale or hand-edited value can never bind an unknown gesture.
 */

export const GESTURE_PREFS_KEY = 'inkflo.gestures.v1';

export interface StoredBinding { spec?: string; enabled?: boolean }
type Overrides = Record<string, StoredBinding>;

export interface Binding extends GestureRow {
  /** True when the person changed the spec. */
  rebound: boolean;
  enabled: boolean;
}

export type SetResult = { ok: true } | { ok: false; reason: 'unknown' | 'fixed' | 'invalid' | 'conflict'; with?: string };

export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const overlaps = (a: Surface, b: Surface) => a === b || a === 'global' || b === 'global';

/** A valid spec for this row: a chord for keys, one of the listed options otherwise. */
function validSpec(row: GestureRow, spec: unknown): string | null {
  if (typeof spec !== 'string') return null;
  if (row.input === 'key') return canonicalChord(spec);
  return row.options?.includes(spec) ? spec : null;
}

/** The id of an enabled key row on an overlapping surface that already uses this chord. */
function conflictFor(row: GestureRow, chord: string, specs: ReadonlyMap<string, { spec: string; enabled: boolean }>): string | undefined {
  if (row.input !== 'key') return undefined;
  for (const other of GESTURES) {
    if (other.id === row.id || other.input !== 'key' || !overlaps(row.surface, other.surface)) continue;
    const o = specs.get(other.id)!;
    if (o.enabled && canonicalChord(o.spec) === chord) return other.id;
  }
  return undefined;
}

/** Overrides from a stored string: unknown ids, bad values, duplicate chords and no-op overrides are dropped. */
export function parseOverrides(raw: string | null): Overrides {
  if (!raw) return {};
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return {};
  const stored = (data as { bindings?: unknown }).bindings;
  if (!stored || typeof stored !== 'object') return {};
  const out: Overrides = {};
  const live = new Map(GESTURES.map((g) => [g.id, { spec: g.spec, enabled: g.enabledByDefault }]));
  for (const row of GESTURES) {
    if (!row.adjustable) continue;
    const v = (stored as Record<string, unknown>)[row.id];
    if (!v || typeof v !== 'object') continue;
    const item: StoredBinding = {};
    const spec = validSpec(row, (v as StoredBinding).spec);
    if (spec && spec !== (row.input === 'key' ? canonicalChord(row.spec) : row.spec)) item.spec = spec;
    const enabled = (v as StoredBinding).enabled;
    if (typeof enabled === 'boolean' && enabled !== row.enabledByDefault) item.enabled = enabled;
    if (item.spec !== undefined && conflictFor(row, canonicalChord(item.spec) ?? item.spec, live)) delete item.spec;
    if (item.spec === undefined && item.enabled === undefined) continue;
    out[row.id] = item;
    live.set(row.id, { spec: item.spec ?? row.spec, enabled: item.enabled ?? row.enabledByDefault });
  }
  return out;
}

export function createGesturePrefs(storeOf: () => StoreLike | undefined = () => (typeof localStorage === 'undefined' ? undefined : localStorage)) {
  const load = (): Overrides => {
    try { return parseOverrides(storeOf()?.getItem(GESTURE_PREFS_KEY) ?? null); } catch { return {}; }
  };
  let overrides = load();
  const listeners = new Set<() => void>();

  const specs = () => new Map(GESTURES.map((g) => [g.id, { spec: overrides[g.id]?.spec ?? g.spec, enabled: overrides[g.id]?.enabled ?? g.enabledByDefault }]));

  function save(): void {
    try { storeOf()?.setItem(GESTURE_PREFS_KEY, JSON.stringify({ v: 1, bindings: overrides })); } catch { /* not saved: still applies this session */ }
    for (const fn of listeners) fn();
  }

  function get(id: string): Binding | undefined {
    const row = gestureRow(id);
    if (!row) return undefined;
    const o = overrides[id];
    return { ...row, spec: o?.spec ?? row.spec, enabled: o?.enabled ?? row.enabledByDefault, rebound: o?.spec !== undefined };
  }

  return {
    get,
    all: (): Binding[] => GESTURES.map((g) => get(g.id)!),
    /** The bindings that are on, for one surface (global ones included). */
    forSurface: (surface: Surface): Binding[] => GESTURES.filter((g) => overlaps(g.surface, surface)).map((g) => get(g.id)!).filter((b) => b.enabled),
    set(id: string, patch: StoredBinding): SetResult {
      const row = gestureRow(id);
      if (!row) return { ok: false, reason: 'unknown' };
      if (!row.adjustable) return { ok: false, reason: 'fixed' };
      const next: StoredBinding = { ...overrides[id] };
      if (patch.spec !== undefined) {
        const spec = validSpec(row, patch.spec);
        if (!spec) return { ok: false, reason: 'invalid' };
        const clash = conflictFor(row, spec, specs());
        if (clash) return { ok: false, reason: 'conflict', with: clash };
        if (spec === (row.input === 'key' ? canonicalChord(row.spec) : row.spec)) delete next.spec;
        else next.spec = spec;
      }
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') return { ok: false, reason: 'invalid' };
        if (patch.enabled === row.enabledByDefault) delete next.enabled;
        else next.enabled = patch.enabled;
      }
      if (next.spec === undefined && next.enabled === undefined) delete overrides[id];
      else overrides[id] = next;
      save();
      return { ok: true };
    },
    /** Back to the default for one gesture, or all of them. */
    reset(id?: string): void {
      if (id === undefined) overrides = {};
      else delete overrides[id];
      save();
    },
    /** Is this key row on, and is this the chord that was pressed? The desk asks this instead of testing keys itself. */
    matches(id: string, e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
      const b = get(id);
      return !!b && b.enabled && b.input === 'key' && chordMatches(b.spec, e);
    },
    /** "<gesture> will <action>." from the live binding. */
    describe(id: string, mac = false): string | undefined {
      const b = get(id);
      return b && sentence(b.spec, b.input, b.actionId, mac);
    },
    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const gesturePrefs = createGesturePrefs();
