import { INTENT_KEYS, MAX_INTENT_CHARS, type IntentKey, type Page } from '../doc/model';
import { intentDots, turnIndex, turnNotes } from '../geom/craftnotes';
import { h } from './dom';

/**
 * Panel intent (five optional one-line prompts) and the page-turn marker, for the selected panel
 * (craft-features #1 and #9). Every field may stay empty; nothing here blocks export.
 */
export function panelCraftSection(
  page: Page,
  panelCount: number,
  index: number,
  onIntent: (key: IntentKey, text: string) => void,
  onTurn: (on: boolean) => void,
): HTMLElement {
  const beat = page.beats[index];
  const dots = intentDots(beat);
  const dotRow = h('span', { 'aria-label': `${dots.filter(Boolean).length} of 5 prompts answered`, class: 'dots-run' }, dots.map((on) => (on ? '●' : '○')).join(''));
  const fields = INTENT_KEYS.map(({ id, label, ask }) => {
    const input = h('input', { type: 'text', maxlength: MAX_INTENT_CHARS, value: beat?.intent?.[id] ?? '', placeholder: ask, 'aria-label': `${label}: ${ask}`, 'data-intent': id });
    input.addEventListener('change', () => onIntent(id, input.value.trim()));
    return h('label', { class: 'field' }, label, input);
  });
  const turn = turnIndex(page.beats, panelCount);
  const isTurn = turn === index;
  const notes = turnNotes(page.beats, panelCount);
  return h('div', { class: 'sec stack' },
    h('h4', {}, `Panel ${index + 1} intent`, dotRow),
    h('p', { class: 'note flush' }, 'Five quick prompts, all optional. Skip any you like.'),
    ...fields,
    h('button', { class: 'btn', type: 'button', 'aria-pressed': String(isTurn), onclick: () => onTurn(!isTurn) }, isTurn ? 'Clear page turn' : turn !== null ? `Move page turn here (now panel ${turn + 1})` : 'Mark as page turn'),
    ...notes.map((n) => h('p', { class: 'note flush' }, n)));
}
