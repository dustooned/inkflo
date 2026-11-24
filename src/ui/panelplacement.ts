import type { PanelTransform, Pt } from '../doc/model';
import { composeMatrix, IDENTITY_MATRIX, isUnmoved } from '../draw/pixeltransform';
import { IDENTITY, invert, matrixFor } from '../engine/core/selxform';
import { DEFAULT_LAYOUT, derivePanels, insetPanel, layoutOf, mapPanelPoint, pointInPoly, panelStack, type Panel } from '../geom/carve';
import { boxFromBounds, type OBox } from '../geom/xformbox';
import { anchorFor } from '../geom/groups';
import { printOf } from '../geom/printkinds';
import type { Bounds } from '../geom/resizebox';
import { panelPath } from '../render/page';
import type { DeskCtx } from './desk';
import { h, seg } from './dom';
import { drawSelectionFrame, grabSelection, selectionCenter, selectionTransform, type SelectionGrab } from './selectiongesture';
import { createTransformBox, type PinchGesture } from './transformbox';

export function panelPlacement(ctx: DeskCtx, selected: () => number | null, select: (index: number | null) => void) {
  const { page, studio } = ctx;
  let resizeAll = false;
  let guides = true;
  let drag: { panels: Panel[]; bounds: Bounds; from: Pt; grab: SelectionGrab; all: boolean } | null = null;
  let draft: { page: typeof page; panels: Panel[] } | undefined;
  const transforms = () => layoutOf(page).panelTransforms ?? [];
  const current = () => ctx.panels()[selected() ?? -1];
  /** The oriented box a placed panel is drawn in: its inset frame carried through its placement. */
  function boxFor(panel: Panel): OBox {
    const m = panel.transform?.matrix;
    if (!m || !panel.source) return boxFromBounds(panel.bbox);
    const inset = insetPanel(panel.source.pts, (layoutOf(page).gutter ?? DEFAULT_LAYOUT.gutter) / 2, page.widthIn, page.heightIn);
    const xs = inset.map((q) => q.x), ys = inset.map((q) => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const at = (x: number, y: number) => mapPanelPoint({ x, y }, m);
    const tl = at(x0, y0), tr = at(x1, y0), bl = at(x0, y1), c = at((x0 + x1) / 2, (y0 + y1) / 2);
    const u = { x: tr.x - tl.x, y: tr.y - tl.y }, v = { x: bl.x - tl.x, y: bl.y - tl.y };
    const w = Math.hypot(u.x, u.y), h = Math.hypot(v.x, v.y);
    // a sheared placement has no rectangular frame: fall back to its bounds
    if (w < 1e-6 || h < 1e-6 || Math.abs(u.x * v.x + u.y * v.y) > 1e-3 * w * h) return boxFromBounds(panel.bbox);
    return { cx: c.x, cy: c.y, w, h, a: Math.atan2(u.y, u.x), fx: 1, fy: 1 };
  }
  /** The panel being edited with the box, and the placement it started from. */
  let single: { panel: Panel; base: PanelTransform['matrix'] } | null = null;
  let tracked = '';
  let boxDrag = false;
  const extent = () => ({ w: page.widthIn, h: page.heightIn });
  function refresh(): void {
    if (!single) return;
    const change = xf.matrix();
    if (!change || !xf.moved()) { draft = undefined; return; }
    const matrix = composeMatrix(change, single.base);
    if (!invert(matrix) || matrix.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000)) return;
    const styled = { ...page, layout: withTransforms([single.panel], [placement(single.panel, matrix)]) };
    draft = { page: styled, panels: derivePanels(styled) };
  }
  const xf = createTransformBox({ scale: () => ctx.scale(), minSize: 0.15, unit: { label: 'in', scale: 1 }, changed: () => { refresh(); ctx.request(); }, chrome: () => ctx.chrome() });
  /** Keep the box on the selected panel; restart it when the panel or its placement changes. */
  function sync(panel: Panel | undefined): void {
    if (!panel || resizeAll) { if (!xf.dragging()) { xf.clear(); single = null; tracked = ''; } return; }
    const key = `${panel.index}:${JSON.stringify(panel.transform?.matrix ?? 0)}`;
    if (key === tracked || xf.dragging()) return;
    tracked = key;
    single = { panel, base: panel.transform?.matrix ?? [...IDENTITY_MATRIX] as PanelTransform['matrix'] };
    xf.start(boxFor(panel));
  }
  function commitDraft(label: string): void {
    const layout = draft?.page.layout;
    draft = undefined;
    if (layout) commit(layout, label);
  }
  const nextOrder = () => Math.max(0, ...transforms().map((p) => p.order)) + 1;

  function placement(panel: Panel, matrix: PanelTransform['matrix'], order = panel.transform?.order ?? nextOrder()): PanelTransform {
    const p = anchorFor(panel.source ?? panel);
    return { at: { x: p.x / page.widthIn, y: p.y / page.heightIn }, matrix, order };
  }
  function withTransforms(panels: Panel[], values: PanelTransform[]) {
    const replaced = new Set(panels.map((p) => p.transform));
    return { ...layoutOf(page), panelTransforms: [...transforms().filter((t) => !replaced.has(t)), ...values] };
  }
  function commit(layout: NonNullable<typeof page.layout>, label: string): void {
    studio.editPage(page, label, ['layout'], (p) => { p.layout = layout; });
    ctx.chrome(); ctx.request();
  }
  function commitPanel(panel: Panel, value: PanelTransform | null, label: string): void {
    commit(withTransforms([panel], value ? [value] : []), label);
  }
  function clear(): void {
    if (boxDrag) xf.cancel();
    boxDrag = false;
    drag = null;
    draft = undefined;
  }

  function updateDraft(p: Pt, e: PointerEvent): void {
    if (!drag) return;
    const { panels, bounds, from, grab, all } = drag;
    if (!draft && Math.hypot(p.x - from.x, p.y - from.y) * ctx.scale() < 3) return;
    const center = selectionCenter(bounds);
    const xform = selectionTransform(grab, bounds, from, p, e, 0.15);
    const change = matrixFor(xform, center.x, center.y);
    if (isUnmoved(change)) { draft = undefined; return; }
    const matrices = panels.map((panel) => composeMatrix(change, panel.transform?.matrix ?? IDENTITY_MATRIX));
    if (matrices.some((matrix) => !invert(matrix) || matrix.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000))) return;
    const values = panels.map((panel, i) => placement(panel, matrices[i]!, all ? i + 1 : undefined));
    const styled = { ...page, layout: withTransforms(panels, values) };
    draft = { page: styled, panels: derivePanels(styled) };
  }

  return {
    clear,
    preview: () => draft,
    down(p: Pt, e: PointerEvent) {
      const touch = e.pointerType === 'touch';
      if (resizeAll) {
        const panels = panelStack(ctx.panels());
        const bounds = panelBounds(panels);
        const grab = bounds && grabSelection(bounds, p, ctx.scale(), touch, false, touch ? 19 : 10);
        if (bounds && grab?.kind === 'resize') drag = { panels, bounds, from: p, grab, all: true };
        return;
      }
      const panel = current();
      sync(panel);
      if (panel && xf.down(p, e, { extent: extent() })) {
        if (xf.grab()?.kind !== 'move' || pointInPoly(p, panel.pts)) { boxDrag = true; return; }
        xf.cancel();
      }
      const hits = panelStack(ctx.panels()).reverse().filter((item) => pointInPoly(p, item.pts));
      const index = e.altKey ? hits.findIndex((item) => item === panel) + 1 : 0;
      const hit = hits.length ? hits[index % hits.length] : undefined;
      select(hit?.index ?? null);
      sync(hit);
      if (hit && xf.down(p, e, { extent: extent() })) boxDrag = true;
    },
    move(p: Pt, e: PointerEvent) {
      if (boxDrag) xf.move(p, e);
      else updateDraft(p, e);
    },
    up(p: Pt, e: PointerEvent) {
      if (boxDrag) {
        const cancelled = e.type === 'pointercancel';
        if (cancelled) xf.cancel(); else { xf.move(p, e); xf.up(); }
        boxDrag = false;
        if (cancelled) draft = undefined; else commitDraft('Transform panel');
        ctx.chrome();
        return;
      }
      if (e.type !== 'pointercancel') updateDraft(p, e);
      const layout = draft?.page.layout;
      const all = drag?.all;
      clear();
      if (layout && e.type !== 'pointercancel') commit(layout, all ? 'Resize all panels' : 'Transform panel');
      else ctx.chrome();
    },
    /** Two fingers pinch, twist and drag the selected panel instead of the view. */
    pinch(g: PinchGesture | null): boolean {
      if (resizeAll) return false;
      const panel = current();
      sync(panel);
      if (!g) { xf.pinch(null); commitDraft('Transform panel'); return false; }
      return !!panel && xf.pinch(g);
    },
    /** Arrow-key step, in page inches; the nudge is applied at once. */
    nudge(dx: number, dy: number): boolean {
      if (resizeAll || xf.dragging()) return false;
      const panel = current();
      sync(panel);
      if (!panel || !xf.nudge(dx, dy)) return false;
      commitDraft('Nudge panel');
      return true;
    },
    showBleed: () => guides && !!draft,
    overlay(g: CanvasRenderingContext2D, s: number, panel: Panel | null) {
      const bleed = printOf(studio.book!).bleed * s;
      g.save();
      g.strokeStyle = '#2f7fd8'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      if (guides) {
        g.strokeStyle = '#bb5a3d';
        g.strokeRect(0, 0, page.widthIn * s, page.heightIn * s);
      }
      g.strokeStyle = '#2f7fd8';
      if (guides && bleed > 0) {
        g.globalAlpha = 0.65;
        g.strokeRect(-bleed, -bleed, page.widthIn * s + 2 * bleed, page.heightIn * s + 2 * bleed);
        g.globalAlpha = 1;
      }
      if (resizeAll) {
        const bounds = panelBounds(draft?.panels ?? ctx.panels());
        if (bounds) drawSelectionFrame(g, bounds, s, undefined, false, 6);
      } else if (panel) {
        g.stroke(panelPath(panel.pts, s));
        sync(current());
        xf.overlay(g, s, { extent: extent() });
      }
      g.restore();
    },
    controls() {
      const scope = seg([{ id: 'one', label: 'One panel' }, { id: 'all', label: 'All panels' }], resizeAll ? 'all' : 'one', (value) => {
        clear();
        resizeAll = value === 'all';
        const row = scope.parentElement;
        ctx.chrome();
        row?.querySelector<HTMLElement>('[aria-label="Transform scope"] [aria-pressed="true"]')?.focus();
        ctx.request();
      }, 'Transform scope');
      const preview = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(guides), onclick: () => {
        guides = !guides;
        preview.setAttribute('aria-pressed', String(guides));
        ctx.request();
      } }, 'Trim & bleed');
      if (resizeAll) return [scope, preview, h('span', { class: 'hint' }, 'Drag an outer edge or corner. Shift keeps proportions.')];
      const panel = current();
      sync(panel);
      const order = (front: boolean) => {
        if (!panel) return;
        const z = front ? nextOrder() : Math.min(0, ...transforms().map((p) => p.order)) - 1;
        commitPanel(panel, placement(panel, panel.transform?.matrix ?? [...IDENTITY_MATRIX], z), front ? 'Bring panel to front' : 'Send panel behind floating panels');
      };
      const picker = h('select', { class: 'btn', 'aria-label': 'Panel to transform' },
        h('option', { value: '' }, 'Select panel'),
        ...ctx.panels().map((p) => h('option', { value: String(p.index) }, 'Panel ' + (p.index + 1))),
      );
      picker.value = panel ? String(panel.index) : '';
      picker.onchange = () => { select(picker.value === '' ? null : Number(picker.value)); ctx.chrome(); ctx.request(); };
      return [
        scope, preview, picker,
        h('button', { class: 'btn', type: 'button', disabled: !panel, onclick: () => order(true) }, 'Bring to front'),
        h('button', { class: 'btn', type: 'button', disabled: !panel?.transform, title: 'Behind the other transformed panels', onclick: () => order(false) }, 'Send to back'),
        h('button', { class: 'btn', type: 'button', disabled: !panel, onclick: () => {
          if (!panel) return;
          const c = selectionCenter(panel.bbox);
          const m = composeMatrix(matrixFor({ ...IDENTITY, rotate: 90 }, c.x, c.y), panel.transform?.matrix ?? IDENTITY_MATRIX);
          commitPanel(panel, placement(panel, m), 'Rotate panel');
        } }, 'Rotate 90°'),
        h('button', { class: 'btn', type: 'button', disabled: !panel?.transform, onclick: () => { if (panel) commitPanel(panel, null, 'Reset panel placement'); } }, 'Reset placement'),
        ...xf.controls({ commit: (label) => commitDraft(label), reset: false, extent }),
        h('span', { class: 'hint' }, 'Drag to move or resize. Alt-click cycles overlapping panels.'),
      ];
    },
  };
}

function panelBounds(panels: Panel[]): Bounds | null {
  return panels.reduce<Bounds | null>((bounds, { bbox }) => bounds ? {
    x0: Math.min(bounds.x0, bbox.x0), y0: Math.min(bounds.y0, bbox.y0),
    x1: Math.max(bounds.x1, bbox.x1), y1: Math.max(bounds.y1, bbox.y1),
  } : bbox, null);
}
