import type { Studio } from '../app/studio';
import { sheetOf, STAGES, type Book, type LayerType, type Page, type Pass, type PlacedImage, type Pt, type Stage } from '../doc/model';
import type { PageArt } from '../draw/residency';
import { derivePanels, type Panel } from '../geom/carve';
import { syncGroups } from '../geom/groups';
import { renderPage } from '../render/page';
import { drawBackdrop } from './backdrop';
import { drawComposition } from './composition';
import { spreadButton } from './spread';
import { openExport } from './exportdialog';
import { h, toast } from './dom';
import { closePopover, displayButton, popover } from './popover';
import { cssVar, onPrefs, prefs, setPrefs, setToolPrefs, toolPrefs } from './prefs';
import { scriptDesk } from './desks/script';
import { layoutDesk } from './desks/layout';
import { drawDesk } from './desks/draw';
import { captionDesk } from './desks/caption';
import { printDesk } from './desks/print';

export interface ToolVariant {
  id: string;
  label: string;
  glyph: string;
  key?: string;
}

export interface Tool {
  id: string;
  label: string;
  glyph: string;
  key?: string;
  /** Tools in the same group sit together on the rail, with a divider between groups. */
  group?: string;
  /** Sub-tools (CSP-style flyout). The chosen one is `variant`. */
  variants?: ToolVariant[];
  variant?: string;
}

/** What a desk mode can use from the desk frame. */
export interface DeskCtx {
  studio: Studio;
  book: Book;
  page: Page;
  art: PageArt;
  /** Panels derived from the current cuts (cached until the cuts change). */
  panels(): Panel[];
  /** Redraw the page soon. */
  request(): void;
  /** Rebuild the rail, context bar and inspector. */
  chrome(): void;
  /** Page inches → CSS px on the stage, and back. */
  scale(): number;
  toPage(e: { clientX: number; clientY: number }): Pt;
  /** Choose a tool's variant (remembered per device). */
  setVariant(toolId: string, variant: string): void;
  stage: HTMLElement;
}

export interface DeskMode {
  id: Stage;
  tools: Tool[];
  tool: string;
  /** A full-pane desk (script) shows its own UI over the stage. */
  pane?(host: HTMLElement): void;
  ctx(host: HTMLElement): void;
  inspector(host: HTMLElement): void;
  cursor?(): string;
  down?(p: Pt, e: PointerEvent): void;
  move?(p: Pt, e: PointerEvent): void;
  up?(p: Pt, e: PointerEvent): void;
  hover?(p: Pt | null): void;
  overlay?(g: CanvasRenderingContext2D, s: number): void;
  live?(): Partial<Record<Pass, HTMLCanvasElement>>;
  placement?(): { id: string; image: PlacedImage } | undefined;
  types?(): Partial<Record<LayerType, boolean>>;
  skipBalloon?(): string | undefined;
  key?(e: KeyboardEvent): boolean;
  dispose?(): void;
}

/** The chosen variant of a tool (or its first). */
export function variantOf(mode: Pick<DeskMode, 'tools'>, toolId: string): string {
  const t = mode.tools.find((x) => x.id === toolId);
  return t?.variant ?? t?.variants?.[0]?.id ?? '';
}

export const DESK_META: Record<Stage, { label: string; glyph: string; note: string }> = {
  script: { label: 'Script', glyph: '✎', note: 'beats' },
  layout: { label: 'Layout', glyph: '▦', note: 'panels' },
  draw: { label: 'Draw', glyph: '✒', note: 'pencil · ink · colour' },
  caption: { label: 'Caption', glyph: '❝', note: 'balloons' },
  print: { label: 'Print', glyph: '⎙', note: 'preflight' },
};

const MODES: Record<Stage, (ctx: DeskCtx) => DeskMode> = {
  script: scriptDesk,
  layout: layoutDesk,
  draw: drawDesk,
  caption: captionDesk,
  print: printDesk,
};

const STATE_LABEL = ['to do', 'in progress', 'done'];

export async function renderDesk(root: HTMLElement, studio: Studio, bookId: string, pageId: string, stage: Stage, go: (hash: string) => void): Promise<() => void> {
  const book = await studio.openBook(bookId);
  const page = book.pages.find((p) => p.id === pageId) ?? book.pages[0]!;
  if (page.id !== pageId) {
    go(`#desk/${book.id}/${page.id}/${stage}`);
    return () => {};
  }
  const art = await studio.focus(page);
  const composition = stage === 'layout' || stage === 'draw' || stage === 'caption';
  await studio.residency.pin(art);
  studio.setLast(page, stage);
  if (page.state[stage] === 0) studio.markStage(page, stage, 1);

  // ---- view state
  const view = { zoom: 1, panX: 0, panY: 0 };
  const stageEl = h('div', { class: 'stagearea' });
  const canvas = h('canvas', { class: 'view', role: 'img', 'aria-label': `Page ${studio.pageNumber(page)}` });
  stageEl.append(canvas);
  let panelsKey = '';
  let panelsCache: Panel[] = [];
  const geom = () => {
    const r = stageEl.getBoundingClientRect();
    const fit = Math.min((r.width - 56) / page.widthIn, (r.height - 56) / page.heightIn);
    const s = Math.max(4, fit * view.zoom);
    const ox = (r.width - page.widthIn * s) / 2 + view.panX;
    const oy = (r.height - page.heightIn * s) / 2 + view.panY;
    return { r, s, ox, oy };
  };

  let raf = 0;
  const ctx: DeskCtx = {
    studio,
    book,
    page,
    art,
    panels: () => {
      const key = JSON.stringify([page.cuts, page.layout, page.widthIn, page.heightIn]);
      if (key !== panelsKey) {
        panelsKey = key;
        panelsCache = derivePanels(page);
        // every panel gets its layer group; not an undo step (empty groups only)
        if (syncGroups(page, panelsCache)) studio.saver.markDirty();
      }
      return panelsCache;
    },
    request: () => {
      if (!raf) raf = requestAnimationFrame(draw);
    },
    chrome: () => chrome(),
    scale: () => geom().s,
    toPage: (e) => {
      const { r, s, ox, oy } = geom();
      return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
    },
    setVariant: (toolId, v) => {
      const t = mode.tools.find((x) => x.id === toolId);
      if (!t) return;
      t.variant = v;
      setToolPrefs(stage, { variants: { ...toolPrefs(stage).variants, [toolId]: v } });
      chrome();
      ctx.request();
    },
    stage: stageEl,
  };
  const mode = MODES[stage](ctx);
  // remembered variants
  for (const t of mode.tools) {
    const v = toolPrefs(stage).variants?.[t.id];
    if (t.variants?.some((x) => x.id === v)) t.variant = v;
    else if (t.variants && !t.variant) t.variant = t.variants[0]!.id;
  }

  // theme colours for the canvas, re-read when the theme changes
  let colors = readColors();
  function readColors() {
    return { board: cssVar('--board'), grid: cssVar('--board-grid'), vignetteColor: cssVar('--board-vignette'), shadow: cssVar('--page-shadow') };
  }

  function draw(): void {
    raf = 0;
    const { r, s, ox, oy } = geom();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const hgt = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = prefs();
    drawBackdrop(g, { width: r.width, height: r.height, ox, oy, s, pageW: page.widthIn, pageH: page.heightIn }, { ...colors, kind: p.backdrop, strength: p.gridOpacity, vignette: p.vignette });
    g.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    renderPage(g, page, art, { scale: s, types: mode.types?.(), live: mode.live?.(), placement: mode.placement?.(), panels: ctx.panels(), skipBalloon: mode.skipBalloon?.(), sheet: sheetOf(book) });
    if (composition) drawComposition(g, p.guide, page.widthIn, page.heightIn, s);
    mode.overlay?.(g, s);
    stageEl.dataset.cursor = mode.cursor?.() ?? '';
  }

  // ---- input
  let panning: { x: number; y: number; px: number; py: number } | null = null;
  let spaceDown = false;
  // capture can fail for a pointer the browser no longer tracks; drawing still works without it
  const capture = (id: number) => {
    try {
      stageEl.setPointerCapture(id);
    } catch {
      // ignore
    }
  };
  stageEl.addEventListener('pointerdown', (e) => {
    if (mode.pane) return;
    closePopover();
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      panning = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
      capture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    capture(e.pointerId);
    mode.down?.(ctx.toPage(e), e);
    ctx.request();
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (panning) {
      view.panX = panning.px + e.clientX - panning.x;
      view.panY = panning.py + e.clientY - panning.y;
      ctx.request();
      return;
    }
    const p = ctx.toPage(e);
    if (e.buttons & 1) {
      // coalesced events give the pen's full rate
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) mode.move?.(ctx.toPage(ev), ev);
    } else mode.hover?.(p);
    ctx.request();
  });
  const end = (e: PointerEvent) => {
    if (panning) {
      panning = null;
      return;
    }
    mode.up?.(ctx.toPage(e), e);
    ctx.request();
  };
  stageEl.addEventListener('pointerup', end);
  stageEl.addEventListener('pointercancel', end);
  stageEl.addEventListener('pointerleave', () => {
    mode.hover?.(null);
    ctx.request();
  });
  stageEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const before = ctx.toPage(e);
        view.zoom = Math.max(0.4, Math.min(8, view.zoom * Math.exp(-e.deltaY * 0.0025)));
        const { r, s, ox, oy } = geom();
        view.panX += e.clientX - r.left - (ox + before.x * s);
        view.panY += e.clientY - r.top - (oy + before.y * s);
      } else {
        view.panX -= e.deltaX;
        view.panY -= e.deltaY;
      }
      ctx.request();
    },
    { passive: false },
  );

  // ---- tool rail: groups, flyouts, customization
  const toolRail = h('nav', { class: 'rail', 'aria-label': 'Tools' });
  const ctxBar = h('div', { class: 'ctx', role: 'toolbar', 'aria-label': 'Tool settings' });
  const insp = h('aside', { class: 'insp', 'aria-label': 'Inspector' });
  const paneHost = h('div', { class: 'pane' });

  /** Tools in the user's order, without hidden ones (the active tool always shows). */
  function railTools() {
    const tp = toolPrefs(stage);
    const order = tp.order ?? [];
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i < 0 ? 1000 + mode.tools.findIndex((t) => t.id === id) : i;
    };
    return [...mode.tools].sort((a, b) => rank(a.id) - rank(b.id)).filter((t) => t.id === mode.tool || !(tp.hidden ?? []).includes(t.id));
  }

  function selectTool(id: string): void {
    mode.tool = id;
    chrome();
    ctx.request();
  }

  function flyout(t: Tool, anchor: HTMLElement): void {
    const focus = prefs().layout === 'focus';
    popover(anchor, h('div', { role: 'menu', 'aria-label': `${t.label} options` },
      h('h4', {}, t.label),
      t.variants!.map((v) =>
        h('button', { class: 'item', type: 'button', role: 'menuitemradio', 'aria-checked': String(v.id === t.variant), onclick: () => { closePopover(); mode.tool = t.id; ctx.setVariant(t.id, v.id); } },
          h('span', { 'aria-hidden': 'true' }, v.glyph), v.label, v.key ? h('kbd', {}, v.key.toUpperCase()) : null))), focus ? 'below' : 'right', `${t.label} options`);
  }

  function customize(anchor: HTMLElement): void {
    const build = (): HTMLElement => {
      const tp = toolPrefs(stage);
      const hidden = new Set(tp.hidden ?? []);
      const list = railToolsAll();
      const move = (i: number, d: number) => {
        const ids = list.map((t) => t.id);
        const [x] = ids.splice(i, 1);
        ids.splice(i + d, 0, x!);
        setToolPrefs(stage, { order: ids });
        holder.replaceChildren(build());
      };
      return h('div', { style: 'width:250px' },
        h('h4', {}, `${DESK_META[stage].label} tools`),
        list.map((t, i) => {
          const box = h('input', { type: 'checkbox', checked: !hidden.has(t.id), 'aria-label': `Show ${t.label}` });
          box.addEventListener('change', () => {
            const next = new Set(toolPrefs(stage).hidden ?? []);
            if (box.checked) next.delete(t.id);
            else next.add(t.id);
            setToolPrefs(stage, { hidden: [...next] });
          });
          return h('div', { class: 'row' },
            h('label', {}, box, h('span', { 'aria-hidden': 'true' }, t.glyph), t.label),
            h('button', { type: 'button', 'aria-label': `Move ${t.label} up`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
            h('button', { type: 'button', 'aria-label': `Move ${t.label} down`, disabled: i === list.length - 1, onclick: () => move(i, 1) }, '↓'));
        }),
        h('div', { class: 'sep' }),
        h('button', { class: 'item', type: 'button', onclick: () => { setToolPrefs(stage, null); holder.replaceChildren(build()); } }, h('span', { 'aria-hidden': 'true' }, '↺'), 'Restore defaults'),
        h('p', { class: 'note', style: 'margin:4px 8px' }, 'Hidden tools keep their shortcut keys.'));
    };
    const railToolsAll = () => {
      const order = toolPrefs(stage).order ?? [];
      const rank = (id: string) => {
        const i = order.indexOf(id);
        return i < 0 ? 1000 + mode.tools.findIndex((t) => t.id === id) : i;
      };
      return [...mode.tools].sort((a, b) => rank(a.id) - rank(b.id));
    };
    const holder = h('div', {}, build());
    popover(anchor, holder, prefs().layout === 'focus' ? 'below' : 'right', 'Customize tools');
  }

  function renderRail(): void {
    const items: HTMLElement[] = [];
    let group: string | undefined;
    for (const t of railTools()) {
      if (items.length && t.group !== group) items.push(h('hr', { 'aria-hidden': 'true' }));
      group = t.group;
      const v = t.variants?.find((x) => x.id === t.variant);
      const label = v ? `${t.label}: ${v.label}` : t.label;
      const b = h('button', { class: 'tool', type: 'button', 'aria-pressed': String(t.id === mode.tool), 'aria-haspopup': t.variants ? 'menu' : null,
        title: `${label}${t.key ? ` (${t.key.toUpperCase()})` : ''}${t.variants ? ' · click again or right-click for options' : ''}` },
        h('span', { 'aria-hidden': 'true' }, v?.glyph ?? t.glyph), h('em', {}, t.label), t.variants ? h('i', { class: 'more', 'aria-hidden': 'true' }) : null);
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => {
        if (t.variants && mode.tool === t.id) flyout(t, b);
        else selectTool(t.id);
      });
      b.addEventListener('contextmenu', (e) => {
        if (!t.variants) return;
        e.preventDefault();
        flyout(t, b);
      });
      let hold = 0;
      b.addEventListener('pointerdown', (e) => {
        if (!t.variants || e.pointerType === 'mouse') return;
        hold = window.setTimeout(() => flyout(t, b), 450);
      });
      b.addEventListener('pointerup', () => clearTimeout(hold));
      b.addEventListener('pointerleave', () => clearTimeout(hold));
      items.push(b);
    }
    const opt = h('button', { class: 'railopt', type: 'button', 'aria-label': 'Customize tools', title: 'Customize tools' }, '⋯');
    opt.addEventListener('click', () => customize(opt));
    toolRail.replaceChildren(...items, opt);
  }

  function chrome(): void {
    renderRail();
    const t = mode.tools.find((x) => x.id === mode.tool);
    const v = t?.variants?.find((x) => x.id === t.variant);
    ctxBar.replaceChildren(h('span', { class: 'ctx-name' }, v ? `${t!.label} · ${v.label}` : t?.label ?? DESK_META[stage].label));
    mode.ctx(ctxBar);
    insp.replaceChildren();
    mode.inspector(insp);
    if (mode.pane) mode.pane(paneHost);
  }

  // ---- header, focus corner, stage rail
  const idx = book.pages.indexOf(page);
  const pageHash = (i: number) => `#desk/${book.id}/${book.pages[i]!.id}/${stage}`;
  const jump = () => {
    const list = h('div', { class: 'page-jump' }, book.pages.map((item, i) => h('button', {
      class: i === idx ? 'btn primary' : 'btn', type: 'button', 'aria-current': i === idx ? 'page' : null,
      onclick: () => { d.close(); if (i !== idx) go(pageHash(i)); },
    }, h('strong', {}, 'Page ' + (i + 1)), item.beats[0]?.desc ? h('small', {}, item.beats[0].desc) : null)));
    const d = h('dialog', { 'aria-label': 'Jump to page' },
      h('header', {}, h('h2', {}, 'Jump to page')),
      h('div', { class: 'content' }, list),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close')));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    list.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
  };
  const save = h('span', { class: 'save', 'aria-live': 'polite' });
  const undoBtns: HTMLButtonElement[] = [];
  const redoBtns: HTMLButtonElement[] = [];
  const undoBtn = () => {
    const b = h('button', { class: 'icon', type: 'button', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => studio.undo() }, '↶');
    undoBtns.push(b);
    return b;
  };
  const redoBtn = () => {
    const b = h('button', { class: 'icon', type: 'button', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => studio.redo() }, '↷');
    redoBtns.push(b);
    return b;
  };
  const status = () => {
    save.dataset.state = studio.saveState;
    save.textContent = { idle: '', dirty: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: `Not saved: ${studio.saver.error ?? ''}` }[studio.saveState];
    for (const b of undoBtns) b.disabled = !studio.history.canUndo;
    for (const b of redoBtns) b.disabled = !studio.history.canRedo;
  };

  const rail = h('nav', { class: 'stagerail', 'aria-label': 'Desks' },
    STAGES.map((s, i) =>
      h('button', { type: 'button', 'aria-current': String(s === stage), title: `${DESK_META[s].label} (${i + 1})`, onclick: () => go(`#desk/${book.id}/${page.id}/${s}`) },
        h('span', { 'aria-hidden': 'true' }, DESK_META[s].glyph), h('b', {}, DESK_META[s].label), h('small', {}, STATE_LABEL[page.state[s]]))),
  );

  const doneBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    const next = page.state[stage] === 2 ? 1 : 2;
    page.state[stage] = next;
    studio.saver.markDirty();
    doneBtn.textContent = next === 2 ? 'Done ✓' : 'Mark done';
    rail.querySelector('[aria-current="true"] small')!.textContent = STATE_LABEL[next]!;
  } }, page.state[stage] === 2 ? 'Done ✓' : 'Mark done');

  const layoutBtn = (glyph: string, label: string) => h('button', { class: 'icon', type: 'button', 'aria-label': label, title: `${label} (Tab)`, onclick: () => toggleLayout() }, glyph);
  const inspBtn = h('button', { class: 'icon', type: 'button', 'aria-label': 'Show inspector', 'aria-pressed': 'false', title: 'Inspector' }, '☰');
  const narrowInspector = h('button', { class: 'btn studio-inspector-toggle', type: 'button', 'aria-label': 'Show inspector', 'aria-pressed': 'false' }, 'Inspector');
  const deskSelect = h('select', { 'aria-label': 'Desk' }, STAGES.map((s) => h('option', { value: s, selected: s === stage }, DESK_META[s].label)));
  deskSelect.addEventListener('change', () => go(`#desk/${book.id}/${page.id}/${deskSelect.value}`));
  const screen = h('div', { class: 'screen', 'data-desk': stage },
    h('header', { class: 'bar', style: 'height:52px' },
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Back to book', onclick: () => go(`#book/${book.id}`) }, '←'),
      h('div', { class: 'crumb' }, h('a', { href: `#book/${book.id}` }, book.title), h('b', {}, '/'), h('strong', {}, `Page ${idx + 1}`), h('b', {}, '/'), DESK_META[stage].label),
      h('span', { class: 'spacer' }),
      h('div', { class: 'pager' },
        h('button', { type: 'button', 'aria-label': 'Previous page', disabled: idx === 0, onclick: () => go(pageHash(idx - 1)) }, '‹'),
        h('button', { type: 'button', class: 'page-jump-trigger', 'aria-label': 'Jump to page', title: 'Jump to page', onclick: jump }, `${idx + 1} / ${book.pages.length} ▾`),
        h('button', { type: 'button', 'aria-label': 'Next page', disabled: idx === book.pages.length - 1, onclick: () => go(pageHash(idx + 1)) }, '›')),
      save, undoBtn(), redoBtn(), narrowInspector, spreadButton(studio, page, stage, go), displayButton(true, composition), layoutBtn('⤢', 'Focus layout'), doneBtn,
      h('button', { class: 'btn', type: 'button', onclick: () => openExport(studio, stage === 'print' ? 'print' : 'files') }, 'Export')),
    ctxBar,
    h('div', { class: `work${mode.tools.length ? '' : ' norail'}` }, toolRail, stageEl, insp),
    rail,
    h('div', { class: 'focus-corner', role: 'toolbar', 'aria-label': 'Focus controls' },
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Back to book', onclick: () => go(`#book/${book.id}`) }, '←'),
      deskSelect,
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Previous page', disabled: idx === 0, onclick: () => go(pageHash(idx - 1)) }, '‹'),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Jump to page', title: 'Jump to page', onclick: jump }, String(idx + 1)),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Next page', disabled: idx === book.pages.length - 1, onclick: () => go(pageHash(idx + 1)) }, '›'),
      undoBtn(), redoBtn(), inspBtn, spreadButton(studio, page, stage, go, true), displayButton(true, composition), layoutBtn('⤡', 'Studio layout')),
  );
  const toggleInspector = () => {
    const on = !screen.classList.contains('insp-open');
    screen.classList.toggle('insp-open', on);
    for (const b of [inspBtn, narrowInspector]) {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Hide inspector' : 'Show inspector');
    }
  };
  inspBtn.addEventListener('click', toggleInspector);
  narrowInspector.addEventListener('click', toggleInspector);
  root.replaceChildren(screen);
  if (mode.pane) stageEl.append(paneHost);

  function applyLayout(): void {
    screen.classList.toggle('focus', prefs().layout === 'focus');
  }
  function toggleLayout(): void {
    const next = prefs().layout === 'focus' ? 'studio' : 'focus';
    setPrefs({ layout: next });
    toast(next === 'focus' ? 'Focus layout · Tab or ⤡ returns to Studio' : 'Studio layout', 1600);
  }
  applyLayout();
  chrome();
  status();

  const ro = new ResizeObserver(() => ctx.request());
  ro.observe(stageEl);
  const offStudio = studio.on(() => {
    status();
    ctx.request();
  });
  const offPrefs = onPrefs(() => {
    colors = readColors();
    applyLayout();
    renderRail();
    ctx.request();
  });
  // own edits refresh their panels themselves; undo/redo may change anything they show
  const onUndo = () => {
    chrome();
    ctx.request();
  };
  studio.afterUndo.add(onUndo);
  const offHistory = () => studio.afterUndo.delete(onUndo);
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) studio.redo();
      else studio.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      if (typing) return;
      e.preventDefault();
      studio.redo();
      return;
    }
    if (typing || t?.closest('.layer-picker')) return;
    // Tab toggles the layout only when nothing has keyboard focus, so Tab still moves focus
    if (e.key === 'Tab' && !e.shiftKey && (document.activeElement === document.body || document.activeElement === null)) {
      e.preventDefault();
      toggleLayout();
      return;
    }
    if (e.key === ' ') {
      spaceDown = true;
      return;
    }
    if (mode.key?.(e)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 5) {
      go(`#desk/${book.id}/${page.id}/${STAGES[n - 1]}`);
      return;
    }
    const k = e.key.toLowerCase();
    for (const tool of mode.tools) {
      const v = tool.variants?.find((x) => x.key?.toLowerCase() === k);
      if (v) {
        mode.tool = tool.id;
        ctx.setVariant(tool.id, v.id);
        return;
      }
      if (tool.key?.toLowerCase() === k) {
        selectTool(tool.id);
        return;
      }
    }
    if (e.key === '0') {
      view.zoom = 1;
      view.panX = view.panY = 0;
      ctx.request();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') spaceDown = false;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  ctx.request();

  return () => {
    ro.disconnect();
    offStudio();
    offPrefs();
    offHistory();
    closePopover();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    mode.dispose?.();
    studio.residency.unpin(art);
    if (raf) cancelAnimationFrame(raf);
  };
}
