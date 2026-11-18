import { STAGES, type Stage } from '../doc/model';

/**
 * The gesture and shortcut registry: every binding the desk already detects, as data.
 * Nothing here adds behaviour. It names what exists so the Gesture Controls page, the KeyCaps in
 * menus and the help text all read from one table and cannot disagree.
 *
 * Specs are display strings. Keys use a chord such as `Mod+Shift+Z` (`Mod` is Ctrl on Windows and
 * Linux, Cmd on Mac; see `formatSpec`). Touch and pointer specs are plain words, such as
 * "Two-finger tap".
 */

export type Surface = Stage | 'global';
export type GestureInput = 'touch' | 'pointer' | 'key';

export interface GestureRow {
  id: string;
  surface: Surface;
  input: GestureInput;
  /** The default binding. */
  spec: string;
  /** What it does, by action id (see `ACTIONS`). */
  actionId: string;
  enabledByDefault: boolean;
  /** Touch and pointer rows can only be rebound to one of these. Key rows accept any valid chord. */
  options?: readonly string[];
}

export interface ActionDef {
  id: string;
  /** Completes "<gesture> will …". No capital, no full stop. */
  verb: string;
  label: string;
}

const action = (id: string, label: string, verb: string): [string, ActionDef] => [id, { id, label, verb }];

export const ACTIONS: ReadonlyMap<string, ActionDef> = new Map([
  action('edit.undo', 'Undo', 'undo the last change'),
  action('edit.redo', 'Redo', 'redo the change you undid'),
  action('edit.copy', 'Copy', 'copy the selection'),
  action('edit.paste', 'Paste', 'paste at the pointer'),
  action('view.pan', 'Pan', 'move the board'),
  action('view.zoomRotate', 'Zoom and rotate', 'zoom and turn the board'),
  action('view.zoom', 'Zoom', 'zoom the board'),
  action('view.rotate', 'Rotate', 'turn the board'),
  action('view.fit', 'Fit page', 'fit the page in view'),
  action('menu.canvas', 'Canvas menu', 'open the canvas menu'),
  action('tool.options', 'Tool options', 'open the tool’s options'),
  action('layout.toggle', 'Switch layout', 'switch between Studio and Focus'),
  action('cancel', 'Cancel', 'cancel what you are doing'),
  action('brush.bigger', 'Bigger brush', 'make the brush bigger'),
  action('brush.smaller', 'Smaller brush', 'make the brush smaller'),
  ...STAGES.map((s) => action(`desk.${s}`, `Go to ${s}`, `open the ${s} desk`)),
]);

const key = (id: string, spec: string, actionId: string, surface: Surface = 'global'): GestureRow =>
  ({ id, surface, input: 'key', spec, actionId, enabledByDefault: true });

export const GESTURES: readonly GestureRow[] = [
  // touch
  { id: 'touch.pan', surface: 'global', input: 'touch', spec: 'One-finger drag', actionId: 'view.pan', enabledByDefault: true },
  { id: 'touch.pinch', surface: 'global', input: 'touch', spec: 'Two-finger pinch', actionId: 'view.zoomRotate', enabledByDefault: true },
  { id: 'touch.undo', surface: 'global', input: 'touch', spec: 'Two-finger tap', actionId: 'edit.undo', enabledByDefault: true },
  { id: 'touch.redo', surface: 'global', input: 'touch', spec: 'Three-finger tap', actionId: 'edit.redo', enabledByDefault: true },
  { id: 'touch.menu', surface: 'global', input: 'touch', spec: 'Long press', actionId: 'menu.canvas', enabledByDefault: true },
  { id: 'touch.tooloptions', surface: 'global', input: 'touch', spec: 'Press and hold a tool', actionId: 'tool.options', enabledByDefault: true },
  // pointer
  { id: 'pointer.pan', surface: 'global', input: 'pointer', spec: 'Middle-button drag', actionId: 'view.pan', enabledByDefault: true },
  { id: 'pointer.spacepan', surface: 'global', input: 'pointer', spec: 'Space and drag', actionId: 'view.pan', enabledByDefault: true },
  { id: 'pointer.menu', surface: 'global', input: 'pointer', spec: 'Right-click', actionId: 'menu.canvas', enabledByDefault: true },
  { id: 'pointer.tooloptions', surface: 'global', input: 'pointer', spec: 'Right-click a tool', actionId: 'tool.options', enabledByDefault: true },
  { id: 'wheel.pan', surface: 'global', input: 'pointer', spec: 'Scroll', actionId: 'view.pan', enabledByDefault: true },
  { id: 'wheel.zoom', surface: 'global', input: 'pointer', spec: 'Ctrl+Scroll', actionId: 'view.zoom', enabledByDefault: true },
  { id: 'wheel.rotate', surface: 'global', input: 'pointer', spec: 'Alt+Scroll', actionId: 'view.rotate', enabledByDefault: true },
  // keyboard
  key('key.undo', 'Mod+Z', 'edit.undo'),
  key('key.redo', 'Mod+Shift+Z', 'edit.redo'),
  key('key.redo.alt', 'Mod+Y', 'edit.redo'),
  key('key.copy', 'Mod+C', 'edit.copy'),
  key('key.paste', 'Mod+V', 'edit.paste'),
  key('key.layout', 'Tab', 'layout.toggle'),
  key('key.fit', '0', 'view.fit'),
  key('key.cancel', 'Escape', 'cancel'),
  ...STAGES.map((s, i) => key(`key.desk.${s}`, String(i + 1), `desk.${s}`)),
  key('key.brush.bigger', ']', 'brush.bigger', 'draw'),
  key('key.brush.smaller', '[', 'brush.smaller', 'draw'),
];

const byId = new Map(GESTURES.map((g) => [g.id, g]));

export const gestureRow = (id: string): GestureRow | undefined => byId.get(id);

export const actionOf = (row: GestureRow): ActionDef | undefined => ACTIONS.get(row.actionId);

/** A key chord is modifiers then one key: `Mod+Shift+Z`, `Tab`, `]`. Case of letters is ignored. */
const MODS = ['Mod', 'Alt', 'Shift'] as const;
export function parseChord(spec: string): { mods: string[]; key: string } | null {
  const parts = spec.split('+');
  // the `+` key itself is written `Mod++`
  const keyPart = spec.endsWith('++') ? '+' : parts[parts.length - 1]!;
  const mods = spec.endsWith('++') ? parts.slice(0, -2) : parts.slice(0, -1);
  if (!keyPart || keyPart.length > 12 || /\s/.test(keyPart)) return null;
  if (mods.some((m) => !(MODS as readonly string[]).includes(m)) || new Set(mods).size !== mods.length) return null;
  if ((MODS as readonly string[]).includes(keyPart)) return null;
  const sorted = MODS.filter((m) => mods.includes(m));
  return { mods: sorted, key: keyPart.length === 1 ? keyPart.toUpperCase() : keyPart };
}

/** The same chord in one canonical spelling, or null when it is not a chord. */
export function canonicalChord(spec: string): string | null {
  const c = parseChord(spec);
  return c ? [...c.mods, c.key].join('+') : null;
}

/** What the person sees on a KeyCap: `Mod` becomes Ctrl or Cmd, `Escape` becomes Esc. */
export function formatSpec(spec: string, mac = false): string {
  const c = parseChord(spec);
  if (!c) return spec;
  const names: Record<string, string> = { Mod: mac ? 'Cmd' : 'Ctrl', Escape: 'Esc' };
  return [...c.mods, c.key].map((p) => names[p] ?? p).join('+');
}

/** "<gesture> will <action>." Built from the binding, so it cannot say anything the binding does not. */
export function sentence(spec: string, input: GestureInput, actionId: string, mac = false): string {
  const verb = ACTIONS.get(actionId)?.verb ?? 'do something';
  const name = input === 'key' ? formatSpec(spec, mac) : spec;
  return `${name} will ${verb}.`;
}
