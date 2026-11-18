import { describe, expect, it } from 'vitest';
import { ACTIONS, GESTURES, actionOf, canonicalChord, chordMatches, chordOf, formatSpec, sentence } from './gestures';
import { GESTURE_PREFS_KEY, createGesturePrefs, parseOverrides, type StoreLike } from './gestureprefs';

const memoryStore = (initial?: string): StoreLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(GESTURE_PREFS_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const prefsOn = (store: StoreLike) => createGesturePrefs(() => store);

describe('registry', () => {
  it('has unique ids and every row points at a known action', () => {
    expect(new Set(GESTURES.map((g) => g.id)).size).toBe(GESTURES.length);
    for (const g of GESTURES) expect(actionOf(g), g.id).toBeDefined();
  });

  it('has valid default chords and no two default key rows sharing a chord on one surface', () => {
    const seen = new Map<string, string>();
    for (const g of GESTURES.filter((x) => x.input === 'key')) {
      const chord = canonicalChord(g.spec);
      expect(chord, g.id).not.toBeNull();
      const where = `${g.surface === 'global' ? '*' : g.surface}:${chord}`;
      expect(seen.get(where), `${g.id} clashes with ${seen.get(where)}`).toBeUndefined();
      seen.set(where, g.id);
    }
  });

  it('covers the five desks, undo, redo, tab, fit and cancel', () => {
    const ids = GESTURES.map((g) => g.id);
    for (const id of ['key.desk.script', 'key.desk.print', 'key.undo', 'key.redo', 'key.layout', 'key.fit', 'key.cancel', 'touch.undo', 'wheel.rotate']) expect(ids).toContain(id);
    for (const a of ['desk.script', 'desk.layout', 'desk.draw', 'desk.caption', 'desk.print']) expect(ACTIONS.has(a)).toBe(true);
  });
});

describe('chords', () => {
  it('canonicalises order and case', () => {
    expect(canonicalChord('shift+Mod+z')).toBeNull(); // modifier names are exact
    expect(canonicalChord('Shift+Mod+z')).toBe('Mod+Shift+Z');
    expect(canonicalChord('Mod+Shift+Z')).toBe('Mod+Shift+Z');
    expect(canonicalChord('Escape')).toBe('Escape');
    expect(canonicalChord(']')).toBe(']');
  });
  it('rejects things that are not chords', () => {
    for (const bad of ['', 'Mod+', 'Mod+Mod+Z', 'Mod+Shift', 'Ctrl+Z', 'two words', '+++']) expect(canonicalChord(bad), bad).toBeNull();
  });
  it('shows Ctrl or Cmd for Mod and Esc for Escape', () => {
    expect(formatSpec('Mod+Shift+Z')).toBe('Ctrl+Shift+Z');
    expect(formatSpec('Mod+Shift+Z', true)).toBe('Cmd+Shift+Z');
    expect(formatSpec('Escape')).toBe('Esc');
  });
});

describe('matching key events', () => {
  const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it('treats Mod as Ctrl or Cmd and needs the other modifiers exactly', () => {
    expect(chordMatches('Mod+Z', ev('z', { ctrlKey: true }))).toBe(true);
    expect(chordMatches('Mod+Z', ev('z', { metaKey: true }))).toBe(true);
    expect(chordMatches('Mod+Z', ev('Z', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(chordMatches('Mod+Shift+Z', ev('Z', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(chordMatches('Tab', ev('Tab'))).toBe(true);
    expect(chordMatches('Tab', ev('Tab', { altKey: true }))).toBe(false);
    expect(chordMatches('0', ev('0'))).toBe(true);
    expect(chordMatches('Space', ev(' '))).toBe(true);
    expect(chordMatches('nonsense chord', ev('x'))).toBe(false);
  });
  it('builds a chord from a key event, and ignores a bare modifier', () => {
    expect(chordOf(ev('z', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+Z');
    expect(chordOf(ev('Tab', { altKey: true }))).toBe('Alt+Tab');
    expect(chordOf(ev(' '))).toBe('Space');
    expect(chordOf(ev('Shift', { shiftKey: true }))).toBeNull();
    expect(chordOf(ev('Control', { ctrlKey: true }))).toBeNull();
  });
  it('the live binding decides what a key does', () => {
    const p = prefsOn(memoryStore());
    expect(p.matches('key.fit', ev('0'))).toBe(true);
    p.set('key.fit', { spec: 'Shift+9' });
    expect(p.matches('key.fit', ev('0'))).toBe(false);
    expect(p.matches('key.fit', ev('9', { shiftKey: true }))).toBe(true);
    p.set('key.fit', { enabled: false });
    expect(p.matches('key.fit', ev('9', { shiftKey: true }))).toBe(false);
    expect(p.matches('touch.undo', ev('x'))).toBe(false);
  });
});

describe('fixed rows', () => {
  it('lists gestures the desk does not read as fixed, and refuses to change them', () => {
    const fixed = GESTURES.filter((g) => !g.adjustable).map((g) => g.id);
    expect(fixed).toEqual(expect.arrayContaining(['key.copy', 'key.paste', 'key.cancel', 'touch.pinch', 'wheel.zoom', 'pointer.menu']));
    const p = prefsOn(memoryStore());
    expect(p.set('key.copy', { spec: 'Mod+K' })).toEqual({ ok: false, reason: 'fixed' });
    expect(p.set('touch.pinch', { enabled: false })).toEqual({ ok: false, reason: 'fixed' });
    expect(p.get('touch.pinch')?.enabled).toBe(true);
  });
  it('ignores stored overrides for fixed rows', () => {
    expect(parseOverrides(JSON.stringify({ v: 1, bindings: { 'key.copy': { spec: 'Mod+K' }, 'touch.pinch': { enabled: false } } }))).toEqual({});
  });
});

describe('generated sentences', () => {
  it('reads "<gesture> will <action>."', () => {
    expect(sentence('Two-finger tap', 'touch', 'edit.undo')).toBe('Two-finger tap will undo the last change.');
    expect(sentence('Mod+Z', 'key', 'edit.undo', true)).toBe('Cmd+Z will undo the last change.');
  });
  it('has a sentence for every default row', () => {
    for (const g of GESTURES) expect(sentence(g.spec, g.input, g.actionId), g.id).toMatch(/ will .+\.$/);
  });
});

describe('gesture prefs', () => {
  it('starts from the registry defaults', () => {
    const p = prefsOn(memoryStore());
    expect(p.get('key.undo')).toMatchObject({ spec: 'Mod+Z', enabled: true, rebound: false });
    expect(p.all()).toHaveLength(GESTURES.length);
  });

  it('rejects an unknown gesture id', () => {
    const store = memoryStore();
    const p = prefsOn(store);
    expect(p.set('key.teleport', { enabled: false })).toEqual({ ok: false, reason: 'unknown' });
    expect(p.get('key.teleport')).toBeUndefined();
    expect(store.data.size).toBe(0);
  });

  it('drops unknown ids and bad values when reading', () => {
    const raw = JSON.stringify({ v: 1, bindings: {
      'key.teleport': { enabled: false },
      'key.undo': { spec: 'Ctrl+Nope', enabled: 'yes' },
      'key.fit': { spec: '9' },
      'touch.undo': { spec: 'Seven-finger tap' },
    } });
    expect(parseOverrides(raw)).toEqual({ 'key.fit': { spec: '9' } });
    expect(parseOverrides('not json')).toEqual({});
    expect(parseOverrides(JSON.stringify({ v: 2, bindings: { 'key.fit': { spec: '9' } } }))).toEqual({});
    expect(parseOverrides(null)).toEqual({});
  });

  it('rebinding a key changes the generated sentence', () => {
    const p = prefsOn(memoryStore());
    expect(p.describe('key.fit')).toBe('0 will fit the page in view.');
    expect(p.set('key.fit', { spec: 'Shift+9' })).toEqual({ ok: true });
    expect(p.describe('key.fit')).toBe('Shift+9 will fit the page in view.');
    expect(p.get('key.fit')?.rebound).toBe(true);
    p.reset('key.fit');
    expect(p.describe('key.fit')).toBe('0 will fit the page in view.');
  });

  it('refuses a chord another enabled key already uses, until that one is turned off', () => {
    const p = prefsOn(memoryStore());
    expect(p.set('key.fit', { spec: 'mod+Z' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(p.set('key.fit', { spec: 'Mod+Z' })).toEqual({ ok: false, reason: 'conflict', with: 'key.undo' });
    expect(p.set('key.undo', { enabled: false })).toEqual({ ok: true });
    expect(p.set('key.fit', { spec: 'Mod+Z' })).toEqual({ ok: true });
  });

  it('lets a draw-only key reuse a chord from another desk but not a global one', () => {
    const p = prefsOn(memoryStore());
    expect(p.set('key.brush.bigger', { spec: '3' })).toMatchObject({ ok: false, reason: 'conflict', with: 'key.desk.draw' });
    expect(p.set('key.brush.bigger', { spec: 'Alt+B' })).toEqual({ ok: true });
  });

  it('only rebinds touch rows to listed options, and can switch them off', () => {
    const p = prefsOn(memoryStore());
    expect(p.set('touch.undo', { spec: 'Two-finger double tap' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(p.set('touch.undo', { enabled: false })).toEqual({ ok: true });
    expect(p.forSurface('draw').some((b) => b.id === 'touch.undo')).toBe(false);
    expect(p.forSurface('draw').some((b) => b.id === 'key.brush.bigger')).toBe(true);
    expect(p.forSurface('layout').some((b) => b.id === 'key.brush.bigger')).toBe(false);
  });

  it('saves only what differs from the defaults, and a fresh instance reads it back', () => {
    const store = memoryStore();
    const p = prefsOn(store);
    p.set('key.fit', { spec: 'Shift+9' });
    p.set('touch.redo', { enabled: false });
    p.set('key.copy', { enabled: true }); // same as default: nothing stored
    expect(JSON.parse(store.data.get(GESTURE_PREFS_KEY)!)).toEqual({ v: 1, bindings: { 'key.fit': { spec: 'Shift+9' }, 'touch.redo': { enabled: false } } });
    const again = prefsOn(store);
    expect(again.get('key.fit')?.spec).toBe('Shift+9');
    expect(again.get('touch.redo')?.enabled).toBe(false);
    p.reset();
    expect(JSON.parse(store.data.get(GESTURE_PREFS_KEY)!)).toEqual({ v: 1, bindings: {} });
  });

  it('works without storage and when storage throws', () => {
    const none = createGesturePrefs(() => undefined);
    expect(none.set('key.fit', { spec: 'Shift+9' })).toEqual({ ok: true });
    expect(none.get('key.fit')?.spec).toBe('Shift+9');
    const broken: StoreLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const p = createGesturePrefs(() => broken);
    expect(p.get('key.undo')?.spec).toBe('Mod+Z');
    expect(p.set('key.fit', { spec: 'Shift+9' })).toEqual({ ok: true });
  });

  it('tells listeners when something changed', () => {
    const p = prefsOn(memoryStore());
    let n = 0;
    const off = p.onChange(() => n++);
    p.set('key.fit', { spec: 'Shift+9' });
    off();
    p.reset();
    expect(n).toBe(1);
  });
});
