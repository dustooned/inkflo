import { newId, PT, sheetOf, type Letter, type Pt } from '../../doc/model';
import { BUNDLED_FONTS } from '../../engine/lettering/fonts';
import { readBalloon, shapeForText } from '../../engine/lettering/geometry';
import { resample } from '../../engine/core/quickshape';
import { applyStyle, captureStyle } from '../../engine/lettering/styles';
import { LETTER_SIZES, TAIL_JOINS, type BalloonStyle, type CaptionSpec, type LetterSize, type TailJoin } from '../../engine/lettering/spec';
import { panelAt } from '../../geom/carve';
import { balloonGroup, balloonPaintOrder, captionGroups, firstBalloon } from '../../geom/captiongroup';
import { applyScriptWording, assignDialoguePanel, assignDialoguePreset, centreIn, characterStyle, clampLetter, dialoguePanel, letterForLine, newLetter, nextPanelLine, omitDialogue, parseLine, readingOrderIssues, reconcileDialogue, scriptRevision, sourceIndex, speakers, syncScriptFromLetter, withCharacterStyle } from '../../geom/lettering';
import { applyFix, letterPt, readabilityAll, safeFixes, snapScale, targetsFor, type FixId, type Level } from '../../geom/readability';
import { hitLetter, letterBodyBox, letterBodyOutline } from '../../render/caption';
import { boxHandles, resizeBox, rotateAround, type Bounds, type ResizeSide } from '../../geom/resizebox';
import { variantOf, type DeskCtx, type DeskMode } from '../desk';
import { askText, h, seg, toast } from '../dom';
import { openDialogue } from '../dialogue';
import { closePopover, popover } from '../popover';
import { openStyleSheet } from '../stylesheet';

type Grab = { kind: 'body' } | { kind: 'rotate'; angle: number } | { kind: 'tail'; index: number } | { kind: 'size'; side: ResizeSide; box: Bounds; minimum: Pt };

const KINDS: { id: BalloonStyle; label: string; glyph: string; key: string }[] = [
  { id: 'speech', label: 'Speech balloon', glyph: '💬', key: 'b' },
  { id: 'thought', label: 'Thought', glyph: '💭', key: 't' },
  { id: 'shout', label: 'Shout', glyph: '💥', key: 'h' },
  { id: 'whisper', label: 'Whisper', glyph: '⋯', key: 'w' },
  { id: 'box', label: 'Caption box', glyph: '▭', key: 'c' },
  { id: 'sfx', label: 'Sound effect', glyph: '✸', key: 's' },
];
const KIND_LABEL: Record<string, string> = { speech: 'Speech', thought: 'Thought', shout: 'Shout', whisper: 'Whisper', box: 'Caption box', sfx: 'Sound effect', custom: 'Drawn shape' };
const JOIN_LABEL: Record<TailJoin, string> = { merged: 'Merged', seam: 'Pointed', bubbles: 'Bubbles', lightning: 'Lightning', none: 'None' };
const FIX_LABEL: Record<FixId, string> = { enlarge: 'Enlarge', thicken: 'Thicken border', backing: 'Add outline', heavier: 'Make bold', contrast: 'Fix contrast' };
const LEVEL_COLOR: Record<Level, string> = { good: '#3E6B3A', risk: '#C98A1B', bad: '#B8432F' };
const LEVEL_TEXT: Record<Level, string> = { good: 'Reads well', risk: 'At risk', bad: 'Won’t read well' };

/** Session settings for the desk. */
const state = { keepReadable: true, fromCenter: true, keepDrawnOutline: false };

/**
 * Caption: click inside a panel to letter its next line, or use Draw balloon for a custom outline.
 * Words stay linked to the script both ways.
 * Positions are points (1/72 in) on the page.
 */
export function captionDesk(ctx: DeskCtx): DeskMode {
  const { studio, page, book } = ctx;
  const sheet = () => sheetOf(book);
  const prior = JSON.stringify([page.beats, page.balloons]);
  reconcileDialogue(book, page, ctx.panels());
  if (JSON.stringify([page.beats, page.balloons]) !== prior) studio.saver.markDirty();
  let selId: string | null = null;
  let moveGroup = false;
  let reviewOpen = false;
  let addAt: Pt | null = null;
  let drag: { id: string; grab: Grab; start: Pt; orig: CaptionSpec; before: Letter[]; beforeBeats: string; moved: boolean } | null = null;
  let loop: Pt[] | null = null;
  let downAt: Pt | null = null;

  const W = page.widthIn;
  const H = page.heightIn;
  const toPt = (p: Pt): Pt => ({ x: p.x * PT, y: p.y * PT });
  const sel = () => page.balloons.find((b) => b.id === selId) ?? null;
  const outline = (l: Letter) => letterBodyOutline(l, sheet(), W, H);
  const box = (l: Letter) => letterBodyBox(l, sheet(), W, H);
  const localBox = (l: Letter) => box({ ...l, rotation: undefined });
  const frame = (b: Bounds, k: number): Bounds => ({ x0: b.x0 - 5 / k, y0: b.y0 - 5 / k, x1: b.x1 + 5 / k, y1: b.y1 + 5 / k });
  const rotationAt = (b: Bounds, pixelsPerPoint: number): Pt => ({ x: (b.x0 + b.x1) / 2, y: b.y0 - 23 / pixelsPerPoint });
  const onPage = (p: Pt, l: Letter): Pt => rotateAround(p, l.cap, l.rotation ?? 0);
  const rootOf = (l: Letter) => firstBalloon(page.balloons, l);
  const groupOf = (l: Letter) => balloonGroup(page.balloons, rootOf(l));
  const plusAt = (l: Letter, k: number): Pt => {
    const b = box(l);
    const margin = 18 / k;
    const right = b.x1 + margin;
    const x = right <= W * PT - margin / 2 ? right : b.x0 - margin;
    return { x: Math.max(margin / 2, Math.min(W * PT - margin / 2, x)), y: Math.max(margin, Math.min(H * PT - margin, (b.y0 + b.y1) / 2)) };
  };

  /** One undo step over lettering and (linked) script lines. */
  const commit = (label: string, beforeLetters: Letter[], beforeBeats: string) => {
    const previous = new Map(beforeLetters.map((l) => [l.id, l]));
    const before = { ...page, balloons: beforeLetters };
    for (const l of page.balloons) {
      const original = previous.get(l.id);
      if (l.generated && original && (l.rotation !== original.rotation || JSON.stringify(l.cap) !== JSON.stringify(original.cap))) delete l.generated;
      if (!l.src || l.keptScriptLine !== undefined) continue;
      if (original && original.src?.beat === l.src.beat && (original.src.lineId ?? original.src.line) === (l.src.lineId ?? l.src.line) && scriptRevision(before, original)) continue;
      const oldGroup = original ? balloonGroup(beforeLetters, original) : [];
      const group = groupOf(l);
      if (!original || original.speaker !== l.speaker || JSON.stringify(original.src) !== JSON.stringify(l.src)
        || group.length !== oldGroup.length || group.some((part, i) => part.cap.text !== oldGroup[i]?.cap.text)) syncScriptFromLetter(page, l);
    }
    const was = { balloons: structuredClone(beforeLetters), beats: JSON.parse(beforeBeats) as typeof page.beats };
    const now = { balloons: structuredClone(page.balloons), beats: structuredClone(page.beats) };
    if (JSON.stringify(was) === JSON.stringify(now)) return;
    studio.run({ label, do: () => Object.assign(page, structuredClone(now)), undo: () => Object.assign(page, structuredClone(was)) }, true);
    studio.markStage(page, 'caption', 1);
  };
  const edit = (label: string, fn: () => void) => {
    const before = structuredClone(page.balloons);
    const beats = JSON.stringify(page.beats);
    fn();
    commit(label, before, beats);
    ctx.chrome();
    ctx.request();
  };
  /** Change the selected letter's caption. */
  const editCap = (label: string, fn: (c: CaptionSpec) => CaptionSpec) =>
    edit(label, () => {
      const l = sel();
      if (l) l.cap = fn(l.cap);
    });
  /** Live preview while a slider moves; `done` commits it as one undo step. */
  let liveBefore: { letters: Letter[]; beats: string } | null = null;
  const live = (fn: (c: CaptionSpec) => CaptionSpec, done: boolean, label = 'Lettering') => {
    const l = sel();
    if (!l) return;
    liveBefore ??= { letters: structuredClone(page.balloons), beats: JSON.stringify(page.beats) };
    l.cap = fn(l.cap);
    ctx.request();
    if (!done) return;
    const b = liveBefore;
    liveBefore = null;
    commit(label, b.letters, b.beats);
    ctx.chrome();
  };

  function place(p: Pt, kind: BalloonStyle): void {
    const panels = ctx.panels();
    const panel = panelAt(panels, p);
    const line = nextPanelLine(page, panels, panel);
    const l = newLetter(book, toPt(p), kind, line);
    clampLetter(l, page);
    edit(KIND_LABEL[l.cap.style] ?? 'Balloon', () => page.balloons.push(l));
    selId = l.id;
    ctx.chrome();
  }

  /** A drawn loop becomes a balloon of the shape it looks like (2Dope's detector). */
  function fromLoop(pts: Pt[]): boolean {
    const length = pts.reduce((total, p, i) => i ? total + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) : total, 0);
    const end = pts.at(-1)!;
    const start = pts[0]!;
    const gap = Math.hypot(end.x - start.x, end.y - start.y);
    if (length * ctx.scale() < 24 || gap > Math.min(length * 0.16, 14 / ctx.scale())) return false;
    const raw = resample(pts.map(toPt), 96);
    // Reject a doubled-back stroke or a figure eight before feeding the closed-outline fitter.
    let area = 0;
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i]!, b = raw[(i + 1) % raw.length]!;
      area += (a.x - raw[0]!.x) * (b.y - raw[0]!.y) - (b.x - raw[0]!.x) * (a.y - raw[0]!.y);
    }
    if (Math.abs(area) < 32) return false;
    const read = readBalloon(raw);
    if (!read || Math.min(read.width, read.height) < 4) return false;
    const panels = ctx.panels();
    const panel = panelAt(panels, { x: read.centre.x / PT, y: read.centre.y / PT });
    const style = read.style === 'custom' ? 'speech' : read.style;
    const l = newLetter(book, read.centre, style, nextPanelLine(page, panels, panel));
    l.cap = { ...l.cap, style: read.style, shape: Math.max(0.5, Math.min(2.5, read.shape)), minSize: [read.width / 2, read.height / 2] };
    if (state.keepDrawnOutline) {
      const xs = raw.map((p) => p.x), ys = raw.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      l.cap = { ...l.cap, style: 'custom', x: (x0 + x1) / 2, y: (y0 + y1) / 2, minSize: [(x1 - x0) / 2, (y1 - y0) / 2], look: { ...l.cap.look, outline: shapeForText(raw, false) }, tails: [] };
    } else {
      if (read.style === 'custom' && read.outline) l.cap = { ...l.cap, look: { ...l.cap.look, outline: read.outline } };
      l.cap = { ...l.cap, tails: read.tail ? [{ x: read.tail.x, y: read.tail.y, join: 'merged', width: 1.2 }] : [] };
    }
    clampLetter(l, page);
    edit(`Drawn ${KIND_LABEL[read.style]?.toLowerCase() ?? 'balloon'}`, () => page.balloons.push(l));
    selId = l.id;
    ctx.request();
    ctx.chrome();
    return true;
  }

  function cycleLine(l: Letter): void {
    if (groupOf(l).length > 1) return;
    const panels = ctx.panels();
    const line = nextPanelLine(page, panels, panelAt(panels, centreIn(l)));
    if (!line) return;
    const fresh = newLetter(book, l.cap, 'speech', line);
    edit('Next line', () => {
      const t = page.balloons.find((x) => x.id === l.id)!;
      t.cap = { ...t.cap, text: fresh.cap.text };
      t.src = fresh.src;
      delete t.keptScriptLine;
      if (fresh.speaker) t.speaker = fresh.speaker;
      else delete t.speaker;
    });
  }

  const selectLetter = (id: string | null) => {
    selId = id;
    if (id) mode.tool = 'select';
    ctx.chrome();
    ctx.request();
  };
  const openScript = () => openDialogue(ctx, selectLetter);

  function showRevisions(trigger: HTMLElement): void {
    reviewOpen = true;
    const next = page.balloons.find((l) => scriptRevision(page, l));
    ctx.openInspector(trigger);
    if (next) selectLetter(next.id);
    else ctx.chrome();
    ctx.stage.closest('.screen')?.querySelector<HTMLElement>('.script-revisions')?.focus({ preventScroll: true });
  }

  function revisionPanel(): HTMLElement {
    const items = page.balloons.flatMap((l) => {
      const revision = scriptRevision(page, l);
      return revision ? [{ l, revision }] : [];
    });
    const panels = ctx.panels();
    const list = h('div', { class: 'sec script-revisions', tabindex: '-1', 'aria-label': 'Script revisions', role: 'region' },
      h('h4', {}, 'Script revisions'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        reviewOpen = false;
        ctx.chrome();
        ctx.stage.closest('.screen')?.querySelector<HTMLElement>('[data-review-script]')?.focus();
      } }, 'Done'),
    );
    for (const { l, revision } of items) {
      const beat = page.beats.find((b) => b.id === l.src!.beat)!;
      const index = sourceIndex(beat, l.src!);
      const intended = dialoguePanel(page, panels, beat, index);
      const current = panelAt(panels, centreIn(l));
      const panel = h('select', { 'aria-label': 'Move revised dialogue to panel' },
        h('option', { value: '' }, 'Choose panel'),
        panels.map((item) => h('option', { value: item.index }, 'Panel ' + (item.index + 1))),
      );
      panel.addEventListener('change', () => {
        const destination = panel.value === '' ? undefined : panels[Number(panel.value)];
        if (!destination) return;
        selId = l.id;
        edit('Move revised dialogue', () => assignDialoguePanel(page, panels, beat, index, destination));
      });
      const decide = (label: string, fn: () => void) => h('button', { class: 'btn', type: 'button', onclick: () => {
        selId = l.id;
        edit(label, fn);
        ctx.stage.closest('.screen')?.querySelector<HTMLElement>('.script-revisions')?.focus({ preventScroll: true });
      } }, label);
      list.append(h('article', { class: 'script-revision' },
        h('button', { class: 'btn', type: 'button', 'aria-pressed': String(selId === l.id), onclick: () => {
          selectLetter(l.id);
          ctx.stage.closest('.screen')?.querySelector<HTMLElement>('.script-revisions')?.focus({ preventScroll: true });
        } }, 'Select balloon · ' + (current ? 'Panel ' + (current.index + 1) : 'Page')),
        h('dl', {},
          h('dt', {}, 'Current lettering'), h('dd', {}, (l.speaker ? l.speaker + ': ' : '') + revision.current),
          h('dt', {}, 'Revised script'), h('dd', {}, (revision.next.speaker ? revision.next.speaker + ': ' : '') + revision.next.text),
        ),
        h('div', { class: 'script-revision-actions' },
          decide('Apply wording', () => { applyScriptWording(page, l); }),
          decide('Keep current lettering', () => { l.keptScriptLine = revision.raw; }),
        ),
        panels.length ? h('label', { class: 'field' }, intended ? 'Script panel ' + (intended.index + 1) : 'Script panel', panel) : null,
      ));
    }
    if (!items.length) list.append(h('p', { class: 'note', role: 'status' }, 'All script revisions reviewed.'));
    return list;
  }


  function addContinuation(l: Letter, splitAt?: number, join: NonNullable<Letter['continuation']>['join'] = 'merge'): void {
    if (l.cap.style === 'sfx') return;
    const b = box(l);
    const root = rootOf(l);
    const panel = panelAt(ctx.panels(), centreIn(root));
    const { minSize: _min, path: _path, links: _links, ...cap } = l.cap;
    const width = Math.max(22, Math.min(55, (b.x1 - b.x0) * 0.4));
    const bottom = (panel?.bbox.y1 ?? H) * PT;
    const top = (panel?.bbox.y0 ?? 0) * PT;
    const y = b.y1 + 9 < bottom - 8 ? b.y1 + 9 : Math.max(top + 8, b.y0 - 9);
    const text = splitAt === undefined ? '' : l.cap.text.slice(splitAt).trimStart();
    const part: Letter = { id: newId('letter'), continuation: { after: l.id, join },
      cap: { ...cap, x: l.cap.x, y, text, minSize: [width / 2, 11], tails: [] } };
    edit('Add continuation balloon', () => {
      delete root.generated;
      if (splitAt !== undefined) l.cap = { ...l.cap, text: l.cap.text.slice(0, splitAt).trimEnd() };
      const i = page.balloons.indexOf(l);
      for (const next of page.balloons) if (next.continuation?.after === l.id) next.continuation.after = part.id;
      page.balloons.splice(i + 1, 0, part);
    });
    selectLetter(part.id);
    ctx.stage.closest('.screen')?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Words"]')?.focus();
  }

  function addTail(l: Letter): void {
    if (l.cap.tails.length >= 4) return;
    edit('Add tail', () => {
      const { cap } = l;
      l.cap = { ...cap, tails: [...cap.tails, { x: cap.x + 30 * (cap.tails.length % 2 ? -1 : 1), y: cap.y + 60, join: cap.style === 'thought' ? 'bubbles' : 'merged', width: 1.2 }] };
    });
  }

  function openAddMenu(l: Letter, anchor: HTMLElement, onClose?: () => void): void {
    const item = (label: string, run: () => void, disabled = false) => h('button', { class: 'item', type: 'button', disabled, onclick: () => {
      closePopover();
      run();
    } }, label);
    popover(anchor, h('div', {},
      item('Joined balloon', () => addContinuation(l)),
      item('Balloon underneath', () => addContinuation(l, undefined, 'stack')),
      item('Separate balloon in group', () => addContinuation(l, undefined, 'separate')),
      item('Add tail', () => addTail(l), l.cap.tails.length >= 4),
    ), 'below', 'Add to caption', onClose);
  }

  function removeLetter(l: Letter): void {
    const group = groupOf(l);
    const replacement = l.continuation?.after ?? group[1]?.id;
    if (!l.continuation && group[1]) {
      const first = group[1];
      delete first.continuation;
      first.src = l.src;
      first.speaker = l.speaker;
      first.keptScriptLine = l.keptScriptLine;
    } else if (!l.continuation) omitDialogue(page, l);
    for (const part of group) {
      if (part.continuation?.after === l.id && replacement) part.continuation.after = replacement;
    }
    page.balloons = page.balloons.filter((x) => x.id !== l.id);
  }

  function presetControls(l: Letter): HTMLElement {
    const presets = sheet().presets ?? {};
    const beat = l.src && page.beats.find((b) => b.id === l.src!.beat);
    const index = beat && l.src ? sourceIndex(beat, l.src) : -1;
    const assigned = beat ? beat.dialogue?.[index]?.preset : undefined;
    const select = h('select', { 'aria-label': 'Lettering preset' },
      h('option', { value: '' }, beat ? 'Speaker / script default' : 'Choose a preset'),
      Object.entries(presets).map(([id, preset]) => h('option', { value: id, selected: id === assigned }, preset.name)));
    select.addEventListener('change', () => edit('Apply lettering preset', () => {
      const id = select.value;
      if (beat && index >= 0) assignDialoguePreset(book, page, beat, index, id || undefined);
      else if (id && presets[id]) l.cap = applyStyle(l.cap, presets[id]!);
    }));
    return h('div', { class: 'sec' }, h('h4', {}, 'Presets'),
      Object.keys(presets).length ? h('label', { class: 'field' }, 'Lettering preset', select) : null,
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const name = (await askText('Save lettering preset', 'Preset name', '', 'Save'))?.trim();
        if (!name) return;
        const before = structuredClone(book.lettering);
        const style = captureStyle(l.cap, newId('preset'), name);
        const existing = Object.values(sheet().presets ?? {}).find((p) => p.name.toLowerCase() === style.name.toLowerCase());
        if (existing) { toast('A preset with that name already exists.'); return; }
        const after = { ...sheet(), presets: { ...sheet().presets, [style.id]: style } };
        studio.run({ label: 'Save lettering preset', do: () => (book.lettering = structuredClone(after)), undo: () => (book.lettering = structuredClone(before)) });
        ctx.chrome();
      } }, 'Save as preset'));
  }

  function cancelDrag(): void {
    if (drag) { page.balloons = drag.before; studio.drawing = false; }
    drag = null;
    loop = null;
    downAt = null;
  }

  let lastTap: { at: number; id: string; point: Pt } | null = null;
  const mode: DeskMode = {
    id: 'caption',
    actions: [
      { label: 'Script dialogue', glyph: '❝', run: openScript },
      { label: 'Style sheet', glyph: 'Aa', run: () => openStyleSheet(studio, () => { ctx.chrome(); ctx.request(); }) },
    ],
    tools: [
      { id: 'select', label: 'Select', glyph: '➤', key: 'v', group: 'edit' },
      { id: 'letter', label: 'Letter', glyph: '💬', group: 'make', variants: KINDS.map((k) => ({ id: k.id, label: k.label, glyph: k.glyph, key: k.key })) },
      { id: 'draw-balloon', label: 'Draw balloon', glyph: '◌', key: 'd', group: 'make' },
    ],
    tool: 'letter',
    cursor: () => (mode.tool === 'select' ? 'move' : 'cross'),
    skipBalloon: () => undefined,
    ctx(bar) {
      if (mode.tool === 'draw-balloon') {
        const preserve = h('input', { type: 'checkbox', checked: state.keepDrawnOutline });
        preserve.addEventListener('change', () => { state.keepDrawnOutline = preserve.checked; });
        bar.append(h('label', { class: 'mini' }, preserve, 'Keep drawn outline'));
      }
      const panels = ctx.panels();
      const left = page.beats.reduce((n, beat) => n + beat.lines.filter((raw, i) => parseLine(raw).text && !beat.dialogue?.[i]?.omit && dialoguePanel(page, panels, beat, i) && !letterForLine(page, beat, i)).length, 0);
      const keep = h('input', { type: 'checkbox', checked: state.keepReadable });
      keep.addEventListener('change', () => (state.keepReadable = keep.checked));
      const center = h('input', { type: 'checkbox', checked: state.fromCenter });
      center.addEventListener('change', () => { state.fromCenter = center.checked; ctx.request(); });
      const find = h('select', { 'aria-label': 'Find a balloon', class: 'balloon-jump' },
        h('option', { value: '' }, 'Page checks'),
        page.balloons.map((l, index) => {
          const panel = panelAt(panels, centreIn(rootOf(l)));
          const words = l.cap.text.replace(/\s+/g, ' ').slice(0, 45);
          return h('option', { value: l.id, selected: l.id === selId }, (panel ? 'Panel ' + (panel.index + 1) : 'Page') + ' · ' + (words || 'Balloon ' + (index + 1)));
        }));
      find.addEventListener('change', () => selectLetter(find.value || null));
      const revisions = page.balloons.filter((l) => scriptRevision(page, l)).length;
      bar.append(
        h('button', { class: 'btn', type: 'button', 'data-review-script': '', 'aria-expanded': String(reviewOpen),
          onclick: (e) => showRevisions(e.currentTarget as HTMLElement) }, 'Review script changes' + (revisions ? ' · ' + revisions : '')),
        h('button', { class: 'btn document-option', type: 'button', onclick: openScript }, 'Script dialogue'),
        h('button', { class: 'btn primary', type: 'button', disabled: !left, onclick: () => edit('Place script lettering', () => reconcileDialogue(book, page, panels, true)) }, 'Place from script' + (left ? ' · ' + left : '')),
        ...(page.balloons.length ? [find] : []),
        ...(sel() ? [h('label', { class: 'mini', title: 'Resize around the centre. Turn off to anchor the opposite edge.' }, center, 'Resize from center')] : []),
        h('label', { class: 'mini', title: 'Sizes snap to readable steps and never drop below the style sheet minimum' }, keep, 'Keep readable'),
        h('button', { class: 'btn document-option', type: 'button', onclick: () => openStyleSheet(studio, () => { ctx.chrome(); ctx.request(); }) }, 'Style sheet…'),
        h('span', { class: 'hint' }, mode.tool === 'select'
          ? 'Drag body to move · edges to resize · top stem to rotate · yellow dots aim tails'
          : mode.tool === 'draw-balloon' ? 'Draw a closed outline. Return to the starting point to finish.'
            : `Click in a panel to letter its next line · ${left} line${left === 1 ? '' : 's'} left`),
      );
    },
    inspector(el) {
      const l = sel();
      el.append(h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Caption'), h('div', { class: 'ins-title' }, l ? KIND_LABEL[l.cap.style] ?? 'Balloon' : `${page.balloons.length} balloon${page.balloons.length === 1 ? '' : 's'}`)));
      if (reviewOpen) el.append(revisionPanel());
      if (l) inspectLetter(el, l);
      else inspectPage(el);
      if (l) el.append(presetControls(l));
    },
    contextMenu(p) {
      const q = toPt(p);
      const hit = captionGroups(page.balloons).flatMap(balloonPaintOrder).reverse().find((b) => hitLetter(b, sheet(), q, W, H));
      const items: ReturnType<NonNullable<DeskMode['contextMenu']>> = [];
      if (hit) {
        selId = hit.id;
        ctx.chrome();
        items.push(
          { label: 'Joined balloon', run: () => addContinuation(hit) },
          { label: 'Add tail', disabled: hit.cap.tails.length >= 4, run: () => addTail(hit) },
          { label: 'Delete balloon', key: 'Del', run: () => { edit('Delete balloon', () => removeLetter(hit)); selId = null; ctx.chrome(); } },
          'sep');
      }
      items.push(...KINDS.map((k) => ({ label: k.label + ' here', run: () => place(p, k.id) })));
      items.push('sep',
        { label: 'Select', key: 'V', checked: mode.tool === 'select', run: () => { mode.tool = 'select'; ctx.chrome(); } },
        { label: 'Script dialogue…', run: openScript },
        { label: 'Style sheet…', run: () => openStyleSheet(studio, () => { ctx.chrome(); ctx.request(); }) });
      return items;
    },
    down(p, e) {
      if (mode.tool === 'draw-balloon') {
        loop = [p];
        lastTap = null;
        return;
      }
      const now = performance.now();
      const q = toPt(p);
      const s = sel();
      if (s) {
        const k = ctx.scale() / PT;
        const r = (e.pointerType === 'touch' ? 14 : 9) / k;
        const distance = (a: Pt) => Math.hypot(a.x - q.x, a.y - q.y);
        if (s.cap.style !== 'sfx' && distance(plusAt(s, k)) <= (e.pointerType === 'touch' ? 19 : 12) / k) { addAt = p; return; }
        const start = () => {
          studio.drawing = true;
          return { start: q, orig: structuredClone(s.cap), before: structuredClone(page.balloons), beforeBeats: JSON.stringify(page.beats), moved: false };
        };
        const bounds = localBox(s);
        const frameBounds = frame(bounds, k);
        const tail = s.cap.style === 'sfx' ? undefined : s.cap.tails.map((at, index) => ({ index, d: distance(at) })).sort((a, b) => a.d - b.d)[0];
        const rotateDistance = distance(onPage(rotationAt(frameBounds, k), s));
        const handle = boxHandles(frameBounds).map((side) => ({ side, d: distance(onPage(side.at, s)) })).sort((a, b) => a.d - b.d)[0]!;
        if (tail && tail.d <= Math.min(r, rotateDistance, handle.d)) {
          drag = { id: s.id, grab: { kind: 'tail', index: tail.index }, ...start() };
          return;
        }
        if (rotateDistance <= Math.min(r, handle.d)) {
          drag = { id: s.id, grab: { kind: 'rotate', angle: s.rotation ?? 0 }, ...start() };
          return;
        }
        if (handle.d <= r) {
          const natural = localBox({ ...s, cap: { ...s.cap, minSize: undefined } });
          drag = { id: s.id, grab: { kind: 'size', side: handle.side, box: bounds, minimum: { x: Math.max(2, natural.x1 - natural.x0), y: Math.max(2, natural.y1 - natural.y0) } }, ...start() };
          return;
        }
      }
      const hit = captionGroups(page.balloons).flatMap(balloonPaintOrder).reverse().find((b) => hitLetter(b, sheet(), q, W, H));
      if (hit) {
        selId = hit.id;
        if (lastTap?.id === hit.id && now - lastTap.at < 320 && Math.hypot(p.x - lastTap.point.x, p.y - lastTap.point.y) * ctx.scale() < 8) {
          lastTap = null;
          cycleLine(hit);
          return;
        }
        drag = { id: hit.id, grab: { kind: 'body' }, start: q, orig: structuredClone(hit.cap), before: structuredClone(page.balloons), beforeBeats: JSON.stringify(page.beats), moved: false };
        studio.drawing = true;
        return;
      }
      if (mode.tool === 'select') {
        selId = null;
        ctx.chrome();
        return;
      }
      void e;
      downAt = p;
    },
    move(p, e) {
      if (loop) {
        const last = loop[loop.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.scale() > 2) {
          if (loop.length >= 4096) loop = loop.filter((_, i) => i % 2 === 0);
          loop.push(p);
        }
        return;
      }
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) * ctx.scale() > 7) downAt = null;
      if (!drag) return;
      const l = page.balloons.find((x) => x.id === drag!.id);
      if (!l) return;
      const q = toPt(p);
      const dx = q.x - drag.start.x;
      const dy = q.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * (ctx.scale() / PT) < 3) return;
      drag.moved = true;
      const o = drag.orig;
      if (drag.grab.kind === 'body') {
        // the tails stay on their speakers; the balloon (and its joined balloons) move
        l.cap = { ...o, x: o.x + dx, y: o.y + dy, ...(o.links ? { links: o.links.map((k) => ({ ...k, x: k.x + dx, y: k.y + dy })) } : {}) };
        clampLetter(l, page);
        const dxGroup = l.cap.x - o.x, dyGroup = l.cap.y - o.y;
        for (const part of groupOf(l)) {
          if (part.id === l.id) continue;
          const previous = drag.before.find((b) => b.id === part.id);
          if (!previous) continue;
          part.cap = moveGroup || e.shiftKey ? { ...previous.cap, x: previous.cap.x + dxGroup, y: previous.cap.y + dyGroup,
            links: previous.cap.links?.map((k) => ({ ...k, x: k.x + dxGroup, y: k.y + dyGroup })) } : previous.cap;
        }
      } else if (drag.grab.kind === 'tail') {
        const i = drag.grab.index;
        l.cap = { ...o, tails: o.tails.map((t, j) => (j === i ? { ...t, x: t.x + dx, y: t.y + dy } : t)) };
      } else if (drag.grab.kind === 'rotate') {
        const angle = (point: Pt) => Math.atan2(point.y - o.y, point.x - o.x);
        let degrees = drag.grab.angle + (angle(q) - angle(drag.start)) * 180 / Math.PI;
        if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
        degrees = (((degrees + 180) % 360) + 360) % 360 - 180;
        if (degrees) l.rotation = degrees;
        else delete l.rotation;
      } else {
        const { box: b, side, minimum } = drag.grab;
        const textOnly = o.style === 'sfx';
        const fixedPath = o.style === 'custom' && o.path?.length && !o.look?.outline;
        const origin = { x: 0, y: 0 };
        const delta = rotateAround({ x: dx, y: dy }, origin, -(l.rotation ?? 0));
        const result = resizeBox(b, side, delta, textOnly || fixedPath ? { x: 2, y: 2 } : minimum, state.fromCenter, e.shiftKey || textOnly);
        const moveBy = (v: Pt): Pt => rotateAround(v, origin, l.rotation ?? 0);
        if (textOnly) {
          const scale = snapScale(o, sheet(), (o.scale ?? 1) * result.width / (b.x1 - b.x0), state.keepReadable && !l.smallOk, true);
          const ratio = scale / (o.scale ?? 1);
          const shift = state.fromCenter ? origin : moveBy({ x: side.x * (b.x1 - b.x0) * (ratio - 1) / 2, y: side.y * (b.y1 - b.y0) * (ratio - 1) / 2 });
          l.cap = { ...o, scale, x: o.x + shift.x, y: o.y + shift.y };
        } else {
          const shift = moveBy(result.shift);
          l.cap = { ...o, x: o.x + shift.x, y: o.y + shift.y,
            ...(fixedPath ? { path: o.path!.map(([x, y]) => [x * result.width / (b.x1 - b.x0), y * result.height / (b.y1 - b.y0)]) } : { minSize: [result.width / 2, result.height / 2] }),
          };
        }
        clampLetter(l, page);
      }
    },
    up(p, e) {
      if (e.type === 'pointercancel') { addAt = null; cancelDrag(); ctx.chrome(); return; }
      if (addAt) {
        const at = addAt;
        addAt = null;
        const l = sel();
        if (l && Math.hypot(p.x - at.x, p.y - at.y) * ctx.scale() <= 18) {
          const anchor = h('span', { class: 'caption-menu-anchor', style: 'left:' + e.clientX + 'px;top:' + e.clientY + 'px' });
          ctx.stage.append(anchor);
          openAddMenu(l, anchor, () => {
            anchor.remove();
            ctx.stage.closest('.screen')?.querySelector<HTMLElement>('[data-add-caption]')?.focus({ preventScroll: true });
          });
        }
        return;
      }
      if (loop) {
        const pts = [...loop, p];
        loop = null;
        if (!fromLoop(pts)) toast('Close the outline to create a balloon.');
        return;
      }
      if (downAt) {
        const at = downAt;
        downAt = null;
        if (mode.tool === 'letter' && Math.hypot(p.x - at.x, p.y - at.y) * ctx.scale() <= 7) place(at, variantOf(mode, 'letter') as BalloonStyle);
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      studio.drawing = false;
      if (d.moved) commit(d.grab.kind === 'body' ? 'Move balloon' : d.grab.kind === 'tail' ? 'Aim tail' : d.grab.kind === 'rotate' ? 'Rotate lettering' : 'Resize balloon', d.before, d.beforeBeats);
      lastTap = !d.moved && d.grab.kind === 'body' ? { at: performance.now(), id: d.id, point: p } : null;
      ctx.chrome();
    },
    overlay(g, s) {
      const k = s / PT;
      const issues = new Set(readingOrderIssues(page, ctx.panels()).map((i) => i.balloon.id));
      g.save();
      for (const l of page.balloons) {
        const b = box(l);
        const r = readabilityAll(l, sheet()).level;
        if (r !== 'good') {
          g.fillStyle = LEVEL_COLOR[r];
          g.beginPath();
          g.arc(b.x1 * k, b.y0 * k, 5, 0, Math.PI * 2);
          g.fill();
        }
        if (issues.has(l.id)) {
          g.strokeStyle = '#B8432F';
          g.lineWidth = 2;
          g.setLineDash([4, 4]);
          g.strokeRect(b.x0 * k - 4, b.y0 * k - 4, (b.x1 - b.x0) * k + 8, (b.y1 - b.y0) * k + 8);
          g.setLineDash([]);
        }
      }
      const l = sel();
      if (l && mode.tool !== 'draw-balloon') {
        if (moveGroup) {
          g.strokeStyle = '#2F6F7E';
          g.setLineDash([5, 3]);
          for (const part of groupOf(l)) {
            if (part === l) continue;
            const b = box(part);
            g.strokeRect(b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
          }
          g.setLineDash([]);
        }
        g.strokeStyle = '#B8432F';
        g.lineWidth = 1.5;
        g.beginPath();
        outline(l).forEach((p, i) => (i ? g.lineTo(p.x * k, p.y * k) : g.moveTo(p.x * k, p.y * k)));
        g.closePath();
        g.stroke();
        const b = frame(localBox(l), k);
        const dot = (q: Pt, fill: string) => {
          g.fillStyle = fill;
          g.strokeStyle = '#191A1F';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(q.x * k, q.y * k, 4.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        };
        g.setLineDash([4, 3]);
        g.strokeStyle = '#B8432F';
        const handles = boxHandles(b);
        g.beginPath();
        handles.filter((h) => h.x && h.y).forEach((h, i) => {
          const q = onPage(h.at, l);
          if (i) g.lineTo(q.x * k, q.y * k);
          else g.moveTo(q.x * k, q.y * k);
        });
        g.closePath();
        g.stroke();
        g.setLineDash([]);
        const rotate = onPage(rotationAt(b, k), l);
        const stem = onPage({ x: (b.x0 + b.x1) / 2, y: b.y0 }, l);
        g.beginPath(); g.moveTo(stem.x * k, stem.y * k); g.lineTo(rotate.x * k, rotate.y * k); g.stroke();
        dot(rotate, '#E3B8AC');
        if (state.fromCenter) {
          const x = l.cap.x * k;
          const y = l.cap.y * k;
          g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke();
        }
        for (const hd of handles) dot(onPage(hd.at, l), '#FFFDF7');
        if (l.cap.style !== 'sfx') for (const tail of l.cap.tails) dot(tail, '#F2C230');
        if (l.cap.style !== 'sfx') {
          const p = plusAt(l, k);
          dot(p, '#FFFDF7');
          g.strokeStyle = '#191A1F';
          g.beginPath();
          g.moveTo(p.x * k - 2.5, p.y * k); g.lineTo(p.x * k + 2.5, p.y * k);
          g.moveTo(p.x * k, p.y * k - 2.5); g.lineTo(p.x * k, p.y * k + 2.5);
          g.stroke();
        }
      }
      if (loop && loop.length > 1) {
        g.strokeStyle = '#B8432F';
        g.lineWidth = 2;
        g.setLineDash([6, 5]);
        g.beginPath();
        loop.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
        g.stroke();
        g.setLineDash([]);
        const start = loop[0]!;
        const end = loop.at(-1)!;
        g.fillStyle = Math.hypot(end.x - start.x, end.y - start.y) * s < 14 ? '#2F6F7E' : '#B8432F';
        g.beginPath();
        g.arc(start.x * s, start.y * s, 4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },
    key(e) {
      const l = sel();
      if (l && (e.key === 'Delete' || e.key === 'Backspace')) {
        edit('Delete balloon', () => removeLetter(l));
        selId = null;
        ctx.chrome();
        return true;
      }
      if (e.key === 'Escape') {
        cancelDrag();
        selId = null;
        ctx.chrome();
        ctx.request();
        return true;
      }
      return false;
    },
    dispose: cancelDrag,
  };

  // ---- inspector: one letter
  function inspectLetter(el: HTMLElement, l: Letter): void {
    const c = l.cap;
    const sh = sheet();
    const sec = (title: string, ...kids: (Node | null)[]) => h('div', { class: 'sec stack' }, h('h4', {}, title), ...kids);
    const row = (label: string, control: Node) => h('label', { class: 'field' }, label, control);

    const rotation = h('input', { type: 'number', min: -180, max: 180, step: 1, value: Math.round(l.rotation ?? 0), 'aria-label': 'Rotation in degrees' });
    rotation.addEventListener('change', () => edit('Rotate lettering', () => {
      const value = Math.max(-180, Math.min(180, rotation.valueAsNumber || 0));
      if (value) l.rotation = value;
      else delete l.rotation;
    }));
    el.append(sec('Transform', row('Rotation (°)', rotation), h('button', { class: 'btn', type: 'button', disabled: !l.cap.minSize, onclick: () => editCap('Reset balloon size', (cap) => ({ ...cap, minSize: undefined })) }, 'Fit balloon to text')));

    // Words
    const text = h('textarea', { 'aria-label': 'Words' });
    text.value = c.text;
    let before: { letters: Letter[]; beats: string } | null = null;
    text.addEventListener('focus', () => (before = { letters: structuredClone(page.balloons), beats: JSON.stringify(page.beats) }));
    text.addEventListener('input', () => {
      l.cap = { ...l.cap, text: text.value };
      ctx.request();
    });
    text.addEventListener('change', () => {
      if (before) commit('Edit words', before.letters, before.beats);
      before = null;
    });
    let splitCursor: number | undefined;
    const splitButton = h('button', { class: 'btn', type: 'button', onclick: () => {
      const at = splitCursor ?? text.selectionStart;
      const words = l.cap.text;
      const rest = /\S+/.exec(words.slice(at));
      const split = rest && (at === 0 || /\s/.test(words[at - 1] ?? '') || /\s/.test(words[at] ?? '')) ? at + rest.index : -1;
      if (split < 1 || !words.slice(0, split).trim()) { toast('Place the text cursor before the words to continue.'); return; }
      addContinuation(l, split);
    } }, 'Split words into next balloon');
    splitButton.addEventListener('pointerdown', () => { splitCursor = text.selectionStart; });
    const group = groupOf(l);
    const root = group[0]!;
    const beatIdx = root.src ? page.beats.findIndex((x) => x.id === root.src!.beat) : -1;
    const panel = beatIdx >= 0 && root.src ? dialoguePanel(page, ctx.panels(), page.beats[beatIdx]!, sourceIndex(page.beats[beatIdx]!, root.src)) : panelAt(ctx.panels(), centreIn(root));
    if (c.style !== 'sfx' || group.length > 1) {
      const join = l.continuation;
      el.append(sec('Caption group',
        group.length > 1 ? h('p', { class: 'note' }, `Balloon ${group.indexOf(l) + 1} of ${group.length}${panel ? ' · Panel ' + (panel.index + 1) : ''}`) : null,
        group.length > 1 ? seg(group.map((part, i) => ({ id: part.id, label: String(i + 1) })), l.id, selectLetter, 'Select balloon in group') : null,
        join ? seg([{ id: 'merge', label: 'Merge' }, { id: 'stack', label: 'Underneath' }, { id: 'separate', label: 'Separate' }], join.join,
          (v) => edit('Set balloon connection', () => { join.join = v; }), 'Balloon connection') : null,
        c.style !== 'sfx' ? h('button', { class: 'btn', type: 'button', 'data-add-caption': '', 'aria-haspopup': 'dialog', onclick: (e) => openAddMenu(l, e.currentTarget as HTMLElement) }, '+ Add to caption') : null,
        group.length > 1 ? h('button', { class: 'btn', type: 'button', 'aria-pressed': String(moveGroup), onclick: (e) => { moveGroup = !moveGroup; (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(moveGroup)); ctx.request(); } }, 'Move whole group') : null,
      ));
    }
    const beat = page.beats[beatIdx];
    const lineIndex = beat && root.src ? sourceIndex(beat, root.src) : -1;
    const panels = ctx.panels();
    const destination = beat && lineIndex >= 0 ? h('select', { 'aria-label': 'Assign dialogue to panel' },
      h('option', { value: '' }, 'Follow script order'),
      panels.map((item) => h('option', { value: item.index, selected: !!beat.dialogue?.[lineIndex]?.panel && panel === item }, 'Panel ' + (item.index + 1))),
    ) : null;
    destination?.addEventListener('change', () => edit('Assign dialogue to panel', () => {
      assignDialoguePanel(page, panels, beat!, lineIndex, destination.value === '' ? null : panels[Number(destination.value)] ?? null);
    }));
    el.append(sec('Words', text, destination ? h('label', { class: 'field' }, 'Script panel', destination) : null,
      c.style !== 'sfx' ? splitButton : null,
      h('p', { class: 'note' }, beatIdx >= 0 ? `Beat ${beatIdx + 1}, line ${root.src!.line + 1}${panel ? ' · Panel ' + (panel.index + 1) : ''}. Text edits update the script.` : 'Free text.'),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        l.src && group.length === 1 ? h('button', { class: 'btn', type: 'button', onclick: () => cycleLine(l) }, 'Next line') : null,
        l.src ? h('button', { class: 'btn', type: 'button', onclick: () => edit('Unlink from script', () => { omitDialogue(page, l); delete l.src; delete l.generated; delete l.keptScriptLine; }) }, 'Unlink') : null,
        h('button', { class: 'btn danger', type: 'button', onclick: () => { edit('Delete balloon', () => removeLetter(l)); selId = null; ctx.chrome(); } }, 'Delete'))));

    // Speaker and character style
    const names = speakers(book);
    const who = h('input', { value: l.speaker ?? '', list: 'inkflo-speakers', placeholder: 'Nobody (narration)', 'aria-label': 'Speaker' });
    who.addEventListener('change', () => edit('Set speaker', () => {
      const t = sel()!;
      const v = who.value.trim();
      if (v) t.speaker = v;
      else delete t.speaker;
    }));
    const st = characterStyle(sh, l.speaker);
    el.append(sec('Speaker', h('datalist', { id: 'inkflo-speakers' }, names.map((n) => h('option', { value: n }))), who,
      l.speaker ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => {
          const next = withCharacterStyle(sh, l.speaker!, l.cap);
          const prev = structuredClone(book.lettering);
          studio.run({ label: `${l.speaker}’s style`, do: () => (book.lettering = structuredClone(next)), undo: () => (book.lettering = structuredClone(prev)) });
          toast(`Saved as ${l.speaker}’s style. New ${l.speaker} balloons use it.`);
          ctx.chrome();
        } }, `Save as ${l.speaker}’s style`),
        st ? h('button', { class: 'btn', type: 'button', onclick: () => {
          edit(`Apply ${l.speaker}’s style to page`, () => {
            for (const x of page.balloons) if (x.speaker && x.speaker.toUpperCase() === l.speaker!.toUpperCase() && x.cap.style !== 'sfx' && x.cap.style !== 'box') x.cap = applyStyle(x.cap, st);
          });
        } }, `Apply to all ${l.speaker} balloons`) : null) : null));

    // Lettering
    const font = h('select', { 'aria-label': 'Font' }, BUNDLED_FONTS.map((f) => h('option', { value: f.id, selected: f.id === c.font }, f.label)));
    font.addEventListener('change', () => editCap('Font', (x) => ({ ...x, font: font.value })));
    const pt = letterPt(c, sh);
    const scaleOut = h('b', {}, `${pt.toFixed(1)} pt`);
    const scale = h('input', { type: 'range', min: 0.5, max: 3, step: 0.01, value: c.scale ?? 1, 'aria-label': 'Size scale' });
    const onScale = (done: boolean) => (e: Event) => {
      const free = (e as InputEvent & { altKey?: boolean }).altKey === true;
      const v = snapScale(c, sh, Number(scale.value), state.keepReadable && !l.smallOk, free);
      scaleOut.textContent = `${(sh.sizes[c.size] * v).toFixed(1)} pt`;
      live((x) => ({ ...x, scale: v }), done, 'Lettering size');
    };
    scale.addEventListener('input', onScale(false));
    scale.addEventListener('change', onScale(true));
    const toggles = h('div', { class: 'seg', role: 'group', 'aria-label': 'Emphasis' },
      (['bold', 'italic', 'caps'] as const).map((k) => h('button', { type: 'button', 'aria-pressed': String(c[k]), onclick: () => editCap(k, (x) => ({ ...x, [k]: !x[k] })) }, k === 'bold' ? 'B' : k === 'italic' ? 'I' : 'AA')));
    const textColor = h('input', { type: 'color', value: c.textColor, 'aria-label': 'Text colour' });
    textColor.addEventListener('change', () => editCap('Text colour', (x) => ({ ...x, textColor: textColor.value })));
    el.append(sec('Lettering',
      row('Font', font),
      seg<LetterSize>(LETTER_SIZES.map((s) => ({ id: s, label: `${s[0]!.toUpperCase()}${s.slice(1)} ${sh.sizes[s]}pt` })), c.size, (v) => editCap('Size', (x) => ({ ...x, size: v })), 'Size'),
      h('label', { class: 'mini' }, 'Scale', scale, scaleOut),
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, toggles, h('label', { class: 'mini' }, 'Colour', textColor)),
      seg(['left', 'center', 'right'].map((a) => ({ id: a, label: a === 'center' ? 'Centre' : a[0]!.toUpperCase() + a.slice(1) })), c.align, (v) => editCap('Align', (x) => ({ ...x, align: v as CaptionSpec['align'] })), 'Align'),
      c.style === 'sfx' ? h('p', { class: 'note' }, 'Markup: *bold*, _italic_.') : null));

    // Balloon
    const kind = h('select', { 'aria-label': 'Balloon kind' }, KINDS.map((k) => h('option', { value: k.id, selected: k.id === c.style }, k.label)), c.style === 'custom' ? h('option', { value: 'custom', selected: true }, 'Drawn shape') : null);
    kind.addEventListener('change', () => editCap('Balloon kind', (x) => {
      const style = kind.value as BalloonStyle;
      const tails = style === 'sfx' || style === 'box' ? [] : x.tails.length ? x.tails : [{ x: x.x - 18, y: x.y + 60, join: (style === 'thought' ? 'bubbles' : 'merged') as TailJoin, width: 1.2 }];
      return { ...x, style, tails, ...(style === 'sfx' ? { textOutline: x.textOutline ?? '#111111', font: 'bangers' } : {}) };
    }));
    const slider = (label: string, min: number, max: number, step: number, value: number, set: (x: CaptionSpec, v: number) => CaptionSpec) => {
      const out = h('b', {}, String(value));
      const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
      input.addEventListener('input', () => {
        out.textContent = Number(input.value).toFixed(step < 1 ? 2 : 0);
        live((x) => set(x, Number(input.value)), false, label);
      });
      input.addEventListener('change', () => live((x) => set(x, Number(input.value)), true, label));
      return h('label', { class: 'mini' }, label, input, out);
    };
    const fill = h('input', { type: 'color', value: c.fill, 'aria-label': 'Balloon fill' });
    fill.addEventListener('change', () => editCap('Balloon fill', (x) => ({ ...x, fill: fill.value })));
    const ink = h('input', { type: 'color', value: c.ink, 'aria-label': 'Balloon ink' });
    ink.addEventListener('change', () => editCap('Balloon ink', (x) => ({ ...x, ink: ink.value })));
    const look = c.look ?? {};
    el.append(sec('Balloon',
      row('Kind', kind),
      c.style !== 'sfx' ? h('div', { style: 'display:flex;gap:10px' }, h('label', { class: 'mini' }, 'Fill', fill), h('label', { class: 'mini' }, 'Ink', ink)) : null,
      c.style !== 'sfx' ? slider('Border', 0, 0.4, 0.01, c.inkWidth, (x, v) => ({ ...x, inkWidth: v })) : slider('Outline', 0, 0.5, 0.01, c.textOutlineWidth, (x, v) => ({ ...x, textOutlineWidth: v, textOutline: x.textOutline ?? '#111111' })),
      slider('Width', 0.5, 2.5, 0.05, c.shape ?? 1, (x, v) => ({ ...x, shape: v })),
      c.style === 'speech' || c.style === 'whisper' ? slider('Roundness', 2, 8, 0.1, look.round ?? 2.7, (x, v) => ({ ...x, look: { ...x.look, round: v } })) : null,
      c.style === 'shout' ? slider('Spikes', 4, 40, 1, look.spikes ?? 14, (x, v) => ({ ...x, look: { ...x.look, spikes: v } })) : null,
      c.style === 'thought' ? slider('Bumps', 4, 30, 1, look.bumps ?? 10, (x, v) => ({ ...x, look: { ...x.look, bumps: v } })) : null,
      c.style !== 'sfx' && c.style !== 'box' ? slider('Hand-drawn', 0, 1, 0.05, look.wobble ?? 0, (x, v) => ({ ...x, look: { ...x.look, wobble: v } })) : null,
      c.minSize ? h('button', { class: 'btn', type: 'button', onclick: () => editCap('Fit to words', (x) => { const { minSize: _m, ...rest } = x; return rest; }) }, 'Fit to words') : null));

    // Tails
    if (c.style !== 'sfx') {
      el.append(sec('Tails',
        ...c.tails.map((t, i) => {
          const join = h('select', { 'aria-label': `Tail ${i + 1} kind` }, TAIL_JOINS.filter((j) => j !== 'none').map((j) => h('option', { value: j, selected: j === t.join }, JOIN_LABEL[j])));
          join.addEventListener('change', () => editCap('Tail kind', (x) => ({ ...x, tails: x.tails.map((y, k) => (k === i ? { ...y, join: join.value as TailJoin } : y)) })));
          return h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('span', { class: 'hint' }, `Tail ${i + 1}`), join,
            h('button', { class: 'btn', type: 'button', 'aria-label': `Remove tail ${i + 1}`, onclick: () => editCap('Remove tail', (x) => ({ ...x, tails: x.tails.filter((_, k) => k !== i) })) }, '✕'));
        }),
        c.tails.length < 4 ? h('button', { class: 'btn', type: 'button', onclick: () => addTail(l) }, '+ Add tail') : null,
        h('p', { class: 'note' }, 'Drag a yellow dot on the page to aim its tail at the speaker.')));
    }

    // Readability
    const all = readabilityAll(l, sh);
    const small = h('input', { type: 'checkbox', checked: !!l.smallOk });
    small.addEventListener('change', () => edit(small.checked ? 'Small on purpose' : 'Readable size', () => {
      const t = sel()!;
      if (small.checked) t.smallOk = true;
      else delete t.smallOk;
    }));
    el.append(h('div', { class: 'sec stack' },
      h('h4', {}, 'Readability'),
      h('div', { class: 'rows' }, h('span', { style: `color:${LEVEL_COLOR[all.level]};font-weight:650` }, `● ${LEVEL_TEXT[all.level]}`), h('b', {}, `${pt.toFixed(1)} pt`)),
      ...all.byTarget.filter((t) => t.r.issues.length).map((t) =>
        h('div', {}, h('div', { class: 'hint' }, t.target.name),
          h('ul', { class: 'check' }, t.r.issues.map((i) => h('li', { class: 'warn' }, i.text,
            i.fix ? h('button', { class: 'btn', type: 'button', style: 'margin-left:auto;min-height:24px;padding:2px 8px', onclick: () => editCap(FIX_LABEL[i.fix!], (x) => applyFix(x, sh, i.fix!)) }, FIX_LABEL[i.fix]) : null))))),
      h('label', { class: 'mini' }, small, 'Small on purpose (whisper, chatter)')));
  }

  // ---- inspector: the page
  function inspectPage(el: HTMLElement): void {
    const sh = sheet();
    const issues = readingOrderIssues(page, ctx.panels());
    const levels = page.balloons.map((l) => ({ l, level: readabilityAll(l, sh).level }));
    const weak = levels.filter((x) => x.level !== 'good');
    el.append(
      h('div', { class: 'sec stack' }, h('h4', {}, 'Readability'),
        weak.length
          ? h('ul', { class: 'check' }, weak.map((x) => h('li', { class: 'warn' }, h('button', { type: 'button', onclick: () => { selId = x.l.id; ctx.chrome(); ctx.request(); } }, `“${x.l.cap.text.slice(0, 22)}${x.l.cap.text.length > 22 ? '…' : ''}”`), ` ${LEVEL_TEXT[x.level].toLowerCase()}`)))
          : h('ul', { class: 'check' }, h('li', {}, page.balloons.length ? `Every balloon reads well at ${targetsFor(sh).map((t) => t.name.split(' ')[0]!.toLowerCase()).join(', ')} size.` : 'Nothing lettered yet.')),
        weak.length ? h('button', { class: 'btn', type: 'button', onclick: () => edit('Fix lettering on this page', () => {
          for (const l of page.balloons) if (!l.smallOk) for (const f of safeFixes(l, sh)) l.cap = applyFix(l.cap, sh, f);
        }) }, 'Fix all on this page') : null),
      h('div', { class: 'sec' }, h('h4', {}, 'Reading order'),
        issues.length
          ? h('ul', { class: 'check' }, issues.map((i) => h('li', { class: 'warn' }, h('button', { type: 'button', onclick: () => { selId = i.balloon.id; ctx.chrome(); ctx.request(); } }, `“${i.balloon.cap.text.slice(0, 22)}${i.balloon.cap.text.length > 22 ? '…' : ''}” `), i.message)))
          : h('ul', { class: 'check' }, h('li', {}, page.balloons.length ? 'Balloons read in script order.' : 'Nothing lettered yet.'))),
      h('div', { class: 'sec' }, h('h4', {}, 'Script lines'),
        page.beats.length
          ? page.beats.map((beat, bi) => {
              const lines = beat.lines.map((raw, i) => ({ raw, i })).filter(({ raw, i }) => parseLine(raw).text && !beat.dialogue?.[i]?.omit);
              return h('div', { class: 'rows' }, `Beat ${bi + 1}`, h('b', {}, lines.filter(({ i }) => letterForLine(page, beat, i)).length + '/' + lines.length));
            })
          : h('p', { class: 'note' }, 'Add beats in Script to place their dialogue here.')),
    );
  }

  return mode;
}
