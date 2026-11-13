import type { Studio } from '../app/studio';
import { sheetOf, STAGES, type Book, type LayerType, type Page, type Pass, type PlacedImage, type Pt, type Stage } from '../doc/model';
import type { PageArt } from '../draw/residency';
import { derivePanels, type Panel } from '../geom/carve';
import { printOf } from '../geom/printkinds';
import { syncGroups } from '../geom/groups';
import { renderPage } from '../render/page';
import { anchorCanvasView, bearing, canvasGeometry, clampZoom, HOME_VIEW, MAX_ZOOM, midpoint, MIN_ZOOM, normalizeAngle } from './canvasview';
import { drawBackdrop } from './backdrop';
import { drawComposition } from './composition';
import { spreadButton } from './spread';
import { openExport } from './exportdialog';
import { glyphEl, icon } from './icons';
import { openManual } from './manual';
import { copyToClipboard, pasteFromSystem, readClipboard, type ClipPayload } from '../app/clipboard';
import { h, slider, toast } from './dom';
import { closePopover, displayButton, displayMenu, popover } from './popover';
import { clustersFor, type ChromeAction } from './chrome';
import { autoHideChrome, chromeActions } from './chromeview';
import { messageBar, type HintOptions } from './messagebar';
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
  openInspector(trigger?: HTMLElement): void;
  /** Page inches → CSS px on the stage, and back. */
  scale(): number;
  toPage(e: { clientX: number; clientY: number }): Pt;
  /** Express a screen-space direction in page axes. */
  toPageDirection(vector: Pt): Pt;
  /** Choose a tool's variant (remembered per device). */
  setVariant(toolId: string, variant: string): void;
  stage: HTMLElement;
  hint(text: string, options?: HintOptions): void;
}

/** One row of the canvas right-click menu, or a separator. */
export type MenuItem = { label: string; run: () => void; disabled?: boolean; checked?: boolean; key?: string } | 'sep';

export interface DeskMode {
  id: Stage;
  tools: Tool[];
  tool: string;
  /** A full-pane desk (script) shows its own UI over the stage. */
  pane?(host: HTMLElement): void;
  ctx(host: HTMLElement): void;
  actions?: ChromeAction[];
  sidebar?: HTMLElement;
  resetOptions?: () => void;
  inspector(host: HTMLElement): void;
  cursor?(): string;
  down?(p: Pt, e: PointerEvent): void;
  move?(p: Pt, e: PointerEvent): void;
  up?(p: Pt, e: PointerEvent): void;
  modifierTouch?(active: boolean): void;
  hover?(p: Pt | null): void;
  overlay?(g: CanvasRenderingContext2D, s: number): void;
  live?(): Partial<Record<Pass, HTMLCanvasElement>>;
  placement?(): { id: string; image: PlacedImage } | undefined;
  viewBleed?(): boolean;
  layoutPreview?(): { page: Page; panels: Panel[] } | undefined;
  types?(): Partial<Record<LayerType, boolean>>;
  skipBalloon?(): string | undefined;
  key?(e: KeyboardEvent): boolean;
  /** Right-click on the canvas: this desk's actions for the point under the pointer. */
  contextMenu?(p: Pt): MenuItem[];
  /** What Copy takes from this desk right now (a selection), or null. */
  copy?(): ClipPayload | null;
  /** Paste here, centred at `at` (page inches). False when this desk can't take that kind. */
  paste?(clip: ClipPayload, at: Pt): boolean;
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
  const view = { ...HOME_VIEW };
  const stageEl = h('div', { class: 'stagearea' });
  const canvas = h('canvas', { class: 'view', role: 'img', 'aria-label': `Page ${studio.pageNumber(page)}` });
  stageEl.append(canvas);
  let panelsKey = '';
  let panelsCache: Panel[] = [];
  let stageRect = stageEl.getBoundingClientRect();
  const pageSize = () => ({ width: page.widthIn, height: page.heightIn });
  const geom = () => canvasGeometry(stageRect, pageSize(), view);
  const local = (p: Pt): Pt => ({ x: p.x - stageRect.left, y: p.y - stageRect.top });
  function changeView(position: Pt, anchor: Pt, zoom: number, angle: number): void {
    view.zoom = clampZoom(zoom);
    view.angle = normalizeAngle(angle);
    anchorCanvasView(stageRect, pageSize(), view, anchor, position);
    ctx.request();
  }
  function resetView(): void {
    Object.assign(view, HOME_VIEW);
    ctx.request();
  }

  const message = messageBar();
  let raf = 0;
  /** Where the pointer last was on the page: keyboard pastes land there. */
  let lastPointer: Pt | null = null;
  let fullFrame = true;
  let pageCache: HTMLCanvasElement | null = null;
  const ctx: DeskCtx = {
    studio,
    hint: message.hint,
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
      fullFrame = true;
      if (!raf) raf = requestAnimationFrame(draw);
    },
    chrome: () => chrome(),
    openInspector: (trigger) => { if (!screen.classList.contains('insp-open')) toggleInspector(trigger); },
    scale: () => geom().s,
    toPage: (e) => geom().toPage(local({ x: e.clientX, y: e.clientY })),
    toPageDirection: (vector) => {
      const { cos, sin } = geom();
      return { x: cos * vector.x + sin * vector.y, y: -sin * vector.x + cos * vector.y };
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
  // A separate plane lets transparent gutters reveal the board.
  const paper = document.createElement('canvas');
  function readColors() {
    return { board: cssVar('--board'), grid: cssVar('--board-grid'), vignetteColor: cssVar('--board-vignette'), shadow: cssVar('--page-shadow') };
  }

  /** Pointer hover only changes overlays: those frames reuse the last rendered page. */
  function requestOverlay(): void {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function draw(): void {
    raf = 0;
    const full = fullFrame;
    fullFrame = false;
    stageRect = stageEl.getBoundingClientRect();
    const r = stageRect;
    const { s, ox, oy, cos, sin } = geom();
    const pageTransform = (target: CanvasRenderingContext2D) => target.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, ox * dpr, oy * dpr);
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
    // a hover frame: put back the page as last rendered and redraw only what lies on top
    if (!full && pageCache && pageCache.width === w && pageCache.height === hgt) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(pageCache, 0, 0);
      pageTransform(g);
      mode.overlay?.(g, s);
      stageEl.dataset.cursor = mode.cursor?.() ?? '';
      return;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = prefs();
    // fast resampling while a gesture runs; a gesture's end requests one sharp frame
    const gesture = primaryPointer !== null || pinch !== null || panning !== null;
    const layout = mode.layoutPreview?.();
    const shownPage = layout?.page ?? page;
    const transparent = shownPage.layout?.gutterPaper === null;
    drawBackdrop(g, { width: r.width, height: r.height, ox, oy, s, pageW: page.widthIn, pageH: page.heightIn, angle: view.angle, transparent }, { ...colors, kind: p.backdrop, strength: p.gridOpacity, brightness: p.boardBrightness, vignette: p.vignette });
    const pageG = transparent ? paper.getContext('2d')! : g;
    if (transparent) {
      if (paper.width !== w || paper.height !== hgt) { paper.width = w; paper.height = hgt; }
      pageG.resetTransform(); pageG.clearRect(0, 0, w, hgt);
    }
    pageTransform(pageG);
    renderPage(pageG, shownPage, art, { scale: s, smoothing: gesture ? 'low' : 'high', bleed: mode.viewBleed?.() ? printOf(book).bleed : 0, types: mode.types?.(), live: mode.live?.(), placement: mode.placement?.(), panels: layout?.panels ?? ctx.panels(), skipBalloon: mode.skipBalloon?.(), sheet: sheetOf(book) });
    if (transparent) {
      g.resetTransform(); g.drawImage(paper, 0, 0);
      pageTransform(g);
    }
    if (composition) drawComposition(g, p.guide, page.widthIn, page.heightIn, s);
    // keep the settled page for hover frames (not mid-gesture: hover does not happen then)
    if (!gesture) {
      if (!pageCache) pageCache = document.createElement('canvas');
      if (pageCache.width !== w || pageCache.height !== hgt) { pageCache.width = w; pageCache.height = hgt; }
      const c = pageCache.getContext('2d')!;
      c.globalCompositeOperation = 'copy';
      c.drawImage(canvas, 0, 0);
      c.globalCompositeOperation = 'source-over';
      pageTransform(g);
    } else if (pageCache) pageCache.width = 0;
    mode.overlay?.(g, s);
    stageEl.dataset.cursor = mode.cursor?.() ?? '';
    const viewText = Math.round(view.zoom * 100) + '% · ' + Math.round(view.angle) + '°';
    for (const status of viewReadouts) if (status.textContent !== viewText) status.textContent = viewText;
  }

  // ---- input
  let panning: { x: number; y: number; px: number; py: number } | null = null;
  let spaceDown = false;
  let primaryPointer: number | null = null;
  let modifierPointer: number | null = null;
  let boardTouch: { x: number; y: number; px: number; py: number } | null = null;
  let finger: { first: PointerEvent; last: PointerEvent; started: boolean } | null = null;
  let pinch: { id: number; a: Pt; b: Pt; startA: Pt; startB: Pt; distance: number; zoom: number; angle: number; bearing: number; anchor: Pt; at: number; moved: boolean; third?: number } | null = null;
  // capture can fail for a pointer the browser no longer tracks; drawing still works without it
  const capture = (id: number) => {
    try {
      stageEl.setPointerCapture(id);
    } catch {
      // ignore
    }
  };
  // Touch: hold one finger still to open the canvas menu (the right-click of a tablet). The
  // gesture stays alive: moving on closes the menu and the swipe carries on (a slow knife cut);
  // lifting without moving keeps the menu and the press does nothing else.
  let longPress: { id: number; x: number; y: number; timer: number; opened: boolean } | null = null;
  const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  };
  const startLongPress = (e: PointerEvent) => {
    cancelLongPress();
    const id = e.pointerId, x = e.clientX, y = e.clientY;
    const press = { id, x, y, opened: false, timer: 0 };
    press.timer = window.setTimeout(() => {
      if (longPress !== press || primaryPointer !== id || pinch || finger?.started) return;
      press.opened = true;
      navigator.vibrate?.(12);
      openCanvasMenu(ctx.toPage({ clientX: x, clientY: y } as PointerEvent), x, y);
    }, 550);
    longPress = press;
  };
  stageEl.addEventListener('pointerdown', (e) => {
    if (mode.pane) return;
    stageRect = stageEl.getBoundingClientRect();
    if (primaryPointer !== null) {
      cancelLongPress();
      if (pinch && e.pointerType === 'touch') {
        if (pinch.third === undefined) { pinch.third = e.pointerId; capture(e.pointerId); }
        e.preventDefault(); return;
      }
      if ((boardTouch || finger) && !pinch && e.pointerType === 'touch') {
        const a = finger ? { x: finger.last.clientX, y: finger.last.clientY } : { x: boardTouch!.x + view.panX - boardTouch!.px, y: boardTouch!.y + view.panY - boardTouch!.py };
        if (finger?.started) mode.up?.(ctx.toPage(finger.last), new PointerEvent('pointercancel', { pointerType: 'touch' }));
        finger = null;
        const b = { x: e.clientX, y: e.clientY };
        const anchor = geom().toPage(local(midpoint(a, b)));
        pinch = {
          id: e.pointerId, a, b, startA: a, startB: b, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: view.zoom, angle: view.angle, bearing: bearing(a, b), anchor, at: performance.now(), moved: false,
        };
        mode.hover?.(null);
        e.preventDefault(); capture(e.pointerId); return;
      }
      if (mode.modifierTouch && !panning && e.pointerType === 'touch' && modifierPointer === null) {
        e.preventDefault();
        modifierPointer = e.pointerId;
        capture(e.pointerId);
        mode.modifierTouch(true);
      }
      return;
    }
    closePopover();
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      primaryPointer = e.pointerId;
      panning = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
      capture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    primaryPointer = e.pointerId;
    e.preventDefault();
    capture(e.pointerId);
    const p = ctx.toPage(e);
    const offPage = p.x < 0 || p.y < 0 || p.x > page.widthIn || p.y > page.heightIn;
    if (e.pointerType === 'touch' && ((stage === 'draw' && !prefs().fingerDrawing) || (offPage && !(stage === 'layout' && (mode.tool === 'knife' || mode.tool === 'place'))))) {
      boardTouch = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
    } else if (e.pointerType === 'touch') finger = { first: e, last: e, started: false };
    else mode.down?.(p, e);
    if (e.pointerType === 'touch') startLongPress(e);
    ctx.request();
  });
  // Right-click (or a two-finger long press reported as contextmenu): practical actions here.
  stageEl.addEventListener('contextmenu', (e) => {
    if (mode.pane) return;
    e.preventDefault();
    if (primaryPointer !== null) return;
    stageRect = stageEl.getBoundingClientRect();
    openCanvasMenu(ctx.toPage(e), e.clientX, e.clientY);
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!mode.pane) lastPointer = ctx.toPage(e);
    if (longPress && e.pointerId === longPress.id && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) {
      if (longPress.opened) closePopover();
      cancelLongPress();
    }
    if (pinch && (e.pointerId === primaryPointer || e.pointerId === pinch.id)) {
      const which = e.pointerId === primaryPointer ? 'a' : 'b';
      pinch[which] = { x: e.clientX, y: e.clientY };
      const { a, b, startA, startB, distance, zoom, angle, anchor } = pinch;
      pinch.moved ||= Math.max(Math.hypot(a.x - startA.x, a.y - startA.y), Math.hypot(b.x - startB.x, b.y - startB.y)) > 4;
      if (pinch.moved) {
        const separation = Math.hypot(a.x - b.x, a.y - b.y);
        const turn = separation > 8 ? bearing(a, b) - pinch.bearing : view.angle - angle;
        changeView(local(midpoint(a, b)), anchor, zoom * separation / distance, angle + turn);
      }
      return;
    }
    if (primaryPointer !== null && e.pointerId !== primaryPointer) return;
    if (finger && e.pointerId === primaryPointer) {
      finger.last = e;
      if (!finger.started) {
        if (Math.hypot(e.clientX - finger.first.clientX, e.clientY - finger.first.clientY) < 3) return;
        finger.started = true;
        mode.down?.(ctx.toPage(finger.first), finger.first);
      }
    }
    if (panning) {
      view.panX = panning.px + e.clientX - panning.x;
      view.panY = panning.py + e.clientY - panning.y;
      ctx.request();
      return;
    }
    if (boardTouch && e.pointerId === primaryPointer) {
      view.panX = boardTouch.px + e.clientX - boardTouch.x;
      view.panY = boardTouch.py + e.clientY - boardTouch.y;
      ctx.request(); return;
    }
    const p = ctx.toPage(e);
    if (e.pointerId === primaryPointer && ((e.buttons & 1) || e.pointerType === 'touch')) {
      // coalesced events give the pen's full rate
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) mode.move?.(ctx.toPage(ev), ev);
    } else {
      // hover changes only overlays (cursor, previews); a mode that changes more requests a full frame
      mode.hover?.(p);
      requestOverlay();
      return;
    }
    ctx.request();
  });
  const end = (e: PointerEvent) => {
    ctx.request(); // the frame after a gesture is drawn sharp again
    if (longPress?.id === e.pointerId) {
      const opened = longPress.opened;
      cancelLongPress();
      if (opened) {
        // the press became the menu: it neither taps nor draws
        primaryPointer = null;
        finger = null;
        boardTouch = null;
        return;
      }
    }
    if (pinch && e.pointerId === pinch.third) return;
    if (pinch && (e.pointerId === primaryPointer || e.pointerId === pinch.id)) {
      if (!pinch.moved && e.type === 'pointerup' && performance.now() - pinch.at < 300) {
        if (pinch.third === undefined) studio.undo(); else studio.redo();
      }
      const remaining = e.pointerId === primaryPointer ? pinch.b : pinch.a;
      if (e.pointerId === primaryPointer) primaryPointer = pinch.id;
      boardTouch = { x: remaining.x, y: remaining.y, px: view.panX, py: view.panY };
      pinch = null;
      return;
    }
    if (e.pointerId === modifierPointer) {
      modifierPointer = null;
      mode.modifierTouch?.(false);
      return;
    }
    if (e.pointerId !== primaryPointer) return;
    primaryPointer = null;
    const touch = finger;
    finger = null;
    if (boardTouch) { boardTouch = null; return; }
    if (panning) {
      panning = null;
      return;
    }
    if (touch && !touch.started && e.type === 'pointerup') mode.down?.(ctx.toPage(touch.first), touch.first);
    if (!touch || touch.started || e.type === 'pointerup') mode.up?.(ctx.toPage(e), e);
    if (modifierPointer !== null) {
      modifierPointer = null;
      mode.modifierTouch?.(false);
    }
    ctx.request();
  };
  stageEl.addEventListener('pointerup', end);
  stageEl.addEventListener('pointercancel', end);
  stageEl.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === primaryPointer || e.pointerId === modifierPointer || e.pointerId === pinch?.id) end(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY }));
  });
  stageEl.addEventListener('pointerleave', () => {
    mode.hover?.(null);
    ctx.request();
  });
  stageEl.addEventListener(
    'wheel',
    (e) => {
      if (mode.pane) return;
      e.preventDefault();
      if (primaryPointer !== null) return;
      const position = local({ x: e.clientX, y: e.clientY });
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stageRect.height : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.altKey) changeView(position, geom().toPage(position), view.zoom, view.angle + (dy || dx) * 0.12);
      else if (e.ctrlKey || e.metaKey) changeView(position, geom().toPage(position), view.zoom * Math.exp(-dy * 0.0025), view.angle);
      else {
        view.panX -= dx;
        view.panY -= dy;
        ctx.request();
      }
    },
    { passive: false },
  );

  // ---- tool rail: groups, flyouts, customization
  const toolRail = h('nav', { class: 'rail', 'aria-label': 'Tools' });
  const ctxBar = h('div', { class: 'ctx', role: 'toolbar', 'aria-label': 'Tool settings' });
  // One-row tool bar: a vertical wheel scrolls it sideways, and a fade marks the side with more.
  const ctxEdges = () => {
    const more = ctxBar.scrollWidth - ctxBar.clientWidth;
    ctxBar.classList.toggle('more-end', more > 1 && ctxBar.scrollLeft < more - 1);
    ctxBar.classList.toggle('more-start', more > 1 && ctxBar.scrollLeft > 1);
  };
  ctxBar.addEventListener('scroll', ctxEdges, { passive: true });
  ctxBar.addEventListener('wheel', (e) => {
    if (ctxBar.scrollWidth <= ctxBar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    ctxBar.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  new ResizeObserver(ctxEdges).observe(ctxBar);
  new MutationObserver(() => requestAnimationFrame(ctxEdges)).observe(ctxBar, { childList: true });
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

  const CLIP_NAMES: Record<ClipPayload['kind'], string> = { pixels: 'pixels', image: 'image', strokes: 'lines', balloons: 'lettering', text: 'text' };
  function pastePoint(): Pt {
    const p = lastPointer;
    return p && p.x >= 0 && p.y >= 0 && p.x <= page.widthIn && p.y <= page.heightIn ? p : { x: page.widthIn / 2, y: page.heightIn / 2 };
  }
  async function copyNow(): Promise<boolean> {
    const clip = mode.copy?.();
    if (!clip) {
      ctx.hint(stage === 'caption' ? 'Select a balloon to copy.' : stage === 'draw' ? 'Select pixels (Transform), lines (Select lines) or an image (Position image) to copy.' : 'Nothing to copy here. Copy from Draw or Caption.', { timeout: 3500 });
      return false;
    }
    const where = await copyToClipboard(clip);
    ctx.hint('Copied ' + CLIP_NAMES[clip.kind] + (where === 'system' ? '. Paste it on any page, in another book, or in another app.' : '. Paste it on any page or in another book.'), { timeout: 3000 });
    return true;
  }
  function pasteNow(clip: ClipPayload | null, at: Pt): void {
    if (!clip) { ctx.hint('The clipboard is empty.', { timeout: 2500 }); return; }
    if (mode.paste?.(clip, at)) { ctx.request(); return; }
    const where = clip.kind === 'balloons' || clip.kind === 'text' ? 'Caption' : 'Draw';
    ctx.hint('Paste ' + CLIP_NAMES[clip.kind] + ' in the ' + where + ' desk.', { tone: 'warn', timeout: 3500 });
  }
  const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onCopy = (e: ClipboardEvent) => {
    if (typingIn(e.target) || document.querySelector('dialog[open]') || mode.pane) return;
    const clip = mode.copy?.();
    if (!clip) return;
    e.preventDefault();
    void copyNow();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (typingIn(e.target) || document.querySelector('dialog[open]') || mode.pane) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? null;
    const files = [...(e.clipboardData?.files ?? [])];
    const at = pastePoint();
    void readClipboard(text, files).then((clip) => pasteNow(clip, at));
  };
  window.addEventListener('copy', onCopy);
  window.addEventListener('paste', onPaste);

  function openCanvasMenu(p: Pt, x: number, y: number): void {
    const items: MenuItem[] = [
      ...(mode.contextMenu?.(p) ?? []),
      'sep',
      ...(mode.copy ? [{ label: 'Copy', key: 'Ctrl+C', run: () => void copyNow() }] : []),
      ...(mode.paste ? [{ label: 'Paste here', key: 'Ctrl+V', run: () => void pasteFromSystem().then((clip) => pasteNow(clip, p)) }] : []),
      'sep',
      { label: 'Undo', key: 'Ctrl+Z', disabled: !studio.history.canUndo, run: () => studio.undo() },
      { label: 'Redo', key: 'Ctrl+Shift+Z', disabled: !studio.history.canRedo, run: () => studio.redo() },
      'sep',
      { label: 'Fit page', key: '0', run: resetView },
      { label: 'Reset rotation', disabled: !view.angle, run: () => { view.angle = 0; ctx.request(); } },
      { label: prefs().layout === 'focus' ? 'Studio layout' : 'Focus layout', key: 'Tab', run: () => toggleLayout() },
      'sep',
      ...(stage === 'layout' || stage === 'caption' ? [{ label: 'Export for drawing…', run: () => openExport(studio, 'apps', { page: idx + 1 }) }] : []),
      { label: 'Export…', run: () => openExport(studio, stage === 'print' ? 'print' : 'files') },
      'sep',
      { label: 'Open the manual', run: () => openManual(stage) },
    ];
    // no leading, trailing or doubled separators
    const rows = items.filter((it, i, all) => it !== 'sep' || (i > 0 && all[i - 1] !== 'sep' && i < all.length - 1));
    const anchor = h('span', { class: 'caption-menu-anchor', style: `left:${x}px;top:${y}px` });
    document.body.append(anchor);
    let close = () => {};
    const menu = h('div', { class: 'chrome-menu canvas-menu', role: 'menu', 'aria-label': 'Canvas actions' },
      rows.map((it) => it === 'sep' ? h('div', { class: 'sep', role: 'separator' }) : h('button', {
        class: 'item', type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': it.checked === undefined ? null : String(it.checked), disabled: !!it.disabled,
        onclick: () => { close(); it.run(); ctx.request(); },
      }, h('span', { 'aria-hidden': 'true' }), it.label, it.key ? h('kbd', {}, it.key) : null)));
    close = popover(anchor, menu, 'below', 'Canvas actions', () => anchor.remove());
    menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }

  function selectTool(id: string): void {
    mode.tool = id;
    chrome();
    ctx.request();
  }

  function flyout(t: Tool, anchor: HTMLElement): void {
    const compact = prefs().layout === 'focus' || (prefs().layout === 'simple' && stage === 'draw');
    popover(anchor, h('div', { role: 'menu', 'aria-label': `${t.label} options` },
      h('h4', {}, t.label, compact && t.key ? h('kbd', { class: 'flyout-key' }, t.key.toUpperCase()) : null),
      t.variants!.map((v) =>
        h('button', { class: 'item', type: 'button', role: 'menuitemradio', 'aria-checked': String(v.id === t.variant), onclick: () => { closePopover(); mode.tool = t.id; ctx.setVariant(t.id, v.id); } },
          glyphEl(v.label, v.glyph), v.label, v.key ? h('kbd', {}, v.key.toUpperCase()) : null))), compact ? 'left' : 'right', `${t.label} options`);
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
            h('label', {}, box, glyphEl(t.label, t.glyph), t.label),
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
    const { scrollLeft, scrollTop } = toolRail;
    const items: HTMLElement[] = [];
    const available = railTools();
    const simple = prefs().layout === 'simple' && stage === 'draw';
    const essentials = new Set(['ink', 'pencil', 'smudge', 'eraser', 'fill', 'pixels', 'tone']);
    const visible = simple ? available.filter((t) => essentials.has(t.id) || t.id === mode.tool) : available;
    function toolButton(t: Tool): HTMLElement {
      const v = t.variants?.find((x) => x.id === t.variant);
      const label = v ? `${t.label}: ${v.label}` : t.label;
      const b = h('button', { class: 'tool', type: 'button', 'aria-pressed': String(t.id === mode.tool), 'aria-haspopup': t.variants ? 'menu' : null,
        title: `${label}${t.key ? ` (${t.key.toUpperCase()})` : ''}${t.variants ? ' · right-click for options' : ''}` },
        glyphEl(t.label, v?.glyph ?? t.glyph, 20), h('em', {}, t.label), t.variants ? h('i', { class: 'more', 'aria-hidden': 'true' }) : null);
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
      b.addEventListener('pointercancel', () => clearTimeout(hold));
      return b;
    }
    if (simple || prefs().layout === 'focus') {
      for (const cluster of clustersFor(stage, visible)) {
        items.push(h('div', { class: 'tool-cluster', role: 'group', 'aria-label': cluster.id + ' tools' }, cluster.tools.map(toolButton)));
      }
    } else {
      let group: string | undefined;
      for (const t of visible) {
        if (items.length && t.group !== group) items.push(h('hr', { 'aria-hidden': 'true' }));
        group = t.group;
        items.push(toolButton(t));
      }
    }
    const opt = h('button', { class: 'railopt', type: 'button', 'aria-label': 'Customize tools', title: 'Customize tools' }, icon('customize', 18));
    opt.addEventListener('click', () => customize(opt));
    if (simple) {
      const more = h('button', { class: 'tool', type: 'button', 'aria-label': 'More tools', 'aria-haspopup': 'dialog' }, h('span', {}, '⋯'), h('em', {}, 'More'));
      more.addEventListener('click', () => popover(more, h('div', {}, available.filter((t) => !essentials.has(t.id)).map((t) =>
        h('button', { class: 'item', type: 'button', onclick: () => { closePopover(); selectTool(t.id); } }, glyphEl(t.label, t.glyph), t.label, t.key ? h('kbd', {}, t.key.toUpperCase()) : null))), 'left', 'More tools'));
      items.push(more);
    }
    toolRail.replaceChildren(...items, opt);
    toolRail.scrollLeft = scrollLeft;
    toolRail.scrollTop = scrollTop;
  }

  function chrome(): void {
    renderRail();
    const t = mode.tools.find((x) => x.id === mode.tool);
    const v = t?.variants?.find((x) => x.id === t.variant);
    ctxBar.replaceChildren(h('span', { class: 'ctx-name' }, v ? `${t!.label} · ${v.label}` : t?.label ?? DESK_META[stage].label));
    mode.ctx(ctxBar);
    const options = Array.from(ctxBar.children).slice(1).some((el) => !el.matches('.hint, .document-option'));
    ctxBar.classList.toggle('no-options', !options);
    screen.classList.toggle('has-options', options);
    if (options && mode.resetOptions && screen.matches('.focus, .simple')) ctxBar.append(h('button', { class: 'btn', type: 'button', onclick: mode.resetOptions }, 'Reset'));
    actions.refresh();
    insp.replaceChildren();
    mode.inspector(insp);
    if (mode.pane) mode.pane(paneHost);
  }

  // ---- header, focus corner, stage rail
  const idx = book.pages.indexOf(page);
  const pageHash = (i: number) => `#desk/${book.id}/${book.pages[i]!.id}/${stage}`;
  const jump = () => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const list = h('div', { class: 'page-jump' }, book.pages.map((item, i) => h('button', {
      class: i === idx ? 'btn primary' : 'btn', type: 'button', 'aria-current': i === idx ? 'page' : null,
      onclick: () => { d.close(); if (i !== idx) go(pageHash(i)); },
    }, h('strong', {}, 'Page ' + (i + 1)), item.beats[0]?.desc ? h('small', {}, item.beats[0].desc) : null)));
    const d = h('dialog', { 'aria-label': 'Jump to page' },
      h('header', {}, h('h2', {}, 'Jump to page')),
      h('div', { class: 'content' }, list),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close')));
    d.addEventListener('close', () => { d.remove(); trigger?.focus(); });
    document.body.append(d);
    d.showModal();
    list.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
  };
  const save = h('span', { class: 'save', 'aria-live': 'polite' });
  const compactSave = h('span', { class: 'save', 'aria-live': 'polite' });
  const viewReadouts: HTMLButtonElement[] = [];
  function viewButton(): HTMLButtonElement {
    const button = h('button', { class: 'btn canvas-view', type: 'button', 'aria-label': 'Canvas view', 'aria-haspopup': 'dialog', title: 'Canvas zoom and rotation' }, '100% · 0°');
    button.onclick = () => {
      const center = () => ({ x: stageRect.width / 2, y: stageRect.height / 2 });
      const update = (zoom: number, angle: number) => {
        const position = center();
        changeView(position, geom().toPage(position), zoom, angle);
      };
      const turn = (degrees: number) => {
        update(view.zoom, view.angle + degrees);
        const range = controls.querySelector<HTMLInputElement>('[aria-label="Canvas rotation"]')!;
        range.value = String(Math.round(view.angle));
        range.dispatchEvent(new Event('input'));
      };
      const controls = h('div', { class: 'canvas-view-options' },
        slider('Canvas zoom', MIN_ZOOM * 100, MAX_ZOOM * 100, 1, Math.round(view.zoom * 100), (v) => v + '%', (v) => update(v / 100, view.angle)),
        slider('Canvas rotation', -180, 180, 1, Math.round(view.angle), (v) => v + '°', (v) => update(view.zoom, v)),
        h('div', { class: 'canvas-view-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => turn(-90) }, 'Rotate left'),
          h('button', { class: 'btn', type: 'button', onclick: () => turn(90) }, 'Rotate right'),
          h('button', { class: 'btn', type: 'button', onclick: () => { resetView(); closePopover(); button.focus(); } }, 'Fit page')),
        h('p', { class: 'note' }, 'Pinch or twist with two fingers. On a mouse, hold Alt and scroll to rotate.'),
      );
      popover(button, controls, button.closest('.chrome-status') ? 'above' : 'below', 'Canvas view');
    };
    viewReadouts.push(button);
    return button;
  }
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
    compactSave.dataset.state = save.dataset.state;
    if (compactSave.textContent !== save.textContent) compactSave.textContent = save.textContent;
    actions.refresh();
    for (const b of undoBtns) b.disabled = !studio.history.canUndo;
    for (const b of redoBtns) b.disabled = !studio.history.canRedo;
  };

  const rail = h('nav', { class: 'stagerail', 'aria-label': 'Desks' },
    STAGES.map((s, i) =>
      h('button', { type: 'button', 'aria-current': String(s === stage), title: `${DESK_META[s].label} (${i + 1})`, onclick: () => go(`#desk/${book.id}/${page.id}/${s}`) },
        glyphEl(DESK_META[s].label, DESK_META[s].glyph, 18), h('b', {}, DESK_META[s].label), h('small', {}, STATE_LABEL[page.state[s]]))),
  );

  const doneBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    const next = page.state[stage] === 2 ? 1 : 2;
    page.state[stage] = next;
    studio.saver.markDirty();
    doneBtn.textContent = next === 2 ? 'Done ✓' : 'Mark done';
    rail.querySelector('[aria-current="true"] small')!.textContent = STATE_LABEL[next]!;
  } }, page.state[stage] === 2 ? 'Done ✓' : 'Mark done');

  const layoutBtn = (glyph: string, label: string) => h('button', { class: 'icon', type: 'button', 'aria-label': label, title: `${label} (Tab)`, onclick: () => toggleLayout() }, glyph);
  const narrowInspector = h('button', { class: 'btn studio-inspector-toggle', type: 'button', 'aria-label': 'Show inspector', 'aria-pressed': 'false' }, 'Inspector');
  const deskSelect = h('select', { 'aria-label': 'Desk' }, STAGES.map((s) => h('option', { value: s, selected: s === stage }, DESK_META[s].label)));
  deskSelect.addEventListener('change', () => go(`#desk/${book.id}/${page.id}/${deskSelect.value}`));
  const spreadPreview = spreadButton(studio, page, stage, go);
  const pageButton = h('button', { class: 'btn', type: 'button', 'aria-label': 'Jump to page', onclick: jump }, (idx + 1) + ' / ' + book.pages.length + ' ▾');
  const pin = h('button', { class: 'icon', type: 'button', 'aria-label': 'Pin interface', title: 'Pin interface', onclick: () => setPrefs({ autoHide: !prefs().autoHide }) }, '⌖');
  const display: ChromeAction = { label: 'Display settings', glyph: '◐', run: (b) => displayMenu(b, { layout: true, composition, shell: true }) };
  const inspect: ChromeAction = { label: 'Inspector', glyph: '☰', run: (b) => toggleInspector(b), pressed: () => screen.classList.contains('insp-open') };
  const exportAction: ChromeAction = { label: 'Export', glyph: '↗', run: () => openExport(studio, stage === 'print' ? 'print' : 'files') };
  // Plan and letter here, then continue drawing elsewhere: the Export center's PSD tab, on this page.
  const drawingExport = stage === 'layout' || stage === 'caption';
  const exportForDrawing = () => openExport(studio, 'apps', { page: idx + 1 });
  const drawingAction: ChromeAction = { label: 'Export for drawing', glyph: '⇲', run: exportForDrawing };
  // One Export button in the header. Layout and Caption open a menu that also offers the PSD
  // handoff, so the bar never needs a second wide button.
  const exportHeader = h('button', { class: 'btn', type: 'button', 'aria-haspopup': drawingExport ? 'menu' : null }, drawingExport ? 'Export ▾' : 'Export');
  exportHeader.addEventListener('click', () => {
    if (!drawingExport) { openExport(studio, stage === 'print' ? 'print' : 'files'); return; }
    const item = (label: string, note: string, run: () => void) => h('button', { class: 'item', type: 'button', role: 'menuitem', onclick: () => { close(); run(); } },
      h('span', { class: 'item-text' }, h('b', {}, label), h('small', {}, note)));
    const close = popover(exportHeader, h('div', { class: 'chrome-menu', role: 'menu', 'aria-label': 'Export' },
      item('Export files…', 'Images, PDF, comic archive, book file', () => openExport(studio, 'files')),
      item('Export for drawing…', 'Layered PSD of page ' + (idx + 1) + ' for another app', exportForDrawing)), 'below', 'Export');
  });
  const deskActions = mode.actions ?? [];
  const primary = stage === 'layout' ? [...deskActions, exportAction, display, inspect] : [...deskActions, display, inspect, exportAction];
  const moreButton = () => actions.querySelector<HTMLButtonElement>('[aria-label="More document actions"]')!;
  const actions = chromeActions([
    ...primary,
    ...(drawingExport ? [drawingAction] : []),
    { label: 'Previous page', disabled: () => idx === 0, run: () => go(pageHash(idx - 1)) },
    { label: 'Next page', disabled: () => idx === book.pages.length - 1, run: () => go(pageHash(idx + 1)) },
    ...(stage !== 'script' ? [{ label: 'Fit page', run: resetView }] : []),
    { label: 'Studio layout', run: () => { setPrefs({ layout: 'studio' }); screen.querySelector<HTMLElement>('.bar [aria-label="Focus layout"]')?.focus(); } },
    ...(stage === 'draw' ? [{ label: 'Simple / Focus', run: () => { setPrefs({ layout: prefs().layout === 'simple' ? 'focus' : 'simple' }); moreButton().focus(); } }] : []),
    { label: 'Mark page done', run: () => doneBtn.click(), pressed: () => page.state[stage] === 2 },
    { label: 'Manual', run: () => openManual(stage) },
    { label: spreadPreview.getAttribute('aria-label')!, run: () => spreadPreview.click() },
  ], () => [
    h('label', { class: 'row' }, 'Desk', deskSelect),
    ...(prefs().layout === 'focus' && pin.offsetWidth === 0 ? [
      h('button', { class: 'item', type: 'button', 'aria-pressed': String(!prefs().autoHide), onclick: () => { closePopover(); moreButton().focus(); pin.click(); } }, 'Pin interface'),
    ] : []),
    ...(mode.tools.length ? [h('button', { class: 'item', type: 'button', onclick: () => { closePopover(); moreButton().focus(); customize(moreButton()); } }, 'Customize tools')] : []),
  ]);
  const nav = h('div', { class: 'chrome-nav', role: 'group', 'aria-label': 'Page navigation' },
    h('button', { class: 'icon', type: 'button', 'aria-label': 'Back to book', onclick: () => go('#book/' + book.id) }, '←'),
    pageButton, undoBtn(), redoBtn(), pin);
  const top = h('div', { class: 'chrome-top', role: 'toolbar', 'aria-label': 'Canvas navigation and actions' }, nav, actions);
  const compactStatus = h('div', { class: 'chrome-status' }, compactSave, stage !== 'script' ? viewButton() : null);
  const screen = h('div', { class: 'screen', 'data-desk': stage },
    h('header', { class: 'bar', style: 'height:52px' },
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Back to book', onclick: () => go(`#book/${book.id}`) }, '←'),
      h('div', { class: 'crumb' }, h('a', { href: `#book/${book.id}` }, book.title), h('b', {}, '/'), h('strong', {}, `Page ${idx + 1}`), h('b', {}, '/'), h('span', {}, DESK_META[stage].label)),
      h('span', { class: 'spacer' }),
      h('div', { class: 'pager' },
        h('button', { type: 'button', 'aria-label': 'Previous page', disabled: idx === 0, onclick: () => go(pageHash(idx - 1)) }, '‹'),
        h('button', { type: 'button', class: 'page-jump-trigger', 'aria-label': 'Jump to page', title: 'Jump to page', onclick: jump }, `${idx + 1} / ${book.pages.length} ▾`),
        h('button', { type: 'button', 'aria-label': 'Next page', disabled: idx === book.pages.length - 1, onclick: () => go(pageHash(idx + 1)) }, '›')),
      save, undoBtn(), redoBtn(), narrowInspector, stage !== 'script' ? viewButton() : null, spreadButton(studio, page, stage, go), displayButton(true, composition),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Manual', title: 'Manual: ' + DESK_META[stage].label + ' desk', onclick: () => openManual(stage) }, '?'),
      stage === 'draw' ? h('button', { class: 'btn simple-toggle', type: 'button', onclick: () => setPrefs({ layout: prefs().layout === 'simple' ? 'studio' : 'simple' }) }, 'Simple / Studio') : null,
      layoutBtn('⤢', 'Focus layout'), doneBtn,
      exportHeader),
    ctxBar,
    h('div', { class: `work${mode.tools.length ? '' : ' norail'}` }, toolRail, stageEl, insp),
    rail, top, compactStatus, message.el,
  );
  let inspectorTrigger: HTMLElement | null = null;
  const toggleInspector = (trigger?: HTMLElement) => {
    const on = !screen.classList.contains('insp-open');
    screen.classList.toggle('insp-open', on);
    if (on && trigger) inspectorTrigger = trigger;
    if (!on) {
      if (inspectorTrigger?.offsetWidth) inspectorTrigger.focus();
      else if (screen.matches('.focus, .simple')) moreButton().focus();
      else narrowInspector.focus();
      inspectorTrigger = null;
    }
    actions.refresh();
    for (const b of [narrowInspector]) {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Hide inspector' : 'Show inspector');
    }
  };
  narrowInspector.addEventListener('click', () => toggleInspector(narrowInspector));
  root.replaceChildren(screen);
  if (mode.pane) stageEl.append(paneHost);
  const idle = autoHideChrome(screen, [top, ctxBar, toolRail, insp, compactStatus, message.el, ...(mode.sidebar ? [mode.sidebar] : [])]);

  function applyLayout(): void {
    screen.classList.toggle('focus', prefs().layout === 'focus');
    screen.classList.toggle('simple', prefs().layout === 'simple' && stage === 'draw');
    const compact = screen.matches('.focus, .simple');
    if (mode.sidebar) {
      const parent = compact ? screen : stageEl;
      if (mode.sidebar.parentElement !== parent) parent.append(mode.sidebar);
    }
    screen.dataset.handed = prefs().handed;
    pin.setAttribute('aria-pressed', String(!prefs().autoHide));
    idle.wake();
  }
  function toggleLayout(): void {
    const next = prefs().layout === 'focus' ? 'studio' : 'focus';
    setPrefs({ layout: next });
    toast(next === 'focus' ? 'Focus layout · Tab or ⤡ returns to Studio' : 'Studio layout', 1600);
  }
  applyLayout();
  chrome();
  status();

  stageRect = stageEl.getBoundingClientRect();
  const ro = new ResizeObserver(() => { stageRect = stageEl.getBoundingClientRect(); ctx.request(); });
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
    if (e.key === 'Escape' && message.clearHint()) { e.preventDefault(); return; }
    if (e.key === 'Escape' && screen.classList.contains('insp-open')) {
      toggleInspector();
      e.preventDefault();
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
    if (primaryPointer !== null) return;
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
      resetView();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') spaceDown = false;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  ctx.request();

  return () => {
    idle.dispose();
    message.clearHint();
    ro.disconnect();
    offStudio();
    offPrefs();
    offHistory();
    closePopover();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('copy', onCopy);
    window.removeEventListener('paste', onPaste);
    window.removeEventListener('keyup', onKeyUp);
    mode.dispose?.();
    studio.residency.unpin(art);
    if (raf) cancelAnimationFrame(raf);
  };
}
