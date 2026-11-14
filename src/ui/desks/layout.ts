import type { Cut, CutMode, PageLayout, Pt } from '../../doc/model';
import { K, canEvenOut, cornerOverrides, derivePanels, evenOut, gutterPaths, layoutOf, mapPanelPoint, nearestCut, newCutId, panelAt, panelStack, planKnifeCut, pointInPoly, presetCuts, type Panel, type Preset } from '../../geom/carve';
import { invert } from '../../engine/core/selxform';
import { anchorFor } from '../../geom/groups';
import { movePanelCuts, sameGutterTopology } from '../../geom/paneltransform';
import { inGutter } from '../../geom/gutters';
import { panelPath } from '../../render/page';
import { variantOf, type DeskCtx, type DeskMode } from '../desk';
import { confirmDialog, h, seg, slider, toast } from '../dom';
import { centreCrossing, DEFAULT_GRID, downbeatPanel, gridLines, revealIssues, snapGridCut, staggerCentre } from '../../geom/composition';
import { drawModularGrid } from '../composition';
import { openGrid } from '../grid';
import { openPageTemplates } from '../pagetemplates';
import { applyPageTemplate, splitPanelCuts } from '../../geom/pagetemplates';
import { layoutBins } from '../layoutbins';
import { sideChoice } from '../binpanel';
import { resample, pathLength } from '../../engine/core/quickshape';
import { adjustCut, CUT_SHAPE_LABEL, recognizeCut, type CutShape } from '../../geom/cutshape';
import { snapCutEnd } from '../../geom/cutangle';
import { drawCutAngle } from '../cutangleoverlay';
import { panelPlacement } from '../panelplacement';
import { describeTransform, formatLayoutCode, LAYOUT_LEGEND, parseLayoutCode, transformMatrix } from '../../geom/layoutcode';
import { pageData } from '../../geom/pagedata';
import { codeEditor, jsonButtons } from '../codeeditor';

type Side = 'n' | 's' | 'e' | 'w';
interface Handle {
  side: Side;
  at: Pt;
  cut: Cut;
  axis: 'x' | 'y';
}
type CutMove = Pick<Handle, 'axis' | 'cut' | 'at'>;

function panelNumberAt(panel: Panel, page: DeskCtx['page'], scale: number): Pt | null {
  const { y0, y1 } = panel.bbox;
  const { gutter, border } = layoutOf(page);
  const room = gutter / 2 + border + 11 / scale;
  const top = Math.min(y0 + room, (y0 + y1) / 2);
  for (const y of [top, y0 + (y1 - y0) / 4, (y0 + y1) / 2, y1 - (y1 - y0) / 4]) {
    const hits = panel.pts.flatMap((a, i) => {
      const b = panel.pts[(i + 1) % panel.pts.length]!;
      return (a.y > y) === (b.y > y) ? [] : [a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)];
    }).sort((a, b) => a - b);
    let width = 16 / scale;
    let at: Pt | null = null;
    for (let i = 1; i < hits.length; i += 2) {
      const w = hits[i]! - hits[i - 1]!;
      const point = { x: (hits[i]! + hits[i - 1]!) / 2, y };
      if (w > width && !inGutter(page, point)) { width = w; at = point; }
    }
    if (at) return at;
  }
  return null;
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'splash', label: 'Splash' },
  { id: 'rows2', label: '2 rows' },
  { id: 'tier3', label: '3 tiers' },
  { id: 'grid4', label: '4' },
  { id: 'grid6', label: '6' },
  { id: 'grid9', label: '9' },
];

/** Layout: carve panels with a knife; drag a panel's edge to move the cut under it. */
export function layoutDesk(ctx: DeskCtx): DeskMode {
  const { studio, book, page } = ctx;
  let showGrid = true;
  let trail: Pt[] | null = null;
  let straight = false;
  let heldStraight = false;
  /** The last straight cut's snap, for the angle readout. */
  let snapped = false;
  let shiftSteps = false;
  /** Auto Shape: the shape a held knife stroke snapped to, and where the pen was then. */
  let held: { cut: CutShape; grab: Pt } | null = null;
  let holdTimer = 0;
  let autoShape = true;
  let sel: number | null = null;
  const placement = panelPlacement(ctx, () => sel, (index) => { sel = index; });
  let hoverCut: CutMove | null = null;
  let drag: { moves: CutMove[]; start: Pt; before: Cut[]; count: number; blocked: boolean; whole: boolean } | null = null;
  let preview: ReturnType<NonNullable<DeskMode['layoutPreview']>>;
  let curveId: string | undefined;
  let curveDrag: 0 | 1 | undefined;
  const curveCut = () => displayPage().cuts.find((c) => c.id === curveId);
  function controlsFor(c: Cut): [Pt, Pt] {
    if (c.handles) return c.handles;
    const points = c.extended?.length ? c.extended : c.pts;
    const [a, m, n, b] = resample(points, 4) as [Pt, Pt, Pt, Pt];
    // Fit the cubic through the existing cut at t = 1/3 and t = 2/3.
    const fit = (axis: keyof Pt) => {
      const first = 27 * m[axis] - 8 * a[axis] - b[axis];
      const second = 27 * n[axis] - a[axis] - 8 * b[axis];
      return [(2 * first - second) / 18, (2 * second - first) / 18];
    };
    const [x1, x2] = fit('x');
    const [y1, y2] = fit('y');
    return [{ x: x1!, y: y1! }, { x: x2!, y: y2! }];
  }

  const displayPage = () => (placement.preview() ?? preview)?.page ?? page;
  const displayPanels = () => (placement.preview() ?? preview)?.panels ?? ctx.panels();
  const selected = (): Panel | null => (sel === null ? null : displayPanels()[sel] ?? null);
  const panelIndexAt = (p: Pt) => panelAt(ctx.panels(), p)?.index ?? null;

  function handles(): Handle[] {
    const selectedPanel = selected();
    if (!selectedPanel) return [];
    const p = selectedPanel.source ?? selectedPanel;
    const { x0, x1, y0, y1 } = p.bbox;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const sides: { side: Side; at: Pt; axis: 'x' | 'y' }[] = [
      { side: 'w', at: { x: x0, y: my }, axis: 'x' },
      { side: 'e', at: { x: x1, y: my }, axis: 'x' },
      { side: 'n', at: { x: mx, y: y0 }, axis: 'y' },
      { side: 's', at: { x: mx, y: y1 }, axis: 'y' },
    ];
    const out: Handle[] = [];
    const gutter = layoutOf(page).gutter;
    for (const s of sides) {
      const c = nearestCut(displayPage(), s.at);
      if (!c) continue;
      const aligned = s.axis === 'x' ? Math.abs(c.n.x) > 0.55 : Math.abs(c.n.y) > 0.55;
      if (aligned && c.d <= gutter / 2 + 18 / K) out.push({ ...s, at: c.at, cut: c.cut });
    }
    return out;
  }

  const handleAt = (p: Pt, r: number): Handle | null => {
    return handles().find((hd) => Math.abs(hd.at.x - p.x) <= r && Math.abs(hd.at.y - p.y) <= r) ?? null;
  };

  function gutterAt(p: Pt, r: number): CutMove | null {
    const near = nearestCut(page, p);
    if (!near || near.d > layoutOf(page).gutter / 2 + r) return null;
    const axis = Math.abs(near.n.x) >= Math.abs(near.n.y) ? 'x' : 'y';
    return { cut: near.cut, axis, at: p };
  }

  function panelMoves(): Handle[] {
    const edges = handles();
    return edges.filter((edge) => edges.some((other) => other.axis === edge.axis && other.side !== edge.side && other.cut.id !== edge.cut.id));
  }

  function holdToStraight(): void {
    clearTimeout(holdTimer);
    if (!autoShape || !trail || trail.length < 2 || heldStraight) return;
    holdTimer = window.setTimeout(() => {
      if (!trail || Math.hypot(trail.at(-1)!.x - trail[0]!.x, trail.at(-1)!.y - trail[0]!.y) * ctx.scale() < 22) return;
      // snap to the cleanest shape the stroke looks like: line, arc, zig-zag or a smoothed curve
      const cut = recognizeCut(trail, ctx.scale());
      held = { cut, grab: trail.at(-1)! };
      heldStraight = cut.kind === 'line';
      trail = cut.pts.map((q) => ({ ...q }));
      ctx.hint(CUT_SHAPE_LABEL[cut.kind] + ' · keep holding and drag to adjust');
      ctx.request();
    }, 550);
  }

  function cancelDrag(): void {
    placement.clear();
    clearTimeout(holdTimer);
    trail = null;
    held = null;
    drag = null;
    curveDrag = undefined;
    preview = undefined;
  }

  // ---- Layout as code (in the sidebar, applied live to the canvas)
  let codeOpen = (() => { try { return localStorage.getItem('inkflo:layout-code') === '1'; } catch { return false; } })();
  let codeBefore: { cuts: Cut[]; layout: PageLayout | undefined } | null = null;
  let lastWritten = '';
  const livePanels = h('ol', { class: 'script-code-live', 'aria-label': 'Panels as read so far' });
  const layoutCode = codeEditor({
    label: 'Layout as code',
    minHeight: 260,
    parse: (text) => parseLayoutCode(text, page),
    onLive: (text) => {
      const parsed = parseLayoutCode(text, page);
      // keep the page as it was while a line is half typed; apply once everything reads
      if (parsed.errors.length) return;
      const next = { cuts: parsed.cuts, layout: parsed.layout };
      if (JSON.stringify(next) === JSON.stringify({ cuts: page.cuts, layout: layoutOf(page) })) return;
      codeBefore ??= { cuts: structuredClone(page.cuts), layout: structuredClone(page.layout) };
      page.cuts = next.cuts;
      page.layout = next.layout;
      lastWritten = formatLayoutCode(page);
      paintLive();
      ctx.request();
    },
    onSettle: () => {
      const was = codeBefore;
      codeBefore = null;
      if (!was) return;
      const now = { cuts: structuredClone(page.cuts), layout: structuredClone(page.layout) };
      const apply = (s: typeof now) => { page.cuts = structuredClone(s.cuts); page.layout = structuredClone(s.layout); };
      studio.run({ label: 'Edit layout code', do: () => apply(now), undo: () => apply(was) }, true);
      studio.markStage(page, 'layout', 1);
      ctx.chrome();
    },
  });
  function paintLive(): void {
    livePanels.replaceChildren(...derivePanels(page).map((q) => h('li', {}, h('b', {}, 'Panel ' + (q.index + 1)),
      h('span', {}, `${(q.bbox.x1 - q.bbox.x0).toFixed(2)} × ${(q.bbox.y1 - q.bbox.y0).toFixed(2)} in at ${q.bbox.x0.toFixed(2)},${q.bbox.y0.toFixed(2)}`),
      q.transform ? h('small', {}, 'moved') : null)));
  }
  function codePanel(): HTMLElement {
    // rewrite the text only when the page changed somewhere else (keeps comments while typing)
    const current = formatLayoutCode(page);
    if (!layoutCode.focused() && current !== lastWritten) { layoutCode.setText(current); lastWritten = current; }
    layoutCode.paint();
    paintLive();
    return h('div', { class: 'layout-code' },
      h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Layout'), h('div', { class: 'ins-title' }, 'Layout as code')),
      h('div', { class: 'sec stack' }, layoutCode.editor, layoutCode.problems,
        h('p', { class: 'note', style: 'margin:0' }, 'Inches from the top-left of the page. The page updates when every line reads, and each pause is one undo step. Draw on the canvas any time and the code follows.')),
      h('div', { class: 'sec' }, h('h4', {}, 'Panels'), livePanels),
      h('details', { class: 'sec' }, h('summary', {}, 'Legend'),
        h('dl', { class: 'code-legend' }, LAYOUT_LEGEND.flatMap((l) => [h('dt', {}, h('code', {}, l.code)), h('dd', {}, l.means)]))),
      h('div', { class: 'sec' }, jsonButtons(`${book.title} page ${book.pages.indexOf(page) + 1}`, () => pageData(book, page))));
  }
  function setCodeOpen(on: boolean): void {
    codeOpen = on;
    try { localStorage.setItem('inkflo:layout-code', on ? '1' : '0'); } catch { /* private mode */ }
    ctx.stage.closest('.screen')?.classList.toggle('layout-code-open', on);
    ctx.chrome();
  }
  queueMicrotask(() => ctx.stage.closest('.screen')?.classList.toggle('layout-code-open', codeOpen));

  /** Set the selected panel's move, turn and scale (one undo step). */
  function setPanelNumbers(p: Panel, numbers: { move: Pt; turn: number; scale: number }): void {
    const src = p.source ?? p;
    const anchor = anchorFor(src);
    const at = { x: anchor.x / page.widthIn, y: anchor.y / page.heightIn };
    studio.editPage(page, 'Panel numbers', ['layout'], (pg) => {
      const L = layoutOf(pg);
      const others = (L.panelTransforms ?? []).filter((t) => !pointInPoly({ x: t.at.x * pg.widthIn, y: t.at.y * pg.heightIn }, src.pts));
      const still = numbers.move.x === 0 && numbers.move.y === 0 && numbers.turn === 0 && numbers.scale === 1;
      const order = Math.max(0, ...others.map((t) => t.order)) + 1;
      const transforms = still ? others : [...others, { at, matrix: transformMatrix(src.centroid, numbers.move, numbers.turn, numbers.scale), order: p.transform?.order ?? order }];
      pg.layout = { ...L, panelTransforms: transforms };
      if (!transforms.length) delete pg.layout.panelTransforms;
    });
    ctx.chrome();
    ctx.request();
  }
  function panelNumbers(p: Panel): HTMLElement {
    const now = p.transform && p.source ? describeTransform(p.transform, p.source.centroid) : { move: { x: 0, y: 0 }, turn: 0, scale: 1 };
    const field = (label: string, value: number, step: number, min: number, max: number, set: (v: number) => void) => {
      const input = h('input', { type: 'number', step, min, max, value: Number(value.toFixed(3)), 'aria-label': `Panel ${p.index + 1} ${label}` });
      input.addEventListener('change', () => { const v = input.valueAsNumber; if (Number.isFinite(v) && v >= min && v <= max) set(v); else input.value = String(Number(value.toFixed(3))); });
      return h('label', { class: 'field' }, label, input);
    };
    const b = p.bbox;
    return h('div', { class: 'panel-numbers' },
      h('div', { class: 'rows' }, 'Position', h('b', {}, `${b.x0.toFixed(2)}, ${b.y0.toFixed(2)} in`)),
      h('div', { class: 'rows' }, 'Size', h('b', {}, `${(b.x1 - b.x0).toFixed(2)} × ${(b.y1 - b.y0).toFixed(2)} in`)),
      h('div', { class: 'type-grid' },
        field('Move right (in)', now.move.x, 0.05, -50, 50, (v) => setPanelNumbers(p, { ...now, move: { x: v, y: now.move.y } })),
        field('Move down (in)', now.move.y, 0.05, -50, 50, (v) => setPanelNumbers(p, { ...now, move: { x: now.move.x, y: v } })),
        field('Turn (°)', now.turn, 1, -360, 360, (v) => setPanelNumbers(p, { ...now, turn: v })),
        field('Scale', now.scale, 0.05, 0.1, 5, (v) => setPanelNumbers(p, { ...now, scale: v }))),
      p.transform ? h('button', { class: 'btn', type: 'button', onclick: () => setPanelNumbers(p, { move: { x: 0, y: 0 }, turn: 0, scale: 1 }) }, 'Put back in place') : null);
  }

  function setLayout(patch: Partial<PageLayout>, commit: boolean): void {
    const before = layoutOf(page);
    const layout = { ...before, ...patch };
    const reflow = before.curve !== layout.curve;
    const cuts = reflow ? movePanelCuts(page, new Map(), layout) : page.cuts;
    const styled = { ...page, layout, cuts };
    const valid = !reflow || sameGutterTopology(page, styled);
    if (commit) {
      preview = undefined;
      if (valid) studio.editPage(page, 'Panel style', reflow ? ['layout', 'cuts'] : ['layout'], (p) => {
        p.layout = layout;
        if (reflow) p.cuts = cuts;
      });
      else { toast('That curve setting would disconnect a gutter.'); ctx.chrome(); }
    } else if (valid) preview = { page: styled, panels: reflow ? derivePanels(styled) : ctx.panels() };
    ctx.request();
  }

  const drawAngle = (g: CanvasRenderingContext2D, s: number, a: Pt, b: Pt, isSnapped: boolean) =>
    drawCutAngle(g, s, s / ctx.scale(), a, b, { snapped: isSnapped, steps: shiftSteps, page, minLen: 18 / ctx.scale() });

  const cutMode = (): CutMode => (variantOf(mode, 'knife') === 'across' ? 'across' : 'panel');
  /** The moved panel a knife stroke is drawn over (topmost), if any: that panel is cut in place. */
  /** Halfway along a stroke (a straight cut is just its two ends). */
  function strokeMid(points: Pt[]): Pt | undefined {
    if (points.length <= 2) return points.length ? { x: (points[0]!.x + points.at(-1)!.x) / 2, y: (points[0]!.y + points.at(-1)!.y) / 2 } : undefined;
    return points[Math.floor(points.length / 2)];
  }
  function placedUnder(points: Pt[]): Panel | null {
    const mid = strokeMid(points);
    if (!mid) return null;
    return panelStack(ctx.panels()).reverse().find((p) => p.transform && pointInPoly(mid, p.pts)) ?? null;
  }
  function knifePreview(points: Pt[], isStraight: boolean) {
    const placed = placedUnder(points);
    const inverse = placed?.transform ? invert(placed.transform.matrix) : null;
    // over a moved panel: plan in its own (source) space, cutting only that panel
    const source = inverse ? points.map((q) => mapPanelPoint(q, inverse)) : points;
    const grid = page.grid ?? book.fixedGrid;
    const stroke = !placed && showGrid && grid ? snapGridCut(page, grid, source, 10 / ctx.scale()) : source;
    const length = pathLength(stroke);
    const sampled = !isStraight && stroke.length > 3 && length > 0 ? resample(stroke, Math.max(4, Math.min(220, Math.ceil(length * 18)))) : stroke;
    const clean = sampled.map((p, i) => {
      const a = sampled[i - 1], b = sampled[i + 1];
      return a && b ? { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 } : p;
    });
    const mid = strokeMid(points)!;
    const plan = placed && inverse
      ? planKnifeCut(page, clean, 'panel', isStraight, mapPanelPoint(mid, inverse))
      : planKnifeCut(page, clean, cutMode(), isStraight);
    // the stroke is shown where it was drawn
    const shown = inverse && placed?.transform ? stroke.map((q) => mapPanelPoint(q, placed.transform!.matrix)) : stroke;
    return { stroke: shown, plan, placed, gridGutter: !placed && stroke !== points ? grid?.gutter : undefined };
  }
  const templates = () => openPageTemplates(page, (template) => {
    studio.editPage(page, 'Apply ' + template.name, ['cuts', 'layout', 'grid', 'downbeat'], (p) => applyPageTemplate(p, template));
    sel = null;
    ctx.chrome();
    ctx.request();
  }, true);
  const side = sideChoice('layout', 'Panels', () => ctx.chrome());
  const bins = layoutBins({
    page, stage: ctx.stage, toPage: (e) => ctx.toPage(e),
    applyPage(template) {
      studio.editPage(page, 'Apply ' + template.name, ['cuts', 'layout', 'grid', 'downbeat'], (p) => applyPageTemplate(p, template));
      sel = null;
      ctx.chrome();
      ctx.request();
    },
    splitPanel(template, at) {
      const cuts = splitPanelCuts(page, at, template);
      if (!cuts) return false;
      studio.editPage(page, 'Split panel with ' + template.name, ['cuts'], (p) => { p.cuts = [...p.cuts, ...cuts]; });
      sel = null;
      ctx.chrome();
      ctx.request();
      return true;
    },
  });
  function markDownbeat(panel: Panel, clear = false): void {
    studio.editPage(page, clear ? 'Clear downbeat' : 'Mark downbeat', ['downbeat'], (pg) => {
      if (clear) delete pg.downbeat;
      else {
        const at = anchorFor(panel.source ?? panel);
        pg.downbeat = { x: at.x / pg.widthIn, y: at.y / pg.heightIn };
      }
    });
    ctx.chrome();
  }

  const mode: DeskMode = {
    id: 'layout',
    actions: [
      { label: 'Page templates', glyph: '▦', run: templates },
      { label: 'Even out', glyph: '⇔', disabled: () => !canEvenOut(page), run: () => studio.editPage(page, 'Even out', ['cuts'], (p) => (p.cuts = evenOut(p))) },
      { label: 'Uncut', glyph: '⌫', run: () => { mode.tool = 'erase'; ctx.chrome(); ctx.request(); } },
    ],
    tools: [
      { id: 'knife', label: 'Knife', glyph: '⟋', key: 'k', group: 'cut', variants: [
        { id: 'across', label: 'Across page', glyph: '⟋' },
        { id: 'panel', label: 'One panel', glyph: '⟷' },
      ] },
      { id: 'erase', label: 'Uncut', glyph: '⌫', key: 'e', group: 'cut' },
      { id: 'resize', label: 'Resize gutters', glyph: '⇔', key: 'r', group: 'edit' },
      { id: 'place', label: 'Transform panel', glyph: '↗', key: 'v', group: 'edit' },
      { id: 'curve', label: 'Curve edges', glyph: '⌒', key: 'b', group: 'edit' },
    ],
    tool: 'knife',
    cursor: () => {
      if (mode.tool === 'knife') return 'cross';
      if (mode.tool === 'curve') return 'cross';
      if (mode.tool === 'place') return 'move';
      if (mode.tool !== 'resize') return '';
      const edge = drag?.moves[0] ?? hoverCut;
      return !edge || drag?.whole ? 'move' : edge.axis === 'x' ? 'ew-resize' : 'ns-resize';
    },
    ctx(bar) {
      bar.append(h('button', { class: 'btn document-option', type: 'button', 'aria-pressed': String(codeOpen), title: 'Edit the layout as numbers and code in the sidebar', onclick: () => setCodeOpen(!codeOpen) }, codeOpen ? 'Close code' : 'Code'));
      const L = layoutOf(page);
      if (mode.tool === 'place') {
        bar.append(...placement.controls());
        return;
      }
      if (mode.tool === 'knife') {
        const snap = h('input', { type: 'checkbox', checked: autoShape });
        snap.addEventListener('change', () => (autoShape = snap.checked));
        bar.append(seg<CutMode>([{ id: 'across', label: 'Across page' }, { id: 'panel', label: 'One panel' }], cutMode(), (v) => ctx.setVariant('knife', v), 'Cut mode'),
          h('label', { class: 'mini', title: 'Hold at the end of a cut: it snaps to a straight line, an arc, a zig-zag or a smooth curve. Keep holding and drag to adjust.' }, snap, 'Auto Shape'));
      }
      bar.append(
        h('button', { class: 'btn document-option', type: 'button', onclick: templates }, 'Page templates'),
        slider('Gutter', 0, 2, 0.01, L.gutter, (v) => `${v.toFixed(2)}″`, (v) => setLayout({ gutter: v }, false), (v) => setLayout({ gutter: v }, true)),
        slider('Border', 0, 0.12, 0.005, L.border, (v) => `${(v * 72).toFixed(1)}pt`, (v) => setLayout({ border: v }, false), (v) => setLayout({ border: v }, true)),
        slider('Curve', 0, 5, 1, L.curve, (v) => String(v), (v) => setLayout({ curve: v }, false), (v) => setLayout({ curve: v }, true)),
        h('button', { class: 'btn document-option', type: 'button', disabled: !canEvenOut(page), title: 'Evenly space a straight grid', onclick: () => studio.editPage(page, 'Even out', ['cuts'], (p) => (p.cuts = evenOut(p))) }, 'Even out'),
        h('span', { class: 'hint' }, mode.tool === 'knife' ? (cutMode() === 'panel' ? 'Draw a line through a panel. It runs on to the panel’s borders.' : 'Draw a line across the page. It runs on to the page edges.') : mode.tool === 'resize' ? 'Drag a gutter or panel handle' : mode.tool === 'curve' ? 'Select a gutter, then drag a Bézier handle' : 'Click a gutter to remove it'),
      );
    },
    inspector(el) {
      if (codeOpen) { el.append(codePanel()); return; }
      el.append(side.switcher());
      if (side.bins()) { bins.refresh(); el.append(bins.el); return; }
      const ps = displayPanels();
      const p = selected();
      el.append(h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Layout'), h('div', { class: 'ins-title' }, `${ps.length} panel${ps.length === 1 ? '' : 's'}`)));
      const paper = layoutOf(page).gutterPaper;
      const paperType = paper === null ? 'transparent' : !paper || paper.toLowerCase() === '#ffffff' ? 'white' : 'custom';
      const color = h('input', { type: 'color', value: paperType === 'custom' ? paper : '#d9e2df', 'aria-label': 'Custom gutter colour' });
      color.addEventListener('change', () => { setLayout({ gutterPaper: color.value }, true); ctx.chrome(); });
      el.append(h('div', { class: 'sec stack' }, h('h4', {}, 'Gutter background'),
        seg([{ id: 'white', label: 'White' }, { id: 'transparent', label: 'Transparent' }, { id: 'custom', label: 'Custom' }], paperType, (v) => {
          setLayout({ gutterPaper: v === 'transparent' ? null : v === 'white' ? '#ffffff' : color.value }, true);
          ctx.chrome();
        }, 'Gutter background'), paperType === 'custom' ? color : null));
      const edge = h('input', { type: 'checkbox', checked: layoutOf(page).edgeBorder ?? false });
      edge.addEventListener('change', () => setLayout({ edgeBorder: edge.checked }, true));
      el.append(h('div', { class: 'sec' }, h('label', { class: 'mini' }, edge, 'Outline page edge')));
      const radius = layoutOf(page).cornerRadius ?? 0;
      el.append(h('div', { class: 'sec' }, slider('Round corners', 0, 0.5, 0.01, radius, (v) => `${v.toFixed(2)}″`, (v) => setLayout({ cornerRadius: v }, false), (v) => setLayout({ cornerRadius: v }, true))));
      const downbeat = downbeatPanel(page, ps);
      const crossing = centreCrossing(page);
      const staggered = crossing ? staggerCentre(page) : undefined;
      const activeCuts = new Set(gutterPaths(page).map(({ cut }) => cut.id));
      const unused = page.cuts.length - activeCuts.size;
      el.append(
        h('div', { class: 'sec' }, h('h4', {}, 'Presets'),
          h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
            PRESETS.map((pr) => h('button', { class: 'btn', type: 'button', onclick: async () => {
              if (page.cuts.length && !(await confirmDialog('Replace the layout?', 'The preset replaces this page’s cuts. Undo brings them back.', 'Replace'))) return;
              studio.editPage(page, `Preset: ${pr.label}`, ['cuts', 'layout'], (pg) => {
                pg.cuts = presetCuts(pg, pr.id);
                if (pg.layout?.panelTransforms) delete pg.layout.panelTransforms;
              });
              sel = null;
              ctx.chrome();
            } }, pr.label)))),
      );
      const grid = page.grid ?? book.fixedGrid;
      const show = h('input', { type: 'checkbox', checked: showGrid, disabled: !grid });
      show.addEventListener('change', () => { showGrid = show.checked; ctx.request(); });
      el.append(h('div', { class: 'sec' }, h('h4', {}, 'Modular grid'),
        h('label', { class: 'mini' }, show, 'Show guides and snap Knife'),
        grid ? h('p', { class: 'note' }, grid.columns.length + ' columns × ' + grid.rows.length + ' rows' + (book.fixedGrid ? ' · book grid enabled' : '')) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => openGrid(ctx, grid ?? DEFAULT_GRID) }, 'Grid settings')));
      if (p) {
        const beat = page.beats[p.index];
        const overrides = cornerOverrides(page, p);
        const otherCorners = (layoutOf(page).panelCorners ?? []).filter((entry) => !overrides.includes(entry));
        const anchor = anchorFor(p.source ?? p);
        const at = { x: anchor.x / page.widthIn, y: anchor.y / page.heightIn };
        const setRadius = (v: number, commit: boolean) => setLayout({ panelCorners: [...otherCorners, { at, radius: v }] }, commit);
        el.append(
          h('div', { class: 'sec' }, h('h4', {}, `Panel ${p.index + 1}`),
            panelNumbers(p),
            h('div', { class: 'rows' }, 'Reading order', h('b', {}, String(p.index + 1))),
            slider('Panel corner radius', 0, 0.5, 0.01, overrides.at(-1)?.radius ?? radius, (v) => `${v.toFixed(2)}″`, (v) => setRadius(v, false), (v) => { setRadius(v, true); ctx.chrome(); }),
            overrides.length ? h('button', { class: 'btn', type: 'button', onclick: () => { setLayout({ panelCorners: otherCorners }, true); ctx.chrome(); } }, 'Use page radius') : null,
            h('button', { class: 'btn', type: 'button', onclick: () => markDownbeat(p, p === downbeat) }, p === downbeat ? 'Clear downbeat' : 'Mark downbeat'),
            beat ? h('p', { class: 'note' }, h('strong', {}, 'Beat: '), beat.desc || '(no description)') : h('p', { class: 'note' }, 'No beat for this panel yet.')),
        );
      }
      el.append(
        h('div', { class: 'sec' }, h('h4', {}, 'Page'),
          h('div', { class: 'rows' }, 'Cuts', h('b', {}, String(page.cuts.length))),
          unused > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => {
            studio.editPage(page, 'Remove unused cuts', ['cuts'], (p) => { p.cuts = p.cuts.filter((cut) => activeCuts.has(cut.id)); });
            ctx.chrome();
          } }, `Remove ${unused} unused ${unused === 1 ? 'cut' : 'cuts'}`) : null,
          h('div', { class: 'rows' }, 'Beats', h('b', {}, String(page.beats.length))),
          downbeat ? h('div', { class: 'rows' }, 'Downbeat', h('b', {}, 'Panel ' + (downbeat.index + 1))) : null,
          !downbeat && ps.length > 1 ? h('button', { class: 'btn', type: 'button', onclick: () => markDownbeat(ps.at(-1)!) }, 'Mark last panel as downbeat') : null,
          crossing ? h('p', { class: 'note' }, 'A gutter crossing sits at the centre. Stagger the cuts to move attention away from the crossing.') : null,
          staggered ? h('button', { class: 'btn', type: 'button', onclick: () => {
            studio.editPage(page, 'Stagger centre crossing', ['cuts'], (pg) => (pg.cuts = staggered));
            ctx.chrome();
          } }, 'Stagger centre') : null,
          ...revealIssues(book, page, ps).map(({ text }) => h('p', { class: 'warnline' }, text)),
          page.beats.length && ps.length !== page.beats.length ? h('p', { class: 'note' }, h('strong', {}, 'Count differs: '), `${page.beats.length} beats, ${ps.length} panels.`) : null,
          h('p', { class: 'note' }, 'One panel cuts the first panel you cross completely. Across page cuts every panel along the swipe.')),
      );
    },
    contextMenu() {
      const use = (id: string, variant?: string) => () => { if (variant) ctx.setVariant(id, variant); mode.tool = id; ctx.chrome(); ctx.request(); };
      const knife = variantOf(mode, 'knife');
      return [
        { label: 'Across page', key: 'K', checked: mode.tool === 'knife' && knife === 'across', run: use('knife', 'across') },
        { label: 'One panel', checked: mode.tool === 'knife' && knife === 'panel', run: use('knife', 'panel') },
        { label: 'Uncut', key: 'E', checked: mode.tool === 'erase', run: use('erase') },
        { label: 'Resize gutters', key: 'R', checked: mode.tool === 'resize', run: use('resize') },
        { label: 'Transform panel', key: 'V', checked: mode.tool === 'place', run: use('place') },
        { label: 'Curve edges', key: 'B', checked: mode.tool === 'curve', run: use('curve') },
        'sep',
        { label: 'Page templates…', run: templates },
        { label: 'Even out', disabled: !canEvenOut(page), run: () => studio.editPage(page, 'Even out', ['cuts'], (q) => (q.cuts = evenOut(q))) },
      ];
    },
    down(p, e) {
      if (mode.tool === 'place') { placement.down(p, e); return; }
      if (mode.tool === 'curve') {
        const c = curveCut();
        const reach = (e.pointerType === 'touch' ? 16 : 10) / ctx.scale();
        const hit = c ? controlsFor(c).findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < reach) : -1;
        if (hit >= 0) curveDrag = hit as 0 | 1;
        else curveId = gutterAt(p, reach)?.cut.id;
        return;
      }
      if (mode.tool === 'knife') {
        trail = [p];
        straight = e.shiftKey;
        heldStraight = false;
        held = null;
        snapped = false;
        shiftSteps = false;
        sel = panelIndexAt(p);
        return;
      }
      if (mode.tool === 'resize') {
        const reach = (e.pointerType === 'touch' ? 15 : 8) / ctx.scale();
        const edge = handleAt(p, reach) ?? gutterAt(p, reach);
        if (!edge) sel = panelIndexAt(p);
        const moves = edge ? [edge] : panelMoves();
        if (moves.length) drag = { moves, start: p, before: page.cuts, count: ctx.panels().length, blocked: false, whole: !edge };
        ctx.chrome();
        return;
      }
    },
    move(p, e) {
      if (mode.tool === 'place') { placement.move(p, e); return; }
      if (curveDrag !== undefined) {
        const original = page.cuts.find((c) => c.id === curveId);
        if (!original) return;
        const handles = [...controlsFor(original)] as [Pt, Pt];
        handles[curveDrag] = p;
        const cuts = movePanelCuts(page, new Map(), layoutOf(page), new Map([[original.id, { ...original, handles }]]));
        const next = { ...page, cuts };
        if (sameGutterTopology(page, next)) preview = { page: next, panels: derivePanels(next) };
        return;
      }
      if (trail && held) {
        trail = adjustCut(held.cut, held.grab, p, ctx.scale()).pts;
        if (held.cut.kind === 'line' && trail.length === 2) {
          const sn = snapCutEnd(trail[0]!, trail[1]!, e.shiftKey ? 15 : 0);
          trail = [trail[0]!, sn.end];
          snapped = sn.snapped;
          shiftSteps = e.shiftKey;
        }
        return;
      }
      if (trail) {
        straight = e.shiftKey || heldStraight;
        if (straight) {
          // straight cuts click to level, upright and diagonals; Shift steps by 15°
          const sn = snapCutEnd(trail[0]!, p, e.shiftKey ? 15 : 0);
          trail = [trail[0]!, sn.end];
          snapped = sn.snapped;
          shiftSteps = e.shiftKey;
        }
        else if (Math.hypot(p.x - trail[trail.length - 1]!.x, p.y - trail[trail.length - 1]!.y) > 2.2 / ctx.scale()) {
          trail.push(p);
          holdToStraight();
        }
        return;
      }
      if (drag) {
        const d = drag;
        const delta = { x: p.x - d.start.x, y: p.y - d.start.y };
        if (!preview && Math.hypot(delta.x, delta.y) * ctx.scale() < 3) return;
        const grid = page.grid ?? book.fixedGrid;
        const axes = showGrid && grid && !e.shiftKey && !d.whole ? gridLines(page, grid) : undefined;
        const shifts = new Map(d.moves.map((m) => {
          const at = m.cut.pts[0]![m.axis] + delta[m.axis];
          const snap = axes?.[m.axis].find((v) => Math.abs(v - at) * ctx.scale() <= 8);
          return [m.cut.id, { axis: m.axis, by: snap === undefined ? delta[m.axis] : snap - m.cut.pts[0]![m.axis] }];
        }));
        const next = movePanelCuts({ ...page, cuts: d.before }, shifts);
        const movedPage = { ...page, cuts: next };
        const panels = derivePanels(movedPage);
        d.blocked = panels.length !== d.count || !sameGutterTopology(page, movedPage) || panels.some(({ bbox }) => bbox.x1 - bbox.x0 < 0.08 || bbox.y1 - bbox.y0 < 0.08);
        if (d.blocked) return;
        preview = [...shifts.values()].some((v) => Math.abs(v.by) > 1e-6) ? { page: movedPage, panels } : undefined;
      }
    },
    hover(p) {
      hoverCut = null;
      if (p && (mode.tool === 'erase' || mode.tool === 'resize')) hoverCut = gutterAt(p, 8 / ctx.scale());
    },
    up(p, e) {
      if (mode.tool === 'place') { placement.up(p, e); return; }
      clearTimeout(holdTimer);
      if (e.type === 'pointercancel') { cancelDrag(); ctx.chrome(); return; }
      if (mode.tool === 'erase') {
        const c = gutterAt(p, (e.pointerType === 'touch' ? 15 : 8) / ctx.scale());
        if (c) {
          studio.editPage(page, 'Remove cut', ['cuts'], (pg) => (pg.cuts = pg.cuts.filter((x) => x.id !== c.cut.id)));
          sel = null;
          ctx.chrome();
        }
        return;
      }
      if (curveDrag !== undefined) {
        const cuts = preview?.page.cuts;
        curveDrag = undefined;
        preview = undefined;
        if (cuts) studio.editPage(page, 'Curve panel edge', ['cuts'], (pg) => { pg.cuts = cuts; });
        ctx.chrome();
        return;
      }
      if (trail) {
        const shaped = held;
        held = null;
        const isStraight = shaped ? shaped.cut.kind === 'line' : straight || heldStraight || e.shiftKey;
        // a straight cut ends where its snapped preview ends
        const points = shaped && shaped.cut.kind !== 'line' ? adjustCut(shaped.cut, shaped.grab, p, ctx.scale()).pts
          : isStraight ? [trail[0]!, trail.length === 2 ? trail[1]! : snapCutEnd(trail[0]!, p, e.shiftKey ? 15 : 0).end] : [...trail, p];
        const { plan, gridGutter, placed } = knifePreview(points, isStraight);
        trail = null;
        sel = null; // reading-order indices shift when panels split
        if (plan) {
          const cut = { id: newCutId(), ...plan.cut };
          const useGridGutter = gridGutter !== undefined && !page.cuts.length;
          studio.editPage(page, placed || cutMode() === 'panel' ? 'Cut panel' : 'Cut across', useGridGutter || placed ? ['cuts', 'layout'] : ['cuts'], (pg) => {
            if (useGridGutter) pg.layout = { ...layoutOf(pg), gutter: gridGutter };
            pg.cuts.push(cut);
            // both halves of a moved panel keep its move, so the slice stays where it was drawn
            if (placed?.transform && placed.source) {
              const t = placed.transform;
              const extra = derivePanels(pg).filter((q) => !q.transform && pointInPoly(q.centroid, placed.source!.pts))
                .map((q) => ({ at: { x: q.centroid.x / pg.widthIn, y: q.centroid.y / pg.heightIn }, matrix: [...t.matrix] as typeof t.matrix, order: t.order }));
              if (extra.length) pg.layout = { ...layoutOf(pg), panelTransforms: [...(layoutOf(pg).panelTransforms ?? []), ...extra] };
            }
          });
          studio.markStage(page, 'layout', 1);
          ctx.chrome();
        } else if (points.some((q) => Math.hypot(q.x - points[0]!.x, q.y - points[0]!.y) * ctx.scale() >= 18)) {
          toast(cutMode() === 'panel' ? 'Draw the line across the panel you want to cut.' : 'Draw a longer line across the page.');
        }
        return;
      }
      if (drag) {
        const { whole, before } = drag;
        const now = preview?.page.cuts;
        drag = null;
        preview = undefined;
        if (now && page.cuts === before) studio.editPage(page, whole ? 'Move panel boundaries' : 'Move gutter', ['cuts'], (pg) => (pg.cuts = now));
        ctx.chrome();
      }
    },
    layoutPreview: () => placement.preview() ?? preview,
    viewBleed: () => mode.tool === 'place' && placement.showBleed(),
    overlay(g, s) {
      const ps = displayPanels();
      const grid = page.grid ?? book.fixedGrid;
      if (showGrid && grid) drawModularGrid(g, page, grid, s);
      const downbeat = downbeatPanel(page, ps);
      // panel numbers
      g.save();
      g.font = `600 ${Math.max(10, 0.11 * s)}px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of ps) {
        const at = panelNumberAt(p, displayPage(), s);
        if (!at) continue;
        g.fillStyle = p === downbeat ? '#8F4723' : 'rgba(25,26,31,.55)';
        g.fillText((p === downbeat ? '◆ ' : '') + String(p.index + 1).padStart(2, '0'), at.x * s, at.y * s);
      }
      const p = selected();
      if (mode.tool === 'place') placement.overlay(g, s, p);
      else if (p) {
        g.fillStyle = 'rgba(47,111,126,.10)';
        g.fill(panelPath(p.pts, s));
        g.strokeStyle = '#2F6F7E';
        g.lineWidth = 2;
        g.setLineDash([7, 5]);
        g.stroke(panelPath(p.pts, s));
        g.setLineDash([]);
      }
      if (mode.tool === 'resize') {
        for (const hd of handles()) {
          g.fillStyle = '#FFFDF7';
          g.strokeStyle = '#2F6F7E';
          g.lineWidth = 2;
          g.beginPath();
          g.roundRect(hd.at.x * s - 6, hd.at.y * s - 6, 12, 12, 2);
          g.fill();
          g.stroke();
        }
        if (p && panelMoves().length) {
          const { x, y } = p.centroid;
          g.fillStyle = '#2F6F7E';
          g.font = 'bold 18px sans-serif';
          g.textBaseline = 'middle';
          g.fillText('✥', x * s, y * s);
        }
      }
      if (mode.tool === 'curve') {
        const c = curveCut();
        if (c) {
          const path = c.extended?.length ? c.extended : c.pts;
          const handles = controlsFor(c);
          g.strokeStyle = '#2F6F7E'; g.lineWidth = 1.5; g.fillStyle = '#fff';
          for (const [i, q] of handles.entries()) {
            const a = i === 0 ? path[0]! : path.at(-1)!;
            g.beginPath(); g.moveTo(a.x * s, a.y * s); g.lineTo(q.x * s, q.y * s); g.stroke();
            g.beginPath(); g.arc(q.x * s, q.y * s, 5, 0, Math.PI * 2); g.fill(); g.stroke();
          }
        }
      }
      const highlighted = drag?.moves.map((m) => m.cut.id) ?? (hoverCut ? [hoverCut.cut.id] : []);
      g.save();
      g.beginPath(); g.rect(0, 0, page.widthIn * s, page.heightIn * s); g.clip();
      for (const { cut, points } of gutterPaths(displayPage())) {
        if (!highlighted.includes(cut.id)) continue;
        g.strokeStyle = mode.tool === 'erase' || drag?.blocked ? '#B8432F' : '#2F6F7E';
        g.lineWidth = 3;
        g.setLineDash([6, 5]);
        g.beginPath();
        points.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
      if (trail && trail.length > 1) {
        const { stroke, plan } = knifePreview(trail, straight || heldStraight);
        g.strokeStyle = plan ? '#2F6F7E' : '#B8432F';
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        g.setLineDash([8, 7]);
        g.beginPath();
        stroke.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
        g.stroke();
        drawAngle(g, s, trail[0]!, trail.at(-1)!, trail.length === 2 && snapped);
      }
      g.restore();
    },
    key(e) {
      if (e.key === 'Escape') {
        cancelDrag();
        sel = null;
        ctx.chrome();
        ctx.request();
        return true;
      }
      return false;
    },
    dispose() { cancelDrag(); bins.dispose(); },
  };
  return mode;
}
