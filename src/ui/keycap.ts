import { gesturePrefs } from '../app/gestureprefs';
import { formatSpec } from '../app/gestures';
import { h } from './dom';

/**
 * KeyCaps: the binding shown beside a menu label or in a tooltip. They are read from the gesture
 * registry at the moment a menu opens or a title is set, never typed by hand, so what a menu
 * shows is what the key does (including after a rebind). A key that is off shows nothing.
 */

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/**
 * The text for the first enabled key binding (`Ctrl+Z`), or undefined when none is on. Pass more
 * than one id when an action has alternates (redo has two keys): the first one still on is shown.
 */
export function keyText(...ids: string[]): string | undefined {
  for (const id of ids) {
    const b = gesturePrefs.get(id);
    if (b && b.enabled && b.input === 'key') return formatSpec(b.spec, isMac());
  }
  return undefined;
}

/** `<kbd>` for a menu row, or null when there is nothing to show. */
export function keyCap(...ids: string[]): HTMLElement | null {
  const text = keyText(...ids);
  return text ? h('kbd', {}, text) : null;
}

/** A tooltip: `Undo (Ctrl+Z)`, or just `Undo` when the key is off. */
export function titleWithKey(label: string, ...ids: string[]): string {
  const text = keyText(...ids);
  return text ? `${label} (${text})` : label;
}
