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
  const strip = h('div', { class: 'rhythm-strip', role: 'group', 'aria-label': 'Rhythm of this page', style: 'display:flex;gap:3px;height:26px' },
    r.segments.map((s) => {
      const t = s.transition ? TRANSITIONS.find((x) => x.id === s.transition)! : null;
      return h('button', {
        type: 'button',
        class: 'rhythm-seg',
        title: `Panel ${s.index + 1}: ${t ? t.label : 'transition not set'}`,
        'aria-label': `Panel ${s.index + 1}: ${t ? t.label : 'not set'}`,
        'aria-pressed': String(s.index === selected),
        style: `flex:1;min-width:10px;border-radius:4px;padding:0;cursor:pointer;font-size:var(--fs-xs);color:${t ? '#fff' : 'inherit'};background:${t ? colour(t.hue) : 'transparent'};border:${s.index === selected ? '2px solid currentColor' : '1px dashed currentColor'}`,
        onclick: () => onSelect(s.index),
      }, String(s.index + 1) + (s.index === turn ? '↷' : ''));
    }),
  );
  const note = rhythmNote(r);
  const chosen = selected !== null ? page.beats[selected]?.transition ?? null : null;
  const picker = selected === null
    ? h('p', { class: 'note', style: 'margin:0' }, 'Select a panel to set how it follows the one before.')
    : h('div', { class: 'stack' },
      h('div', { class: 'note', style: 'margin:0' }, `Panel ${selected + 1} follows the last one by…`),
      h('div', { class: 'chips', style: 'display:flex;flex-wrap:wrap;gap:4px', role: 'radiogroup', 'aria-label': 'Transition into this panel' },
        TRANSITIONS.map((t) => h('button', {
          type: 'button',
          class: 'btn',
          role: 'radio',
          title: t.hint,
          'aria-checked': String(t.id === chosen),
          style: `border-left:6px solid ${colour(t.hue)};${t.id === chosen ? 'font-weight:700;outline:2px solid currentColor' : ''}`,
          onclick: () => onSet(selected, t.id === chosen ? null : t.id),
        }, t.short))),
      chosen ? h('button', { class: 'btn', type: 'button', onclick: () => onSet(selected, null) }, 'Clear') : null);
  const legend = Object.keys(r.counts).length
    ? h('div', { class: 'note', style: 'margin:0;display:flex;flex-wrap:wrap;gap:8px' },
      (Object.entries(r.counts) as [TransitionId, number][]).map(([id, n]) => h('span', {}, h('span', { 'aria-hidden': 'true', style: `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${colour(hue(id))}` }), `${TRANSITIONS.find((t) => t.id === id)!.short} ${n}`)))
    : null;
  return h('div', { class: 'sec stack' }, h('h4', {}, 'Rhythm'), strip, legend, note ? h('p', { class: 'note', style: 'margin:0' }, note) : null, picker);
}
