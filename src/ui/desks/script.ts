import type { Beat, Letter } from '../../doc/model';
import { syncLettersFromScript } from '../../geom/lettering';
import { newId } from '../../doc/model';
import { cutsForCount } from '../../geom/carve';
import type { DeskCtx, DeskMode } from '../desk';
import { h, toast } from '../dom';

/** Script: the page as a list of beats. Each beat becomes a panel; its lines become balloons. */
export function scriptDesk(ctx: DeskCtx): DeskMode {
  const { studio, page } = ctx;

  /**
   * Edit beats live while typing; one undo step per finished edit. Balloons linked to a line take
   * its new words in the same step (script ↔ lettering stay in sync).
   */
  let before: { beats: Beat[]; balloons: Letter[] } | null = null;
  const begin = () => {
    before ??= { beats: structuredClone(page.beats), balloons: structuredClone(page.balloons) };
  };
  const commit = (label: string) => {
    if (!before) return;
    const was = before;
    before = null;
    syncLettersFromScript(page);
    const now = { beats: structuredClone(page.beats), balloons: structuredClone(page.balloons) };
    if (JSON.stringify(was) === JSON.stringify(now)) return;
    studio.run({ label, do: () => Object.assign(page, structuredClone(now)), undo: () => Object.assign(page, structuredClone(was)) }, true);
  };
  const change = (label: string, fn: () => void) => {
    begin();
    fn();
    commit(label);
    mode.pane!(host);
    ctx.chrome();
  };

  let host: HTMLElement;
  const mode: DeskMode = {
    id: 'script',
    tools: [],
    tool: '',
    pane(el) {
      host = el;
      const list = h('div', { class: 'beats' });
      page.beats.forEach((b, i) => {
        const desc = h('input', { value: b.desc, placeholder: 'What we see: a wide shot of the rooftop at night…', 'aria-label': `Panel ${i + 1} description` });
        desc.addEventListener('focus', begin);
        desc.addEventListener('input', () => (b.desc = desc.value));
        desc.addEventListener('change', () => commit('Edit beat'));
        const lines = h('textarea', { placeholder: 'MAYA: We’re too late.\nCAPTION: Midnight.', 'aria-label': `Panel ${i + 1} dialogue, one line per balloon` });
        lines.value = b.lines.join('\n');
        lines.addEventListener('focus', begin);
        lines.addEventListener('input', () => (b.lines = lines.value.split('\n').map((l) => l.trim()).filter(Boolean)));
        lines.addEventListener('change', () => commit('Edit dialogue'));
        list.append(
          h('section', { class: 'beat', 'aria-label': `Panel ${i + 1}` },
            h('header', {},
              h('h4', {}, `Panel ${i + 1}`),
              h('button', { type: 'button', 'aria-label': `Move panel ${i + 1} up`, disabled: i === 0, onclick: () => change('Move beat', () => page.beats.splice(i - 1, 0, ...page.beats.splice(i, 1))) }, '↑'),
              h('button', { type: 'button', 'aria-label': `Move panel ${i + 1} down`, disabled: i === page.beats.length - 1, onclick: () => change('Move beat', () => page.beats.splice(i + 1, 0, ...page.beats.splice(i, 1))) }, '↓'),
              h('button', { type: 'button', 'aria-label': `Delete panel ${i + 1}`, onclick: () => change('Delete beat', () => page.beats.splice(i, 1)) }, '✕')),
            desc, lines));
      });
      list.append(
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn', type: 'button', onclick: () => change('Add beat', () => page.beats.push({ id: newId('bt'), desc: '', lines: [] })) }, '+ Add panel beat'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn primary', type: 'button', disabled: !page.beats.length, onclick: sendToLayout }, 'Send to Layout →')),
        h('p', { class: 'note' }, 'One line per balloon. Start a line with a name and a colon (“MAYA: …”) to name the speaker; “CAPTION:” makes a caption box. Caption pulls these lines into balloons, so nothing is typed twice.'),
      );
      el.replaceChildren(list);
    },
    ctx(bar) {
      bar.append(h('span', { class: 'hint' }, `${page.beats.length} beat${page.beats.length === 1 ? '' : 's'} · ${page.beats.reduce((n, b) => n + b.lines.length, 0)} lines`));
    },
    inspector(el) {
      const panels = ctx.panels().length;
      el.append(
        h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Script'), h('div', { class: 'ins-title' }, `Page ${studio.pageNumber(page)}`)),
        h('div', { class: 'sec' }, h('h4', {}, 'Page'),
          h('div', { class: 'rows' }, 'Beats', h('b', {}, String(page.beats.length))),
          h('div', { class: 'rows' }, 'Panels carved', h('b', {}, String(panels))),
          page.beats.length && panels !== page.beats.length
            ? h('p', { class: 'note' }, h('strong', {}, `${page.beats.length} beats, ${panels} panel${panels === 1 ? '' : 's'}. `), page.cuts.length ? 'Adjust the layout so each beat has a panel.' : 'Send to Layout carves one panel per beat.')
            : null),
      );
    },
  };

  function sendToLayout(): void {
    if (page.cuts.length) {
      toast(`This page is already carved (${ctx.panels().length} panels). Edit it in Layout.`);
      location.hash = `#desk/${ctx.book.id}/${page.id}/layout`;
      return;
    }
    studio.editPage(page, 'Beats to panels', ['cuts'], (p) => (p.cuts = cutsForCount(p, p.beats.length)));
    studio.markStage(page, 'script', 2);
    location.hash = `#desk/${ctx.book.id}/${page.id}/layout`;
  }

  return mode;
}
