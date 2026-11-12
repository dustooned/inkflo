import { newId, PT, sheetOf, type Letter, type Pt } from '../../doc/model';
import { BUNDLED_FONTS } from '../../engine/lettering/fonts';
import { detectBalloon, readBalloon } from '../../engine/lettering/geometry';
import { applyStyle, captureStyle } from '../../engine/lettering/styles';
import { LETTER_SIZES, TAIL_JOINS, type BalloonStyle, type CaptionSpec, type LetterSize, type TailJoin } from '../../engine/lettering/spec';
import { panelAt } from '../../geom/carve';
import { assignDialoguePreset, centreIn, characterStyle, clampLetter, dialoguePanel, letterForLine, newLetter, nextPanelLine, omitDialogue, parseLine, readingOrderIssues, reconcileDialogue, sourceIndex, speakers, syncScriptFromLetter, withCharacterStyle } from '../../geom/lettering';
import { applyFix, letterPt, readabilityAll, safeFixes, snapScale, targetsFor, type FixId, type Level } from '../../geom/readability';
import { hitLetter, letterBox, letterOutline } from '../../render/caption';
import { variantOf, type DeskCtx, type DeskMode } from '../desk';
import { askText, h, seg, toast } from '../dom';
import { openDialogue } from '../dialogue';
import { openStyleSheet } from '../stylesheet';

type Grab = { kind: 'body' } | { kind: 'tail'; index: number } | { kind: 'size' };

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
const state = { keepReadable: true };

/**
 * Caption: letter the page from the script. Click inside a panel to letter its next line, or
 * draw a loop to make a balloon in that shape. Words stay linked to the script both ways.
 * Positions are points (1/72 in) on the page.
 */
export function captionDesk(ctx: DeskCtx): DeskMode {
  const { studio, page, book } = ctx;
  const sheet = () => sheetOf(book);
  const prior = JSON.stringify([page.beats, page.balloons]);
  reconcileDialogue(book, page, ctx.panels());
  if (JSON.stringify([page.beats, page.balloons]) !== prior) studio.saver.markDirty();
  let selId: string | null = null;
  let drag: { id: string; grab: Grab; start: Pt; orig: CaptionSpec; before: Letter[]; beforeBeats: string; moved: boolean } | null = null;
  let loop: Pt[] | null = null;
  let downAt: Pt | null = null;

  const W = page.widthIn;
  const H = page.heightIn;
  const toPt = (p: Pt): Pt => ({ x: p.x * PT, y: p.y * PT });
  const sel = () => page.balloons.find((b) => b.id === selId) ?? null;
  const outline = (l: Letter) => letterOutline(l, sheet(), W, H);
  const box = (l: Letter) => letterBox(l, sheet(), W, H);

  /** One undo step over lettering and (linked) script lines. */
  const commit = (label: string, beforeLetters: Letter[], beforeBeats: string) => {
    const previous = new Map(beforeLetters.map((l) => [l.id, l]));
    for (const l of page.balloons) {
      const original = previous.get(l.id);
      if (l.generated && original && JSON.stringify(l.cap) !== JSON.stringify(original.cap)) delete l.generated;
      syncScriptFromLetter(page, l);
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
    const raw = pts.map(toPt);
    if (detectBalloon(raw) === 'open') return false;
    const read = readBalloon(raw);
    if (!read) return false;
    const panels = ctx.panels();
    const panel = panelAt(panels, { x: read.centre.x / PT, y: read.centre.y / PT });
    const style = read.style === 'custom' ? 'speech' : read.style;
    const l = newLetter(book, read.centre, style, nextPanelLine(page, panels, panel));
    l.cap = { ...l.cap, style: read.style, shape: Math.max(0.5, Math.min(2.5, read.shape)), minSize: [read.width / 2, read.height / 2] };
    if (read.style === 'custom' && read.outline) l.cap = { ...l.cap, look: { ...(l.cap.look ?? {}), outline: read.outline } };
    if (read.tail) l.cap = { ...l.cap, tails: [{ x: read.tail.x, y: read.tail.y, join: 'merged', width: 1.2 }] };
    else if (style !== 'box') l.cap = { ...l.cap, tails: [] };
    edit(`Drawn ${KIND_LABEL[read.style]?.toLowerCase() ?? 'balloon'}`, () => page.balloons.push(l));
    selId = l.id;
    ctx.chrome();
    return true;
  }

  function cycleLine(l: Letter): void {
    const panels = ctx.panels();
    const line = nextPanelLine(page, panels, panelAt(panels, centreIn(l)));
    if (!line) return;
    const fresh = newLetter(book, l.cap, 'speech', line);
    edit('Next line', () => {
      const t = page.balloons.find((x) => x.id === l.id)!;
      t.cap = { ...t.cap, text: fresh.cap.text };
      t.src = fresh.src;
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

  function removeLetter(l: Letter): void {
    omitDialogue(page, l);
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

  function handles(l: Letter): { tails: Pt[]; size: Pt } {
    const b = box(l);
    return { tails: l.cap.style === 'sfx' ? [] : l.cap.tails.map((t) => ({ x: t.x, y: t.y })), size: { x: b.x1, y: b.y1 } };
  }

  let lastDown = 0;
  const mode: DeskMode = {
    id: 'caption',
    tools: [
      { id: 'select', label: 'Select', glyph: '➤', key: 'v', group: 'edit' },
      { id: 'letter', label: 'Letter', glyph: '💬', group: 'make', variants: KINDS.map((k) => ({ id: k.id, label: k.label, glyph: k.glyph, key: k.key })) },
    ],
    tool: 'letter',
    cursor: () => (mode.tool === 'select' ? 'move' : 'cross'),
    skipBalloon: () => undefined,
    ctx(bar) {
      const panels = ctx.panels();
      const left = page.beats.reduce((n, beat) => n + beat.lines.filter((raw, i) => parseLine(raw).text && !beat.dialogue?.[i]?.omit && dialoguePanel(page, panels, beat, i) && !letterForLine(page, beat, i)).length, 0);
      const keep = h('input', { type: 'checkbox', checked: state.keepReadable });
      keep.addEventListener('change', () => (state.keepReadable = keep.checked));
      const find = h('select', { 'aria-label': 'Find a balloon', class: 'balloon-jump' },
        h('option', { value: '' }, 'Page checks'),
        page.balloons.map((l, index) => {
          const panel = panelAt(panels, centreIn(l));
          const words = l.cap.text.replace(/\s+/g, ' ').slice(0, 45);
          return h('option', { value: l.id, selected: l.id === selId }, (panel ? 'Panel ' + (panel.index + 1) : 'Page') + ' · ' + (words || 'Balloon ' + (index + 1)));
        }));
      find.addEventListener('change', () => selectLetter(find.value || null));
      bar.append(
        h('button', { class: 'btn', type: 'button', onclick: openScript }, 'Script dialogue'),
        h('button', { class: 'btn primary', type: 'button', disabled: !left, onclick: () => edit('Place script lettering', () => reconcileDialogue(book, page, panels, true)) }, 'Place from script' + (left ? ' · ' + left : '')),
        ...(page.balloons.length ? [find] : []),
        h('label', { class: 'mini', title: 'Sizes snap to readable steps and never drop below the style sheet minimum' }, keep, 'Keep readable'),
        h('button', { class: 'btn', type: 'button', onclick: () => openStyleSheet(studio, () => { ctx.chrome(); ctx.request(); }) }, 'Style sheet…'),
        h('span', { class: 'hint' }, mode.tool === 'select'
          ? 'Drag to move · drag a dot to aim a tail · corner to resize · double-click for the next line'
          : `Click in a panel to letter its next line, or draw a loop for a balloon of that shape · ${left} line${left === 1 ? '' : 's'} left`),
      );
    },
    inspector(el) {
      const l = sel();
      el.append(h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Caption'), h('div', { class: 'ins-title' }, l ? KIND_LABEL[l.cap.style] ?? 'Balloon' : `${page.balloons.length} balloon${page.balloons.length === 1 ? '' : 's'}`)));
      if (l) inspectLetter(el, l);
      else inspectPage(el);
      if (l) el.append(presetControls(l));
    },
    down(p, e) {
      const now = performance.now();
      const dbl = now - lastDown < 320;
      lastDown = now;
      const q = toPt(p);
      const s = sel();
      if (s) {
        const hd = handles(s);
        const r = 8 / (ctx.scale() / PT);
        const near = (a: Pt) => Math.abs(a.x - q.x) <= r && Math.abs(a.y - q.y) <= r;
        const ti = hd.tails.findIndex(near);
        const start = () => ({ start: q, orig: structuredClone(s.cap), before: structuredClone(page.balloons), beforeBeats: JSON.stringify(page.beats), moved: false });
        if (ti >= 0) {
          drag = { id: s.id, grab: { kind: 'tail', index: ti }, ...start() };
          return;
        }
        if (near(hd.size)) {
          drag = { id: s.id, grab: { kind: 'size' }, ...start() };
          return;
        }
      }
      const hit = [...page.balloons].reverse().find((b) => hitLetter(b, sheet(), q, W, H));
      if (hit) {
        selId = hit.id;
        if (dbl) {
          cycleLine(hit);
          return;
        }
        drag = { id: hit.id, grab: { kind: 'body' }, start: q, orig: structuredClone(hit.cap), before: structuredClone(page.balloons), beforeBeats: JSON.stringify(page.beats), moved: false };
        ctx.chrome();
        return;
      }
      if (mode.tool === 'select') {
        selId = null;
        ctx.chrome();
        return;
      }
      void e;
      loop = [p];
      downAt = p;
    },
    move(p) {
      if (loop) {
        const last = loop[loop.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.scale() > 2) loop.push(p);
        return;
      }
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
      } else if (drag.grab.kind === 'tail') {
        const i = drag.grab.index;
        l.cap = { ...o, tails: o.tails.map((t, j) => (j === i ? { ...t, x: q.x, y: q.y } : t)) };
      } else {
        const b0 = letterBox({ ...l, cap: o }, sheet(), W, H);
        const a = Math.max(8, (b0.x1 - b0.x0) / 2 + dx / 2);
        const bb = Math.max(6, (b0.y1 - b0.y0) / 2 + dy / 2);
        l.cap = { ...o, minSize: [a, bb] };
      }
    },
    up(p) {
      if (loop) {
        const pts = loop;
        loop = null;
        const travel = pts.reduce((n, q, i) => (i ? n + Math.hypot(q.x - pts[i - 1]!.x, q.y - pts[i - 1]!.y) : 0), 0);
        if (travel * ctx.scale() > 40 && fromLoop(pts)) return;
        place(downAt ?? p, variantOf(mode, 'letter') as BalloonStyle);
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) commit(d.grab.kind === 'body' ? 'Move balloon' : d.grab.kind === 'tail' ? 'Aim tail' : 'Resize balloon', d.before, d.beforeBeats);
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
      if (l) {
        g.strokeStyle = '#B8432F';
        g.lineWidth = 1.5;
        g.beginPath();
        outline(l).forEach((p, i) => (i ? g.lineTo(p.x * k, p.y * k) : g.moveTo(p.x * k, p.y * k)));
        g.closePath();
        g.stroke();
        const hd = handles(l);
        const dot = (q: Pt, fill: string) => {
          g.fillStyle = fill;
          g.strokeStyle = '#191A1F';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(q.x * k, q.y * k, 6, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        };
        for (const t of hd.tails) dot(t, '#F2C230');
        dot(hd.size, '#FFFDF7');
      }
      if (loop && loop.length > 1) {
        g.strokeStyle = '#B8432F';
        g.lineWidth = 2;
        g.setLineDash([6, 5]);
        g.beginPath();
        loop.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
        g.stroke();
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
        selId = null;
        loop = null;
        ctx.chrome();
        ctx.request();
        return true;
      }
      return false;
    },
  };

  // ---- inspector: one letter
  function inspectLetter(el: HTMLElement, l: Letter): void {
    const c = l.cap;
    const sh = sheet();
    const sec = (title: string, ...kids: (Node | null)[]) => h('div', { class: 'sec stack' }, h('h4', {}, title), ...kids);
    const row = (label: string, control: Node) => h('label', { class: 'field' }, label, control);

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
    const beatIdx = l.src ? page.beats.findIndex((x) => x.id === l.src!.beat) : -1;
    const panel = beatIdx >= 0 && l.src ? dialoguePanel(page, ctx.panels(), page.beats[beatIdx]!, sourceIndex(page.beats[beatIdx]!, l.src)) : null;
    el.append(sec('Words', text,
      h('p', { class: 'note' }, beatIdx >= 0 ? `Beat ${beatIdx + 1}, line ${l.src!.line + 1}${panel ? ' · Panel ' + (panel.index + 1) : ''}. Text edits update the script.` : 'Free text.'),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        l.src ? h('button', { class: 'btn', type: 'button', onclick: () => cycleLine(l) }, 'Next line') : null,
        l.src ? h('button', { class: 'btn', type: 'button', onclick: () => edit('Unlink from script', () => { omitDialogue(page, l); delete l.src; delete l.generated; }) }, 'Unlink') : null,
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
        c.tails.length < 4 ? h('button', { class: 'btn', type: 'button', onclick: () => editCap('Add tail', (x) => ({ ...x, tails: [...x.tails, { x: x.x + 30 * (x.tails.length % 2 ? -1 : 1), y: x.y + 60, join: x.style === 'thought' ? 'bubbles' : 'merged', width: 1.2 }] })) }, '+ Add tail') : null,
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
