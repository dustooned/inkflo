import type { PanelTransform, Pt } from '../doc/model';
import { composeMatrix, IDENTITY_MATRIX, isUnmoved } from '../draw/pixeltransform';
import { IDENTITY, invert, matrixFor } from '../engine/core/selxform';
import { derivePanels, layoutOf, panelAt, panelStack, type Panel } from '../geom/carve';
import { anchorFor } from '../geom/groups';
import { printOf } from '../geom/printkinds';
import type { Bounds } from '../geom/resizebox';
import { panelPath } from '../render/page';
import type { DeskCtx } from './desk';
import { h } from './dom';
import { drawSelectionFrame, grabSelection, selectionCenter, selectionTransform, type SelectionGrab } from './selectiongesture';

export function panelPlacement(ctx: DeskCtx, selected: () => number | null, select: (index: number | null) => void) {
  const { page, studio } = ctx;
  let resizeAll = false;
  let drag: { panels: Panel[]; bounds: Bounds; from: Pt; grab: SelectionGrab; all: boolean } | null = null;
  let draft: { page: typeof page; panels: Panel[] } | undefined;
  const transforms = () => layoutOf(page).panelTransforms ?? [];
  const current = () => ctx.panels()[selected() ?? -1];
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
        const grab = bounds && grabSelection(bounds, p, ctx.scale(), touch, false);
        if (bounds && grab?.kind === 'resize') drag = { panels, bounds, from: p, grab, all: true };
        return;
      }
      const panel = current();
      const grab = panel && grabSelection(panel.bbox, p, ctx.scale(), touch);
      if (panel && grab && grab.kind !== 'move') { drag = { panels: [panel], bounds: panel.bbox, from: p, grab, all: false }; return; }
      const hit = panelAt(ctx.panels(), p);
      select(hit?.index ?? null);
      if (hit) drag = { panels: [hit], bounds: hit.bbox, from: p, grab: { kind: 'move' }, all: false };
    },
    move: updateDraft,
    up(p: Pt, e: PointerEvent) {
      if (e.type !== 'pointercancel') updateDraft(p, e);
      const layout = draft?.page.layout;
      const all = drag?.all;
      clear();
      if (layout && e.type !== 'pointercancel') commit(layout, all ? 'Resize all panels' : 'Transform panel');
      else ctx.chrome();
    },
    overlay(g: CanvasRenderingContext2D, s: number, panel: Panel | null) {
      const bleed = printOf(studio.book!).bleed * s;
      g.save();
      g.strokeStyle = '#2f7fd8'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      if (bleed > 0) {
        g.globalAlpha = 0.65;
        g.strokeRect(-bleed, -bleed, page.widthIn * s + 2 * bleed, page.heightIn * s + 2 * bleed);
        g.globalAlpha = 1;
      }
      if (resizeAll) {
        const bounds = panelBounds(draft?.panels ?? ctx.panels());
        if (bounds) drawSelectionFrame(g, bounds, s, undefined, false);
      } else if (panel) {
        g.stroke(panelPath(panel.pts, s));
        drawSelectionFrame(g, panel.bbox, s);
      }
      g.restore();
    },
    controls() {
      const toggle = h('button', {
        class: 'btn', type: 'button', 'aria-pressed': String(resizeAll),
        title: resizeAll ? 'Drag an outer edge or corner. Shift keeps proportions.' : 'Resize every panel on this page together',
        onclick: () => {
          clear();
          resizeAll = !resizeAll;
          const row = toggle.parentElement;
          ctx.chrome();
          row?.querySelector<HTMLElement>('[data-resize-all]')?.focus();
          ctx.request();
        },
        'data-resize-all': '',
      }, 'Resize all panels');
      if (resizeAll) return [toggle, h('span', { class: 'hint' }, 'Drag an outer edge or corner. Shift keeps proportions.')];
      const panel = current();
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
        toggle, picker,
        h('button', { class: 'btn', type: 'button', disabled: !panel, onclick: () => order(true) }, 'Bring to front'),
        h('button', { class: 'btn', type: 'button', disabled: !panel?.transform, title: 'Behind the other transformed panels', onclick: () => order(false) }, 'Send to back'),
        h('button', { class: 'btn', type: 'button', disabled: !panel, onclick: () => {
          if (!panel) return;
          const c = selectionCenter(panel.bbox);
          const m = composeMatrix(matrixFor({ ...IDENTITY, rotate: 90 }, c.x, c.y), panel.transform?.matrix ?? IDENTITY_MATRIX);
          commitPanel(panel, placement(panel, m), 'Rotate panel');
        } }, 'Rotate 90°'),
        h('button', { class: 'btn', type: 'button', disabled: !panel?.transform, onclick: () => { if (panel) commitPanel(panel, null, 'Reset panel placement'); } }, 'Reset placement'),
        h('span', { class: 'hint' }, 'Drag a panel, a side, or a corner. Use the round handle to rotate.'),
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
