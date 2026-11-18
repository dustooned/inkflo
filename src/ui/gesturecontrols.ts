import { gesturePrefs, type Binding } from '../app/gestureprefs';
import { ACTIONS, chordOf, formatSpec, type Surface } from '../app/gestures';
import { h } from './dom';
import { openModal } from './modal';

/**
 * Gesture Controls: one table of every gesture and shortcut, with a sentence for each that is
 * built from the live binding ("Two-finger tap will undo the last change."), so the page cannot
 * say something the binding no longer does. Rows the desk reads can be turned off, and key rows
 * can be rebound. The rest are listed as Fixed so they can still be learned.
 */

const GROUPS: { id: Surface; label: string }[] = [
  { id: 'global', label: 'Everywhere' },
  { id: 'script', label: 'Script' },
  { id: 'layout', label: 'Layout' },
  { id: 'draw', label: 'Draw' },
  { id: 'caption', label: 'Caption' },
  { id: 'print', label: 'Print' },
];

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export function openGestureControls(): void {
  const mac = isMac();
  const status = h('p', { class: 'note', role: 'status' });
  const body = h('div', { class: 'gesture-groups' });
  let capturing: string | null = null;

  /** "Two-finger tap will undo the last change" without the full stop. */
  const plain = (id: string) => gesturePrefs.describe(id, mac)!.replace(/\.$/, '');

  function row(b: Binding): HTMLElement {
    const listening = capturing === b.id;
    const spec = h('span', { class: 'gesture-spec' }, listening
      ? h('em', {}, 'Press the new keys… Esc cancels')
      : b.input === 'key' ? h('kbd', {}, formatSpec(b.spec, mac)) : b.spec);
    const sentence = h('span', { class: 'gesture-sentence' }, b.enabled ? `${plain(b.id)}.` : `${plain(b.id)} (off)`);
    if (!b.adjustable) return h('div', { class: 'gesture-row fixed', role: 'row' }, spec, sentence, h('span', { class: 'gesture-fixed' }, 'Fixed'));
    const on = h('input', { type: 'checkbox', checked: b.enabled, 'aria-label': `${plain(b.id)}: on` });
    on.addEventListener('change', () => { gesturePrefs.set(b.id, { enabled: on.checked }); status.textContent = ''; });
    const actions = h('span', { class: 'gesture-actions' });
    if (b.input === 'key') {
      actions.append(h('button', { class: 'btn', type: 'button', onclick: () => { capturing = listening ? null : b.id; status.textContent = ''; render(); } }, listening ? 'Cancel' : 'Change'));
    }
    if (b.rebound) {
      actions.append(h('button', { class: 'btn', type: 'button', 'aria-label': `Reset: ${plain(b.id)}`, onclick: () => { gesturePrefs.reset(b.id); status.textContent = ''; } }, 'Reset'));
    }
    return h('div', { class: 'gesture-row', role: 'row' }, spec, sentence, h('label', { class: 'gesture-on' }, on, 'On'), actions);
  }

  function render(): void {
    const all = gesturePrefs.all();
    body.replaceChildren(...GROUPS.flatMap((g) => {
      const rows = all.filter((b) => b.surface === g.id);
      if (!rows.length) return [];
      return [h('section', { class: 'gesture-group', role: 'table', 'aria-label': g.label }, h('h3', {}, g.label), rows.map(row))];
    }));
  }

  // While a row is listening, the next chord becomes its binding. Nothing else sees the keys.
  const onKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { capturing = null; render(); return; }
    const chord = chordOf(e);
    if (!chord) return;
    const id = capturing;
    const result = gesturePrefs.set(id, { spec: chord });
    if (result.ok) {
      capturing = null;
      status.textContent = `${plain(id)}.`;
    } else if (result.reason === 'conflict') {
      const verb = ACTIONS.get(gesturePrefs.get(result.with!)?.actionId ?? '')?.verb ?? 'do something else';
      status.textContent = `${formatSpec(chord, mac)} is taken, it will ${verb}. Turn that one off or pick other keys.`;
    } else {
      status.textContent = `${formatSpec(chord, mac)} can’t be used here. Try another key.`;
    }
    render();
  };

  const off = gesturePrefs.onChange(render);
  const modal = openModal<'done' | 'reset'>({
    title: 'Gestures & shortcuts', className: 'gesture-dialog', ariaLabel: 'Gestures and shortcuts', cancelId: 'done',
    detail: h('p', { class: 'note' }, 'What each gesture does. Turn one off if it gets in your way. Change a key if it clashes with another app.'),
    content: [status, body],
    actions: [
      { id: 'reset', label: 'Reset all', run: () => { gesturePrefs.reset(); capturing = null; status.textContent = 'Back to the defaults.'; return false; } },
      { id: 'done', label: 'Done', primary: true, spaceBefore: true },
    ],
    onClose: () => off(),
  });
  modal.dialog.addEventListener('keydown', onKey, true);
  // Escape while listening cancels the capture, not the dialog (some browsers fire `cancel` anyway)
  modal.dialog.addEventListener('cancel', (e) => {
    if (!capturing) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    capturing = null;
    render();
  }, true);
  render();
}
