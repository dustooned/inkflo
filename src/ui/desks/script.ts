import type { Beat, Letter } from '../../doc/model';
import { bindDialogue, dialogueText, formatDialogueLine, linesFromDialogueText, parseLine, reconcileDialogue, replaceDialogue } from '../../geom/lettering';
import { newId } from '../../doc/model';
import { cutsForCount, derivePanels, type Panel } from '../../geom/carve';
import { downbeatPanel, revealIssues } from '../../geom/composition';
import { printOf, readerSpreads } from '../../geom/printkinds';
import type { DeskCtx, DeskMode } from '../desk';
import { h, toast } from '../dom';
import { openDialogue } from '../dialogue';
import { cardCanvas, sketchCard } from '../notecard';
import { panelPath } from '../../render/page';

const TYPES = [['speech', 'Speech'], ['box', 'Caption'], ['thought', 'Thought'], ['whisper', 'Whisper'], ['shout', 'Shout'], ['sfx', 'Sound effect']] as const;

function storyboardThumb(panel: Panel | undefined, styles: string[]): HTMLCanvasElement {
  const c = h('canvas', { class: 'card-sketch', 'aria-label': 'Panel thumbnail', role: 'img' });
  c.width = 420;
  c.height = 206;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e8e2'; g.fillRect(0, 0, c.width, c.height);
  const { x0, x1, y0, y1 } = panel?.bbox ?? { x0: 0, y0: 0, x1: 2.1, y1: 1 };
  const s = Math.min(392 / (x1 - x0), 176 / (y1 - y0));
  const dx = (420 - (x1 - x0) * s) / 2, dy = (206 - (y1 - y0) * s) / 2;
  const points = panel?.pts.map((p) => ({ x: (p.x - x0) * s + dx, y: (p.y - y0) * s + dy }))
    ?? [{ x: dx, y: dy }, { x: 420 - dx, y: dy }, { x: 420 - dx, y: 206 - dy }, { x: dx, y: 206 - dy }];
  const frame = panelPath(points, 1);
  g.fillStyle = '#fffdf8'; g.fill(frame);
  g.strokeStyle = '#383d43'; g.lineWidth = 2; g.stroke(frame);
  g.save(); g.clip(frame);
  g.strokeStyle = '#b8bdb8'; g.lineWidth = 1; g.setLineDash([5, 5]);
  g.beginPath(); g.moveTo(210, dy + 10); g.lineTo(210, 196 - dy); g.moveTo(dx + 10, 103); g.lineTo(410 - dx, 103); g.stroke();
  g.setLineDash([]);
  styles.slice(0, 5).forEach((style, i) => {
    const x = 210 + ((i % 2 ? 1 : -1) * (420 - 2 * dx)) / 6, y = dy + (i + 1) * (206 - 2 * dy) / (Math.min(5, styles.length) + 1);
    g.fillStyle = '#fff'; g.strokeStyle = '#5f6966';
    g.beginPath();
    if (style === 'box' || style === 'sfx') g.roundRect(x - 23, y - 9, 46, 18, style === 'box' ? 2 : 7);
    else g.ellipse(x, y, 23, 10, 0, 0, Math.PI * 2);
    g.fill(); g.stroke();
  });
  g.restore();
  return c;
}

/** Script: the page as a list of beats. Each beat becomes a panel; its lines become balloons. */
export function scriptDesk(ctx: DeskCtx): DeskMode {
  const { studio, book, page } = ctx;
  const vertical = printOf(book).kind === 'webtoon';
  let cards = true;
  function addPanel(at: number): void {
    const id = newId('bt');
    change('Add panel beat', () => page.beats.splice(at, 0, { id, desc: '', lines: [] }));
    ctx.stage.querySelector<HTMLTextAreaElement>('[data-beat-description="' + id + '"]')?.focus();
  }

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
  const dragType = 'application/x-inkflo-beat';

  function dialogueCards(beat: Beat, panel: number): HTMLElement {
    const add = (at: number) => {
      change('Add dialogue', () => {
        const meta = bindDialogue(page, beat);
        beat.lines.splice(at, 0, '');
        meta.splice(at, 0, { id: newId('dl') });
      });
      ctx.stage.querySelector<HTMLTextAreaElement>(`[data-dialogue="${beat.id}-${at}"]`)?.focus();
    };
    return h('div', { class: 'story-dialogue' }, h('h5', {}, 'Dialogue'),
      beat.lines.map((raw, i) => {
        const parsed = parseLine(raw);
        const prefix = h('input', { value: parsed.speaker ?? '', placeholder: 'Speaker', 'aria-label': `Panel ${panel} speaker ${i + 1}` });
        const kind = h('select', { 'aria-label': `Panel ${panel} balloon type ${i + 1}` },
          TYPES.map(([id, name]) => h('option', { value: id, selected: id === parsed.style }, name)));
        const text = h('textarea', { rows: 2, 'aria-label': `Panel ${panel} dialogue ${i + 1}`, 'data-dialogue': `${beat.id}-${i}`, placeholder: 'Write dialogue…' });
        text.value = parsed.text;
        const save = () => {
          const style = TYPES.find(([id]) => id === kind.value)?.[0] ?? 'speech';
          const value = formatDialogueLine(prefix.value.trim(), style, text.value.trim());
          if (beat.lines[i] === value) return;
          begin(); beat.lines[i] = value; commit('Edit dialogue');
          const thumb = ctx.stage.querySelector<HTMLCanvasElement>(`[data-story-thumbnail="${beat.id}"] canvas`);
          if (thumb && !beat.card) {
            const panels = page.cuts.length ? ctx.panels() : derivePanels({ ...page, cuts: cutsForCount(page, page.beats.length, vertical) });
            thumb.replaceWith(storyboardThumb(panels[panel - 1], beat.lines.map((line) => parseLine(line).style)));
          }
        };
        prefix.addEventListener('change', save); kind.addEventListener('change', save); text.addEventListener('change', save);
        return h('div', { class: 'story-line' },
          h('div', { class: 'story-line-fields' }, kind, prefix,
            h('button', { type: 'button', title: 'Insert dialogue after this line', 'aria-label': `Add dialogue after line ${i + 1}`, onclick: () => add(i + 1) }, '+'),
            h('button', { type: 'button', 'aria-label': `Remove dialogue line ${i + 1}`, onclick: () => change('Remove dialogue', () => {
              const meta = bindDialogue(page, beat);
              beat.lines.splice(i, 1);
              meta.splice(i, 1);
            }) }, '×')), text);
      }),
      beat.lines.length ? null : h('button', { class: 'btn', type: 'button', onclick: () => add(0) }, '+ Dialogue'));
  }

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

  const mode: DeskMode = {
    id: 'script',
    tools: [],
    tool: '',
    pane(el) {
      const panels = ctx.panels();
      const planned = page.cuts.length ? panels : derivePanels({ ...page, cuts: cutsForCount(page, page.beats.length, vertical) });
      const downbeat = downbeatPanel(page, panels);
      const issues = new Map(revealIssues(book, page, panels).map(({ index, text }) => [index, text]));
      const list = h('div', { class: cards ? 'beats notecards' : 'beats' });
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
        const panel = panels[i];
        const actual = panel ? (panel.bbox.x1 - panel.bbox.x0) / (panel.bbox.y1 - panel.bbox.y0) : undefined;
        const warning = issues.get(i);
        const destination = warning && b.reveal ? nextRevealPage(b) : undefined;
        const target = destination === undefined ? undefined : book.pages[destination];
        const canMove = target && [page, target].every((p) => !p.cuts.length && !p.balloons.length && !p.groups.some((g) => g.layers.length));
        const section = h('section', { class: 'beat', 'aria-label': `Panel ${i + 1}` },
            h('header', {},
              h('h4', {}, `Panel ${i + 1}` + (downbeat?.index === i ? ' · Downbeat' : '')),
              cards ? h('span', { class: 'card-grip', draggable: 'true', title: 'Drag to a different panel slot', ondragstart: (event) => {
                const e = event as DragEvent;
                e.dataTransfer?.setData(dragType, b.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              } }, '⠿') : null,
              h('button', { type: 'button', 'aria-label': `Move panel ${i + 1} up`, disabled: i === 0, onclick: () => reorder(i, i - 1) }, '↑'),
              h('button', { type: 'button', 'aria-label': `Move panel ${i + 1} down`, disabled: i === page.beats.length - 1, onclick: () => reorder(i, i + 1) }, '↓'),
              h('button', { type: 'button', 'aria-label': `Delete panel ${i + 1}`, onclick: () => change('Delete beat', () => page.beats.splice(i, 1)) }, '✕')),
            cards ? h('div', { class: 'story-thumbnail', 'data-story-thumbnail': b.id },
              b.card ? cardCanvas(b.card) : storyboardThumb(planned[i], b.lines.map((line) => parseLine(line).style))) : null,
            cards ? h('button', { class: 'btn', type: 'button', onclick: () => sketchCard(b.card ?? { ratio: Math.max(0.25, Math.min(4, actual ?? 1.5)), strokes: [] },
              (card) => change('Edit notecard sketch', () => { b.card = card; })) }, b.card ? 'Edit sketch' : 'Sketch beat') : null,
            cards && b.card && actual && (b.card.ratio / actual > 1.35 || actual / b.card.ratio > 1.35)
              ? h('p', { class: 'note' }, 'This card’s shape differs from the panel slot.') : null,
            cards ? h('label', { class: 'field' }, 'Scene description', desc) : desc,
            cards ? dialogueCards(b, i + 1) : lines,
            cards ? h('button', { class: 'btn story-insert', type: 'button', onclick: () => addPanel(i + 1) }, '+ Panel after') : null,
            cards ? h('details', {}, h('summary', {}, 'Reveal settings'), revealControl(b, i)) : revealControl(b, i),
            warning ? h('p', { class: 'warnline', role: 'status' }, warning) : null,
            canMove && destination !== undefined ? h('button', { class: 'btn', type: 'button', onclick: () => moveReveal(b, destination) }, 'Move reveal to page ' + (destination + 1)) : null,
            target && !canMove ? h('a', { href: '#desk/' + book.id + '/' + target.id + '/script' }, 'Review page ' + (destination! + 1) + ' for this reveal') : null);
        if (cards) {
          section.addEventListener('dragover', (e) => {
            if (e.dataTransfer?.types.includes(dragType)) e.preventDefault();
          });
          section.addEventListener('drop', (e) => {
            const id = e.dataTransfer?.getData(dragType);
            if (!id) return;
            e.preventDefault();
            reorder(page.beats.findIndex((beat) => beat.id === id), i);
          });
        }
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
        cards ? null : h('p', { class: 'note' }, 'One line per balloon. Start a line with a name and a colon (“MAYA: …”) to name the speaker; “CAPTION:” makes a caption box.'),
      );
      el.replaceChildren(list, actions);
    },
    ctx(bar) {
      bar.append(h('button', { class: 'btn', type: 'button', 'aria-pressed': String(cards), onclick: () => { cards = !cards; ctx.chrome(); } }, cards ? 'Show beat list' : 'Show storyboard'));
      bar.append(h('button', { class: 'btn', type: 'button', onclick: () => openDialogue(ctx) }, 'Dialogue & panels'));
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
    studio.editPage(page, 'Beats to panels', ['cuts'], (p) => (p.cuts = cutsForCount(p, p.beats.length, vertical)));
    studio.markStage(page, 'script', 2);
    location.hash = `#desk/${ctx.book.id}/${page.id}/layout`;
  }

  return mode;
}
