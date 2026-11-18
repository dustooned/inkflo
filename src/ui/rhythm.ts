import { TRANSITIONS, type Page, type TransitionId } from '../doc/model';
import { turnIndex } from '../geom/craftnotes';
import { rhythmNote, rhythmOf } from '../geom/rhythm';
import { h } from './dom';

const colour = (hue: number) => `hsl(${hue} 55% 52%)`;

/**
 * The rhythm strip (craft-features #2 and #7): one segment per panel, coloured by the transition
 * into it, plus a chip picker for the selected panel. Everything is optional; unset panels show
 * as empty outlines, and nothing here grades the page.
 */
export function rhythmSection(
  page: Page,
  panelCount: number,
  selected: number | null,
  onSelect: (index: number) => void,
  onSet: (index: number, value: TransitionId | null) => void,
): HTMLElement {
  const r = rhythmOf(page.beats, panelCount);
  const turn = turnIndex(page.beats, panelCount);
  const hue = (id: TransitionId) => TRANSITIONS.find((t) => t.id === id)!.hue;
  const strip = h('div', { class: 'rhythm-strip', role: 'group', 'aria-label': 'Rhythm of this page' },
    r.segments.map((s) => {
      const t = s.transition ? TRANSITIONS.find((x) => x.id === s.transition)! : null;
      return h('button', {
        type: 'button',
        class: 'rhythm-seg',
        title: `Panel ${s.index + 1}: ${t ? t.label : 'transition not set'}`,
        'aria-label': `Panel ${s.index + 1}: ${t ? t.label : 'not set'}`,
        'aria-pressed': String(s.index === selected),
        style: `color:${t ? '#fff' : 'inherit'};background:${t ? colour(t.hue) : 'transparent'};border:${s.index === selected ? '2px solid currentColor' : '1px dashed currentColor'}`,
        onclick: () => onSelect(s.index),
      }, String(s.index + 1) + (s.index === turn ? '↷' : ''));
    }),
  );
  const note = rhythmNote(r);
  const chosen = selected !== null ? page.beats[selected]?.transition ?? null : null;
  const picker = selected === null
    ? h('p', { class: 'note flush' }, 'Select a panel to set how it follows the one before.')
    : h('div', { class: 'stack' },
      h('div', { class: 'note flush' }, `Panel ${selected + 1} follows the last one by…`),
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Transition into this panel' },
        TRANSITIONS.map((t) => h('button', {
          type: 'button',
          class: t.id === chosen ? 'btn chosen' : 'btn',
          role: 'radio',
          title: t.hint,
          'aria-checked': String(t.id === chosen),
          style: `border-left:6px solid ${colour(t.hue)}`,
          onclick: () => onSet(selected, t.id === chosen ? null : t.id),
        }, t.short))),
      chosen ? h('button', { class: 'btn', type: 'button', onclick: () => onSet(selected, null) }, 'Clear') : null);
  const legend = Object.keys(r.counts).length
    ? h('div', { class: 'note flush flex-wrap-8' },
      (Object.entries(r.counts) as [TransitionId, number][]).map(([id, n]) => h('span', {}, h('span', { 'aria-hidden': 'true', class: 'rhythm-dot', style: `background:${colour(hue(id))}` }), `${TRANSITIONS.find((t) => t.id === id)!.short} ${n}`)))
    : null;
  return h('div', { class: 'sec stack' }, h('h4', {}, 'Rhythm'), strip, legend, note ? h('p', { class: 'note flush' }, note) : null, picker);
}
