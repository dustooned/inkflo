import type { Beat, Letter } from '../../doc/model';
import { dialogueText, linesFromDialogueText, reconcileDialogue, replaceDialogue } from '../../geom/lettering';
import { newId } from '../../doc/model';
import { cutsForCount } from '../../geom/carve';
import { downbeatPanel, revealIssues } from '../../geom/composition';
import { printOf, readerSpreads } from '../../geom/printkinds';
import type { DeskCtx, DeskMode } from '../desk';
import { h, toast } from '../dom';
import { openDialogue } from '../dialogue';
import { formatScriptCode, parseScriptCode, SCRIPT_LEGEND } from '../../geom/scriptcode';
import { seg } from '../dom';
import { jsonButtons } from '../codeeditor';
import { bookData, pageData } from '../../geom/pagedata';
/** Script: the page as a list of beats. Each beat becomes a panel; its lines become balloons. */
export function scriptDesk(ctx: DeskCtx): DeskMode {
  const { studio, book, page } = ctx;
  const vertical = printOf(book).kind === 'webtoon';
  function addPanel(at: number): void {
    const id = newId('bt');
    change('Add panel beat', () => page.beats.splice(at, 0, { id, desc: '', lines: [] }));
    ctx.stage.querySelector<HTMLTextAreaElement>('[data-beat-description="' + id + '"]')?.focus();
  }

  /**
   * Edit beats live while typing, with one undo step per finished edit. Caption reviews changes to linked wording.
   */
  let before: { beats: Beat[]; balloons: Letter[] } | null = null;
  const begin = () => {
    before ??= { beats: structuredClone(page.beats), balloons: structuredClone(page.balloons) };
  };
  const commit = (label: string) => {
    if (!before) return;
    const was = before;
    before = null;
    reconcileDialogue(book, page, ctx.panels());
    const now = { beats: structuredClone(page.beats), balloons: structuredClone(page.balloons) };
    if (JSON.stringify(was) === JSON.stringify(now)) return;
    studio.run({ label, do: () => Object.assign(page, structuredClone(now)), undo: () => Object.assign(page, structuredClone(was)) }, true);
  };
  const change = (label: string, fn: () => void) => {
    begin();
    fn();
    commit(label);
    ctx.chrome();
  };

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= page.beats.length || to >= page.beats.length) return;
    change('Move beat', () => page.beats.splice(to, 0, ...page.beats.splice(from, 1)));
  };
  const setupValue = (pageId: string, beatId: string) => JSON.stringify([pageId, beatId]);
  const pageIndex = book.pages.indexOf(page);
  function revealControl(b: Beat, index: number): HTMLElement {
    const picked = b.reveal ? setupValue(b.reveal.pageId, b.reveal.beatId) : '';
    const candidates = book.pages.slice(0, pageIndex + 1).flatMap((p, pi) =>
      p.beats.slice(0, p === page ? index : undefined).map((beat, i) => ({
        value: setupValue(p.id, beat.id),
        label: 'Page ' + (pi + 1) + ', beat ' + (i + 1) + (beat.desc ? ' · ' + beat.desc.slice(0, 46) : ''),
      })));
    const select = h('select', { 'aria-label': 'Setup for beat ' + (index + 1) },
      h('option', { value: '' }, 'Regular beat'),
      picked && !candidates.some((c) => c.value === picked) ? h('option', { value: picked, selected: true }, 'Setup missing or out of order') : null,
      candidates.map(({ value, label }) => h('option', { value, selected: value === picked }, label)));
    select.addEventListener('change', () => change('Set reveal setup', () => {
      if (!select.value) delete b.reveal;
      else {
        const [pageId, beatId] = JSON.parse(select.value) as [string, string];
        b.reveal = { pageId, beatId };
      }
    }));
    return h('label', { class: 'field' }, 'Reveal after', select);
  }

  function nextRevealPage(b: Beat): number | undefined {
    const print = printOf(book);
    if (print.binding === 'web') return;
    const spreads = readerSpreads(book.pages.length, print.rtl);
    const setup = book.pages.findIndex((p) => p.id === b.reveal?.pageId);
    const start = spreads.findIndex((p) => p.includes(Math.max(pageIndex, setup)));
    const side = print.rtl ? 0 : 1;
    return spreads.slice(start + 1).map((p) => p[side]).find((i) => i !== null) ?? undefined;
  }

  function moveReveal(beat: Beat, destination: number): void {
    const to = book.pages[destination];
    if (!to || page.cuts.length || to.cuts.length || page.balloons.length || to.balloons.length || page.groups.some((g) => g.layers.length) || to.groups.some((g) => g.layers.length)) return;
    const snapshots = new Map(book.pages.map((p) => [p, structuredClone(p.beats)]));
    const after = new Map([...snapshots].map(([p, beats]) => [p, structuredClone(beats)]));
    const [moving] = after.get(page)!.splice(page.beats.indexOf(beat), 1);
    after.get(to)!.push(moving!);
    for (const beats of after.values()) {
      for (const b of beats) {
        if (b.reveal?.pageId === page.id && b.reveal.beatId === beat.id) b.reveal.pageId = to.id;
      }
    }
    const apply = (pages: typeof snapshots) => { for (const [p, beats] of pages) p.beats = structuredClone(beats); };
    studio.run({ label: 'Move reveal to next spread', do: () => apply(after), undo: () => apply(snapshots) });
    location.hash = '#desk/' + book.id + '/' + to.id + '/script';
  }

  // ---- Code view: the page's script as text, parsed live into the beats
  let view: 'cards' | 'code' = (() => { try { return localStorage.getItem('inkflo:script-view') === 'code' ? 'code' : 'cards'; } catch { return 'cards'; } })();
  const setView = (v: 'cards' | 'code') => { view = v; try { localStorage.setItem('inkflo:script-view', v); } catch { /* private mode */ } ctx.chrome(); };
  const code = h('textarea', { class: 'script-code-input', spellcheck: false, 'aria-label': 'Script as code', autocapitalize: 'off', autocomplete: 'off' });
  const shade = h('pre', { class: 'script-code-shade', 'aria-hidden': 'true' });
  const problems = h('ul', { class: 'script-code-problems', 'aria-live': 'polite' });
  const live = h('ol', { class: 'script-code-live', 'aria-label': 'Panels as read so far' });
  const editor = h('div', { class: 'script-code-editor' }, shade, code);
  let applyTimer = 0;
  const sameBeats = (a: { desc: string; lines: string[] }[]) => a.length === page.beats.length && a.every((b, i) => b.desc === page.beats[i]!.desc && JSON.stringify(b.lines) === JSON.stringify(page.beats[i]!.lines));
  function paint(): void {
    const parsed = parseScriptCode(code.value);
    shade.replaceChildren(...parsed.lines.map((l, i) => h('div', { class: 'cl' + (l.error ? ' bad' : '') },
      h('span', { class: 'ln' }, String(i + 1)), ...l.tokens.map((t) => h('span', { class: 't-' + t.kind }, t.text)), '\n')));
    problems.replaceChildren(...parsed.errors.map((e) => h('li', {}, h('button', { type: 'button', onclick: () => jumpTo(e.line) }, 'Line ' + e.line), ' ', e.message)));
    live.replaceChildren(...parsed.beats.map((b, i) => h('li', {},
      h('b', {}, 'Panel ' + (i + 1)), h('span', {}, b.desc.split('\n')[0] || 'No description yet'),
      h('small', {}, b.lines.length + (b.lines.length === 1 ? ' balloon' : ' balloons')))));
    syncScroll();
  }
  function syncScroll(): void { shade.scrollTop = code.scrollTop; shade.scrollLeft = code.scrollLeft; }
  function jumpTo(line: number): void {
    const rows = code.value.split('\n');
    const at = rows.slice(0, line - 1).reduce((n, r) => n + r.length + 1, 0);
    code.focus();
    code.setSelectionRange(at, at + (rows[line - 1]?.length ?? 0));
  }
  /** Apply the text to the page now (live while typing; one undo step per editing session). */
  function applyCode(): void {
    clearTimeout(applyTimer);
    const parsed = parseScriptCode(code.value);
    if (sameBeats(parsed.beats)) return;
    begin();
    const kept = page.beats;
    page.beats = parsed.beats.map((pb, i) => kept[i] ?? { id: newId('bt'), desc: pb.desc, lines: [] });
    parsed.beats.forEach((pb, i) => { const b = page.beats[i]!; b.desc = pb.desc; replaceDialogue(page, b, pb.lines); });
  }
  let pauseTimer = 0;
  code.addEventListener('input', () => {
    paint();
    clearTimeout(applyTimer);
    clearTimeout(pauseTimer);
    applyTimer = window.setTimeout(applyCode, 250);
    // a pause in typing closes the undo step, so Undo works without leaving the editor
    pauseTimer = window.setTimeout(() => { applyCode(); commit('Edit script'); }, 1500);
  });
  code.addEventListener('scroll', syncScroll);
  code.addEventListener('blur', () => { clearTimeout(pauseTimer); applyCode(); commit('Edit script'); ctx.chrome(); });
  code.addEventListener('keydown', (e) => {
    // Tab indents instead of leaving the editor (Shift+Tab still moves focus away)
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); }
  });
  function codeView(el: HTMLElement): void {
    // keep the student's own text (comments, spacing) unless the page changed elsewhere
    if (document.activeElement !== code && !sameBeats(parseScriptCode(code.value).beats)) code.value = formatScriptCode(page.beats);
    if (!code.value) code.value = 'PANEL 1: ';
    paint();
    const legend = h('aside', { class: 'script-legend', 'aria-label': 'How to write script code' },
      h('h4', {}, 'Legend'),
      h('dl', {}, SCRIPT_LEGEND.flatMap((l) => [h('dt', {}, h('code', {}, l.code)), h('dd', {}, l.means)])),
      h('h4', {}, 'Live'), live,
      h('p', { class: 'note' }, 'Changes apply as you type. Each pause in typing is one undo step.'),
      jsonButtons(`${book.title} page ${book.pages.indexOf(page) + 1}`, () => pageData(book, page)),
      jsonButtons(book.title, () => bookData(book), 'Whole book (JSON)'));
    el.replaceChildren(h('div', { class: 'script-code' }, h('div', { class: 'script-code-main' }, editor, problems,
      h('div', { class: 'beat-actions' }, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', type: 'button', disabled: !page.beats.length, onclick: () => { applyCode(); commit('Edit script'); sendToLayout(); } }, 'Send to Layout →')))), legend));
  }

  const mode: DeskMode = {
    id: 'script',
    actions: [{ label: 'Dialogue & panels', glyph: '❝', run: () => openDialogue(ctx) }],
    tools: [],
    tool: '',
    pane(el) {
      if (view === 'code') { codeView(el); return; }
      const panels = ctx.panels();
      const downbeat = downbeatPanel(page, panels);
      const issues = new Map(revealIssues(book, page, panels).map(({ index, text }) => [index, text]));
      const list = h('div', { class: 'beats' });
      page.beats.forEach((b, i) => {
        const desc = h('textarea', { rows: 2, placeholder: 'What we see: a wide shot of the rooftop at night…', 'aria-label': `Panel ${i + 1} description`, 'data-beat-description': b.id });
        desc.value = b.desc;
        desc.addEventListener('focus', begin);
        desc.addEventListener('input', () => (b.desc = desc.value));
        desc.addEventListener('change', () => commit('Edit beat'));
        const lines = h('textarea', { placeholder: 'MAYA: We’re too late.\nCAPTION: Midnight.', 'aria-label': `Panel ${i + 1} dialogue, one line per balloon` });
        lines.value = dialogueText(b.lines);
        lines.addEventListener('focus', begin);
        lines.addEventListener('change', () => {
          begin();
          replaceDialogue(page, b, linesFromDialogueText(lines.value));
          commit('Edit dialogue');
        });
        const warning = issues.get(i);
        const destination = warning && b.reveal ? nextRevealPage(b) : undefined;
        const target = destination === undefined ? undefined : book.pages[destination];
        const canMove = target && [page, target].every((p) => !p.cuts.length && !p.balloons.length && !p.groups.some((g) => g.layers.length));
        const section = h('section', { class: 'beat', 'aria-label': `Panel ${i + 1}` },
            h('header', {},
              h('h4', {}, `Panel ${i + 1}` + (downbeat?.index === i ? ' · Downbeat' : '')),
              h('button', { type: 'button', 'aria-label': `Move panel ${i + 1} up`, disabled: i === 0, onclick: () => reorder(i, i - 1) }, '↑'),
              h('button', { type: 'button', 'aria-label': `Move panel ${i + 1} down`, disabled: i === page.beats.length - 1, onclick: () => reorder(i, i + 1) }, '↓'),
              h('button', { type: 'button', 'aria-label': `Delete panel ${i + 1}`, onclick: () => change('Delete beat', () => page.beats.splice(i, 1)) }, '✕')),
            h('label', { class: 'field' }, 'Scene description', desc),
            h('label', { class: 'field' }, 'Dialogue', lines),
            h('details', {}, h('summary', {}, 'Reveal settings'), revealControl(b, i)),
            warning ? h('p', { class: 'warnline', role: 'status' }, warning) : null,
            canMove && destination !== undefined ? h('button', { class: 'btn', type: 'button', onclick: () => moveReveal(b, destination) }, 'Move reveal to page ' + (destination + 1)) : null,
            target && !canMove ? h('a', { href: '#desk/' + book.id + '/' + target.id + '/script' }, 'Review page ' + (destination! + 1) + ' for this reveal') : null);
        list.append(section);
      });
      const actions = h('div', { class: 'beat-actions' },
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn', type: 'button', onclick: () => {
            addPanel(page.beats.length);
          } }, '+ Add panel beat'),
          vertical ? h('button', { class: 'btn', type: 'button', onclick: () => {
            const next = studio.addPage(page);
            location.hash = `#desk/${book.id}/${next.id}/script`;
          } }, '+ Scroll section') : null,
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn primary', type: 'button', disabled: !page.beats.length, onclick: sendToLayout }, 'Send to Layout →')),
        h('p', { class: 'note' }, 'One line per balloon. Start a line with a name and a colon (“MAYA: …”) to name the speaker; “CAPTION:” makes a caption box.'),
      );
      el.replaceChildren(list, actions);
    },
    ctx(bar) {
      bar.append(seg<'cards' | 'code'>([{ id: 'cards', label: 'Cards' }, { id: 'code', label: 'Code' }], view, (v) => { if (view === 'code') { applyCode(); commit('Edit script'); } setView(v); }, 'Script view'));
      bar.append(h('button', { class: 'btn document-option', type: 'button', onclick: () => openDialogue(ctx) }, 'Dialogue & panels'));
      const panels = ctx.panels().length;
      const mismatch = page.beats.length > 0 && panels !== page.beats.length;
      bar.append(h('span', { class: 'hint' + (mismatch ? ' warn' : ''), title: mismatch ? (page.cuts.length ? 'Adjust the layout so each beat has a panel.' : 'Send to Layout carves one panel per beat.') : '' },
        `${page.beats.length} beat${page.beats.length === 1 ? '' : 's'} · ${page.beats.reduce((n, b) => n + b.lines.length, 0)} lines · ${panels} panel${panels === 1 ? '' : 's'}${mismatch ? ' ⚠' : ''}`));
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
    studio.editPage(page, 'Beats to panels', ['cuts'], (p) => (p.cuts = cutsForCount(p, p.beats.length, vertical)));
    studio.markStage(page, 'script', 2);
    location.hash = `#desk/${ctx.book.id}/${page.id}/layout`;
  }

  return mode;
}
