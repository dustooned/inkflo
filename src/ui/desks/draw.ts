import { findLayer, newLayer, PT, type Fill, type Layer, type LayerGroup, type LayerType, type Pass, type Pt, type Stroke } from '../../doc/model';
import { DEFAULT_BRUSH, entry, PASS_STYLE, withGPenPressure, type BrushEntry, type GPenPressure } from '../../draw/brushes';
import { AssistLock, DEFAULT_RULER, focusLines, speedLines, type GenLine, type Ruler, type RulerKind } from '../../draw/assist';
import { dabsForStroke } from '../../engine/brush/dabs';
import { smoothStroke } from '../../engine/brush/smoothing';
import { constrainShape, editShape, pressureProfile, recognizeShape, SHAPE_NAMES, type Shape } from '../../engine/core/quickshape';
import { shapeStrokePoints } from '../../draw/shapeedit';
import { brushPicker, brushStudio, warmBrush } from '../brushui';
import { brushControl, clampToolValue } from '../brushcontrols';
import { imagePlacement } from '../imageplacement';
import { vectorSelection } from '../vectorselection';
import { rasterSelection } from '../rasterselection';
import { quickShapeEditor } from '../quickshapeedit';
import { smudgeTool } from '../smudgetool';
import { placementOf, type Placement } from '../placement';
import { screentoneTool } from '../screentone';
import { openAdjustments } from '../adjustments';
import { openBookAssets } from '../bookassets';
import { MARQUEE_SHAPES, marqueeShape } from '../marquee';
import { closePopover, popover } from '../popover';
import type { SymmetryMode } from '../../engine/core/adjust';
import { layerKit, paintFill, passForType, rebuildPage, refAlpha, strokeStyle, type FillPaint, type LinePass } from '../../draw/replay';
import { FILL_THRESHOLD, FillKit, flatColours, openEnds } from '../../draw/fillkit';
import type { Panel } from '../../geom/carve';
import { planeCanvas, touchLayer } from '../../draw/residency';
import { DabWalker } from '../../engine/brush/dabs';
import { putPixels, RasterEngine } from '../../engine/brush/raster';
import { Smoother } from '../../engine/brush/smoothing';
import type { StrokePoint, StrokeRecord } from '../../engine/core/stroke';
import { mapPanelPoint, panelAt } from '../../geom/carve';
import { invert, type Mat } from '../../engine/core/selxform';
import { nearestGuide } from '../../geom/composition';
import { prefs } from '../prefs';
import { groupAt, groupLabel, insertIndex, layerOfType, panelForGroup } from '../../geom/groups';
import { browserPlaneOps } from '../../io/canvasops';
import { variantOf, type DeskCtx, type DeskMode } from '../desk';
import { confirmDialog, h, seg, slider, toast } from '../dom';
import { layersPanel, type LayerScope, type LayerTarget, type LayerView } from '../layerspanel';
import { drawVectorStroke, renderVectorLayer } from '../../render/vector';
import { applyPanelTransform, renderPage } from '../../render/page';
import { brushWidth, eraseStrokes, hitStroke, pointAt, removePoint, reshape, scaleWidth, simplify, smooth, type VectorErase } from '../../draw/vectoredit';

type SizedTool = 'pencil' | 'ink' | 'eraser';
const MIN_SIZE = 0.25;
const SIZE_STEP = 0.05;
const maxSize = (tool: SizedTool) => tool === 'eraser' ? 72 : 36;

/** Device-remembered inking setup (never book data). */
interface InkPrefs {
  brush: Record<LinePass, string>;
  vectorBrush?: string;
  vectorStabilize?: number;
  gPenPressure?: GPenPressure;
  symmetry?: SymmetryMode;
  sizes: Record<string, number>;
  opacity: Record<string, number>;
  color: string;
  /** Live stabilizer (pulled string) per tool, 0-1; missing = the brush's own. */
  stabilize: Partial<Record<LinePass, number>>;
  /** Post-correction after the pen lifts, 0-1. */
  correct: number;
  quickShape: boolean;
  ruler: Ruler;
  focus: { count: number; inner: number; jitter: number };
  speed: { count: number; jitter: number; length: number; angle: number };
}
const INK_KEY = 'inkflo.ink.v1';
const INK_DEFAULTS: InkPrefs = {
  brush: { ...DEFAULT_BRUSH },
  sizes: {},
  opacity: {},
  color: PASS_STYLE.ink.color,
  stabilize: {},
  correct: 0.3,
  quickShape: true,
  ruler: DEFAULT_RULER,
  focus: { count: 90, inner: 0.45, jitter: 0.5 },
  speed: { count: 40, jitter: 0.5, length: 0.75, angle: 0 },
};
function readInk(): InkPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(INK_KEY) ?? '{}') as Partial<InkPrefs>;
    return {
      ...structuredClone(INK_DEFAULTS),
      ...v,
      brush: { ...INK_DEFAULTS.brush, ...v.brush },
      gPenPressure: v.gPenPressure === 'light' || v.gPenPressure === 'firm' ? v.gPenPressure : 'balanced',
      sizes: v.sizes && typeof v.sizes === 'object' ? v.sizes : {},
      symmetry: ['vertical', 'horizontal', 'quadrant', 'radial'].some((mode) => mode === v.symmetry) ? v.symmetry : 'off',
      opacity: v.opacity && typeof v.opacity === 'object' ? v.opacity : {},
      color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : INK_DEFAULTS.color,
      ruler: { ...structuredClone(DEFAULT_RULER), ...v.ruler },
      focus: { ...INK_DEFAULTS.focus, ...v.focus },
      speed: { ...INK_DEFAULTS.speed, ...v.speed },
    };
  } catch {
    return structuredClone(INK_DEFAULTS);
  }
}
const ink = readInk();
function saveInk(): void {
  try {
    localStorage.setItem(INK_KEY, JSON.stringify(ink));
  } catch {
    /* private mode: the session still works */
  }
}
const RULERS: { id: RulerKind; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'straight', label: 'Straight' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'radial', label: 'Radial' },
  { id: 'perspective', label: 'Perspective' },
];
/** Hold still this long at the end of a stroke to snap it to a shape. */
const QUICKSHAPE_MS = 550;
const PALETTE = ['#E8C4A0', '#C8553D', '#F2C230', '#5B8E7D', '#3F6C9E', '#7D5BA6', '#8A8A8A', '#FFFDF7', '#2B2D33'];
type EditVariant = 'pull' | 'nodes' | 'move' | 'wider' | 'thinner';
const vstate = {
  /** Vector eraser mode. */
  erase: 'crossing' as VectorErase,
  /** How much line follows a pulled point, inches. */
  pullR: 0.6,
  /** Width brush radius, inches. */
  widthR: 0.12,
};
const FILL_GAP = 0.02;
const state = {
  showPencil: true,
  color: PALETTE[1]!,
  gap: FILL_GAP,
  /** Line alpha that counts as a wall (Procreate's threshold; drag sideways while filling). */
  threshold: FILL_THRESHOLD,
  /** Grow (+) / shrink (−) fills, inches. */
  grow: 0,
  referAll: false,
  /** Leftover brush radius, inches. */
  leftR: 0.06,
  /** Closure check: open line ends + what a tap would fill. */
  check: false,
};
type FillVariant = 'bucket' | 'drag' | 'lasso' | 'leftover' | 'flats';
const FILL_HINT: Record<FillVariant, string> = {
  bucket: 'Tap an area. Drag sideways before lifting to tighten or loosen what counts as a line.',
  drag: 'Sweep across areas: each one you cross fills.',
  lasso: 'Draw a loop: every closed area inside it fills (hair, lace, crowds).',
  leftover: 'Scrub over specks the fill missed: they take the colour around them.',
  flats: 'Click a panel: every closed area gets its own flat colour, ready to recolour.',
};
/** The selected layer per page, for the session. */
const activeLayer = new Map<string, string>();
const targetByPage = new Map<string, LayerTarget>();

let seedCounter = 1;

/**
 * Draw: brushes and fills on typed layers. With Target "Panel under pen" (the default) a stroke
 * goes to its tool's layer type in the panel it starts in, created when missing. With "Selected
 * layer" any brush draws on the layer chosen in the Layers panel.
 */
export function drawDesk(ctx: DeskCtx): DeskMode {
  const { studio, page, art, book } = ctx;
  let target = targetByPage.get(page.id) ?? 'auto';
  let layerScope: LayerScope = 'context';
  let layerView: LayerView = { kind: 'stack' };
  let contextGroupId: string | null = null;
  let lastCanvasGroupId: string | null = null;
  let picker: HTMLElement | null = null;
  let pickerAnchor: HTMLButtonElement | null = null;
  let dismissPicker: (() => void) | null = null;
  const dpi = book.dpi;
  const engine = new RasterEngine(art.width, art.height);
  const shapeEditor = quickShapeEditor(ctx, engine, editVector);
  let shapeTool: string | null = null;
  const shapeActions = h('aside', { class: 'quickshape-actions', 'aria-label': 'QuickShape controls', hidden: true });
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) shapeActions.addEventListener(event, (e) => e.stopPropagation());
  ctx.stage.append(shapeActions);
  function refreshShapeActions(): void {
    if (mode.tool !== shapeTool) shapeEditor.clear();
    const actions = shapeEditor.controls();
    shapeActions.replaceChildren(...actions);
    shapeActions.hidden = !actions.length;
  }
  let live: {
    layerId: string;
    record: StrokeRecord;
    walker: DabWalker;
    smoother: Smoother;
    assist: AssistLock<StrokePoint>;
    stroke: Stroke;
    last: StrokePoint;
    /** Raw points as the pen moved (QuickShape reads these). */
    raw: StrokePoint[];
    holdAt: Pt | null;
    shape: { original: Shape; shown: Shape; grab: Pt; at: Pt; pressure: number[]; shift: boolean } | null;
    /** Vector pen: no dabs; the outline is drawn in the overlay until it lands. */
    vector: boolean;
    inverse: Mat | null;
  } | null = null;
  /** Vector edits in progress. */
  let vdrag: { layerId: string; before: Stroke[]; index: number; grabbed: Stroke; grab: number; from: Pt; moved: boolean; kind: 'pull' | 'move' } | null = null;
  let vbrush: { layerId: string; before: Stroke[]; last: Pt } | null = null;
  let verase: Pt[] | null = null;
  /** The selected vector line (Edit lines). */
  let vsel: { layerId: string; index: number } | null = null;
  let selectedNode: number | null = null;
  let holdTimer = 0;
  let constrainTouch = false;
  let pickingColor = false;
  /** A ruler handle being dragged. */
  let dragHandle: ((p: Pt) => void) | null = null;
  /** Speed lines: the drag that sets their angle. */
  let lineDrag: { from: Pt; to: Pt } | null = null;
  let hover: Pt | null = null;
  let kitCache: { key: string; panels: Panel[]; kit: FillKit } | null = null;
  /** Bucket in hand: the seed, the threshold being dragged, and its preview. */
  let pour: { at: Pt; layerId: string; created: boolean; x0: number; base: number; threshold: number } | null = null;
  /** Drag / lasso / leftover path in progress (page inches). */
  let sweep: Pt[] | null = null;
  let preview: { layerId: string; img: HTMLCanvasElement; x0: number; y0: number } | null = null;
  let previewAt = 0;
  let endsCache: { key: string; ends: Pt[] } | null = null;
  // pages drawn on stay in memory for the session, so pixel undo always has its canvases
  let pinned = false;
  const keepResident = () => {
    if (pinned) return;
    pinned = true;
    void studio.residency.pin(art);
  };

  const eraseType = (): LayerType => (variantOf(mode, 'eraser') === 'pencil' ? 'pencil' : 'ink');
  const sizeTool = (): SizedTool | null => (mode.tool === 'vpen' ? 'ink' : mode.tool === 'pencil' || mode.tool === 'ink' || mode.tool === 'eraser' ? mode.tool : null);
  /** The brush slot a tool uses: the vector pen draws with the ink brush (as outlines). */
  const brushTool = (): LinePass | null => (mode.tool === 'vpen' ? 'ink' : mode.tool === 'pencil' || mode.tool === 'ink' ? mode.tool : null);
  const vectorErase = () => mode.tool === 'eraser' && variantOf(mode, 'eraser') === 'vector';
  const currentBrush = (t: LinePass): BrushEntry => {
    const e = entry(mode.tool === 'vpen' ? ink.vectorBrush ?? '2dope-vector-ink' : ink.brush[t]);
    return withGPenPressure(e ?? entry(DEFAULT_BRUSH[t])!, ink.gPenPressure ?? 'balanced');
  };
  const brushKey = (t: SizedTool) => t === 'eraser' ? 'eraser' : (mode.tool === 'vpen' ? 'vector' : t) + ':' + currentBrush(t).id;
  const sizeIn = (t: SizedTool) => {
    const saved = ink.sizes[brushKey(t)];
    const base = t === 'eraser' ? 0.09 : currentBrush(t).w;
    return clampToolValue(Number.isFinite(saved) ? saved! : base * PT, MIN_SIZE, maxSize(t), SIZE_STEP) / PT;
  };
  const toolOpacity = (t: SizedTool) => {
    const value = ink.opacity[brushKey(t)];
    return Number.isFinite(value) ? clampToolValue(value!, 1, 100, 1) / 100 : 1;
  };
  const controls = h('aside', { class: 'brush-controls', 'aria-label': 'Brush controls', hidden: true });
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) controls.addEventListener(event, (e) => e.stopPropagation());

  function showBrushControls(t: SizedTool | null): void {
    controls.hidden = !t;
    if (!t) return;
    const key = brushKey(t);
    controls.replaceChildren(
      brushControl('Size', 'pt', sizeIn(t) * PT, MIN_SIZE, maxSize(t), SIZE_STEP, (v) => { ink.sizes[key] = v; ctx.request(); }, saveInk, true),
      ...(vectorErase() ? [] : [brushControl('Opacity', '%', toolOpacity(t) * 100, 1, 100, 1, (v) => { ink.opacity[key] = v; }, saveInk)]),
    );
  }
  const stabilizeOf = (t: LinePass): number => (mode.tool === 'vpen' ? ink.vectorStabilize : ink.stabilize[t]) ?? currentBrush(t).settings.smoothing;
  function pickBrush(t: LinePass, e: BrushEntry): void {
    if (mode.tool === 'vpen') { ink.vectorBrush = e.id; delete ink.vectorStabilize; }
    else { ink.brush[t] = e.id; delete ink.stabilize[t]; }
    saveInk();
    ctx.chrome();
    ctx.request();
  }
  const active = (): { group: LayerGroup; layer: Layer } | null => {
    const id = activeLayer.get(page.id);
    return id ? findLayer(page, id) : null;
  };
  function adjustLayer(): void {
    const group = contextGroup();
    const paint = group?.layers.find((l) => l.visible && !l.locked && !l.vector && !l.image && !l.screenTone && art.planes[l.id]);
    openAdjustments(ctx, target === 'layer' ? active()?.layer.id ?? null : paint?.id ?? null, keepResident);
  }
  const tone = screentoneTool(ctx, (id) => { activeLayer.set(page.id, id); ctx.chrome(); });
  const selectImage = (id: string) => {
    activeLayer.set(page.id, id);
    contextGroupId = active()?.group.id ?? null;
    mode.tool = 'image';
    setTarget('auto');
  };
  const images = imagePlacement(ctx, () => active()?.layer.id ?? null, selectImage);

  function contextGroup(): LayerGroup | undefined {
    ctx.panels();
    const match = (id: string | null) => page.groups.find((g) => g.id === id);
    return match(contextGroupId) ?? (target === 'layer' ? active()?.group : undefined) ??
      match(lastCanvasGroupId) ?? page.groups.find((g) => g.kind === 'panel') ?? page.groups[0];
  }

  function setTarget(next: LayerTarget): void {
    pixels.clear();
    smudge.clear();
    shapeEditor.clear();
    target = next;
    targetByPage.set(page.id, next);
    ctx.chrome();
    ctx.request();
  }

  function refreshPicker(focus = false): void {
    if (!picker) return;
    const focused = document.activeElement;
    const hadFocus = focused instanceof HTMLElement && picker.contains(focused);
    const token = hadFocus ? focused.dataset.focus ?? focused.getAttribute('aria-label') ?? focused.textContent?.trim() : null;
    const scroll = picker.scrollTop;
    picker.replaceChildren(layersPanel({
      studio,
      page,
      panels: ctx.panels(),
      active: active()?.layer.id ?? null,
      target,
      scope: layerScope,
      art,
      contextGroup: contextGroup()?.id ?? null,
      view: layerView,
      onTarget: setTarget,
      onScope: (scope) => { layerScope = scope; refreshPicker(true); },
      onContext: (id) => { contextGroupId = id; refreshPicker(true); },
      onView: (view) => { layerView = view; if (picker) picker.scrollTop = 0; refreshPicker(true); },
      onEditTone: (id) => { dismissPicker?.(); tone.edit(id); },
      onSelect: (id) => {
        if (id && findLayer(page, id)?.layer.image) { dismissPicker?.(); selectImage(id); return; }
        if (id) {
          activeLayer.set(page.id, id);
          contextGroupId = active()?.group.id ?? null;
        } else activeLayer.delete(page.id);
        setTarget(id ? 'layer' : 'auto');
      },
      refresh: () => { ctx.chrome(); ctx.request(); },
    }));
    picker.scrollTop = scroll;
    if (hadFocus || focus) {
      const controls = [...picker.querySelectorAll<HTMLElement>('button:not([disabled]), select, input')];
      const same = token ? controls.find((e) => (e.dataset.focus ?? e.getAttribute('aria-label') ?? e.textContent?.trim()) === token) : undefined;
      (same ?? picker.querySelector<HTMLElement>('[aria-label="Back to layers"], [aria-label="Layer view"] [aria-pressed="true"]'))?.focus({ preventScroll: true });
    }
  }

  function layerButton(side: 'below' | 'left'): HTMLButtonElement {
    const button = h('button', { class: 'btn layer-trigger', type: 'button', 'aria-label': 'Layers', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    button.addEventListener('click', () => {
      if (pickerAnchor === button) {
        dismissPicker?.();
        return;
      }
      dismissPicker?.();
      pickerAnchor = button;
      layerView = { kind: 'stack' };
      picker = h('div', { class: 'layer-picker' });
      refreshPicker();
      button.setAttribute('aria-expanded', 'true');
      dismissPicker = popover(button, picker, side, 'Layers', () => {
        button.setAttribute('aria-expanded', 'false');
        picker = null;
        pickerAnchor = null;
        dismissPicker = null;
      });
      picker.querySelector<HTMLElement>('[aria-label="Layer view"] [aria-pressed="true"]')?.focus();
    });
    return button;
  }

  const contextLayers = layerButton('below');
  const inspectorLayers = layerButton('left');
  function updateLayerButton(button: HTMLButtonElement): void {
    const pinned = target === 'layer' ? active()?.layer.name : null;
    const hint = target === 'auto' ? 'Panel under pen' : pinned ?? 'Choose a layer';
    button.title = 'Layers · ' + hint;
    button.replaceChildren(h('span', {}, 'Layers'),
      h('small', {}, target === 'auto' ? 'Panel under pen' : pinned ?? 'Choose layer'),
      h('span', { class: 'layer-chevron', 'aria-hidden': 'true' }, '▾'));
  }

  /** Add a layer of a type to a group as its own command; returns its id. */
  function addLayer(group: LayerGroup, type: LayerType, vector = false): string {
    const layer = newLayer(type);
    if (vector) {
      layer.vector = true;
      layer.name = `Vector ${layer.name.toLowerCase()}`;
    }
    const gid = group.id;
    studio.editPage(page, vector ? 'New vector layer' : `New ${type} layer`, ['groups'], (pg) => {
      const g = pg.groups.find((x) => x.id === gid)!;
      g.layers.splice(insertIndex(g, type), 0, layer);
    });
    return layer.id;
  }

  /**
   * Where the next mark goes. Returns the layer id and whether a layer was just created (so the
   * mark and the new layer combine into one undo step), or a reason it can't draw.
   */
  function resolve(p: Pt, type: LayerType, create: boolean, vector = false): { layerId: string; created: boolean } | string {
    if (target === 'layer') {
      const a = active();
      if (!a) return 'Open Layers to choose a layer or switch to “Panel under pen”.';
      if (a.layer.locked || a.group.locked) return `“${a.layer.name}” is locked.`;
      if (a.layer.image || a.layer.screenTone) return 'Choose a drawing layer or switch to Panel under pen.';
      if (!a.layer.visible || !a.group.visible) return `“${a.layer.name}” is hidden.`;
      if (!!a.layer.vector !== vector) return a.layer.vector ? `“${a.layer.name}” is a vector layer: draw on it with the Vector pen.` : `“${a.layer.name}” is not a vector layer: the Vector pen draws on vector layers.`;
      return { layerId: a.layer.id, created: false };
    }
    const group = groupAt(page, ctx.panels(), p);
    if (group.locked || !group.visible) return `${groupLabel(page, ctx.panels(), group)} is ${group.locked ? 'locked' : 'hidden'}.`;
    const existing = layerOfType(group, type, vector);
    if (existing) {
      if (existing.locked) return `“${existing.name}” in ${groupLabel(page, ctx.panels(), group)} is locked.`;
      if (!existing.visible) return `“${existing.name}” in ${groupLabel(page, ctx.panels(), group)} is hidden.`;
      return { layerId: existing.id, created: false };
    }
    if (!create) return `No ${type} layer in ${groupLabel(page, ctx.panels(), group)} to erase.`;
    return { layerId: addLayer(group, type, vector), created: true };
  }

  function sample(p: Pt, e: PointerEvent): StrokePoint {
    const pressure = e.pointerType === 'pen' ? e.pressure : e.pointerType === 'mouse' ? 1 : e.pressure || 0.5;
    const tilt = ctx.toPageDirection({ x: Math.tan((e.tiltX || 0) * Math.PI / 180), y: Math.tan((e.tiltY || 0) * Math.PI / 180) });
    return {
      x: p.x * dpi, y: p.y * dpi, pressure,
      tiltX: Math.atan(tilt.x) * 180 / Math.PI, tiltY: Math.atan(tilt.y) * 180 / Math.PI,
      t: Math.max(0, e.timeStamp - t0),
    };
  }

  function colourAt(p: Pt): string | null {
    if (p.x < 0 || p.y < 0 || p.x >= page.widthIn || p.y >= page.heightIn) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const g = canvas.getContext('2d')!;
    const s = Math.min(dpi, 150);
    g.translate(-Math.floor(p.x * s), -Math.floor(p.y * s));
    renderPage(g, page, art, { scale: s, panels: ctx.panels(), types: { pencil: state.showPencil }, balloons: false });
    const data = g.getImageData(0, 0, 1, 1).data;
    return '#' + Array.from(data.slice(0, 3), (n) => n.toString(16).padStart(2, '0')).join('');
  }

  function colourControls(fill: boolean): HTMLElement[] {
    const name = fill ? 'Fill colour' : 'Ink colour';
    const input = h('input', { type: 'color', value: fill ? state.color : ink.color, 'aria-label': name });
    input.addEventListener('input', () => {
      if (fill) state.color = input.value;
      else { ink.color = input.value; saveInk(); }
    });
    return [h('label', { class: 'mini' }, name, input),
      h('button', { type: 'button', class: 'btn', 'aria-pressed': String(pickingColor), onclick: () => { pickingColor = !pickingColor; ctx.chrome(); ctx.request(); } }, pickingColor ? 'Tap the canvas' : 'Eyedropper')];
  }
  let t0 = 0;
  let createdForStroke = false;

  function beginStroke(p: Pt, e: PointerEvent): void {
    const tool = sizeTool()!;
    const erase = tool === 'eraser';
    const vector = mode.tool === 'vpen';
    const type: LayerType = erase ? eraseType() : tool;
    const { guide, snapGuide } = prefs();
    const snap = !erase && snapGuide ? nearestGuide(guide, page.widthIn, page.heightIn, p, 8 / ctx.scale()) : undefined;
    if (snap) p = snap.point;
    const target = resolve(p, type, !erase, vector);
    if (typeof target === 'string') {
      toast(target);
      return;
    }
    createdForStroke = target.created;
    const layer = findLayer(page, target.layerId)!.layer;
    const group = findLayer(page, target.layerId)!.group;
    const placement = panelForGroup(ctx.panels(), group)?.transform;
    const inverse = placement ? invert(placement.matrix) : null;
    p = mapPanelPoint(p, inverse);
    // the brush's own pass (pencil blue / ink black), recorded when it differs from the layer's
    const pass: LinePass = erase ? passForType(layer.type) : currentBrush(tool as LinePass).pass;
    const brushId = erase ? DEFAULT_BRUSH[pass] : studio.brushId(currentBrush(tool as LinePass));
    const w = sizeIn(tool);
    const opacity = toolOpacity(tool);
    const color = !erase && pass === 'ink' && ink.color !== PASS_STYLE.ink.color ? ink.color : undefined;
    const seed = (Date.now() % 1_000_000) * 100 + (seedCounter++ % 100);
    const record: StrokeRecord = { id: `s${seed}`, ...strokeStyle(brushId, w, pass, dpi, erase, opacity, color), seed, points: [] };
    const sym = ink.symmetry;
    const symmetry = !vector && sym && sym !== 'off' ? { mode: sym, cx: page.widthIn / 2, cy: page.heightIn / 2 } : undefined;
    if (symmetry) record.sym = { mode: symmetry.mode, cx: symmetry.cx * dpi, cy: symmetry.cy * dpi };
    if (!vector) {
      const canvas = planeCanvas(art, layer.id, browserPlaneOps);
      engine.resize(art.width, art.height);
      engine.bind(canvas);
      engine.begin(record, null);
    }
    const stroke: Stroke = { pts: [], pressure: [], w, brushId, seed, ...(color ? { color } : {}), ...(opacity < 1 ? { opacity } : {}), ...(erase ? { erase: true } : {}), ...(!erase && pass !== passForType(layer.type) ? { pass } : {}) };
    if (symmetry) stroke.symmetry = symmetry;
    t0 = e.timeStamp;
    const b = record.brush;
    live = {
      layerId: layer.id,
      record,
      walker: new DabWalker(record.brush, seed),
      smoother: erase ? new Smoother(0, false) : new Smoother(stabilizeOf(tool as LinePass), b.pulledString, ctx.scale() / dpi, { stabilize: b.stabilize, motion: b.motionFilter, expression: b.expression }),
      assist: new AssistLock<StrokePoint>(
        snap ? { ...ink.ruler, kind: 'parallel', angle: snap.angle } : erase ? { ...ink.ruler, kind: 'off' } : rulerInPx(),
        { x: p.x * dpi, y: p.y * dpi },
        0.06 * dpi,
      ),
      stroke,
      last: { x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 0, t: 0 },
      raw: [],
      holdAt: null,
      shape: null,
      vector,
      inverse,
    };
    studio.drawing = true;
    addPoint(sample(p, e));
  }

  /** The ruler in canvas pixels (the stroke's units). */
  function rulerInPx(): Ruler {
    const r = ink.ruler;
    return { ...r, center: { x: r.center.x * dpi, y: r.center.y * dpi }, vps: r.vps.map((v) => ({ x: v.x * dpi, y: v.y * dpi })) };
  }

  function addPoint(sp: StrokePoint): void {
    if (!live || live.shape) return;
    live.raw.push(sp);
    for (const a of live.assist.push(sp)) {
      live.last = a;
      for (const q of live.smoother.push(a)) {
        live.record.points.push(q);
        if (!live.vector) engine.addDabs(live.walker.push(q));
      }
    }
    if (live.vector) ctx.request();
    // QuickShape: hold still at the end of a freehand stroke
    if (ink.quickShape && !live.assist.active && !live.stroke.erase) {
      const hold = live.holdAt;
      if (!hold || Math.hypot(sp.x - hold.x, sp.y - hold.y) * ctx.scale() / dpi >= 2) {
        live.holdAt = sp;
        clearTimeout(holdTimer);
        holdTimer = window.setTimeout(snapShape, QUICKSHAPE_MS);
      }
    }
  }

  /** Re-render the live stroke from its points (after a snap). */
  function repaintLive(): void {
    if (!live) return;
    if (live.vector) {
      ctx.request();
      return;
    }
    const pts = live.record.points;
    engine.begin(live.record);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    engine.addDabs(dabsForStroke(live.record.brush, live.record.seed, pts, len));
    ctx.request();
  }

  function snapShape(): void {
    if (!live || live.shape || live.raw.length < 4) return;
    const shape = recognizeShape(live.raw);
    if (!shape) return;
    const grab = live.raw.at(-1)!;
    live.shape = { original: shape, shown: shape, grab, at: grab, pressure: pressureProfile(shape, live.raw), shift: false };
    adjustShape(grab, false);
    toast(`${SHAPE_NAMES[shape.kind]} · drag to adjust · Shift or second finger to constrain`, 1800);
  }

  function adjustShape(p: Pt, shift: boolean): void {
    if (!live?.shape) return;
    const shape = live.shape;
    const { original, grab, pressure } = shape;
    shape.at = p;
    shape.shift = shift;
    const constrain = shift || constrainTouch;
    const edited = editShape(original, grab, p, constrain);
    shape.shown = constrain ? constrainShape(edited) : edited;
    live.record.points = shapeStrokePoints(shape.shown, pressure, dpi, live.raw[0]!.t);
    repaintLive();
  }

  /** The layer's stroke list, looked up by id (structure edits replace layer objects). */
  const strokesOf = (id: string) => findLayer(page, id)?.layer.strokes;
  const fillsOf = (id: string) => findLayer(page, id)?.layer.fills;

  function endStroke(allowShapeEdit = true): void {
    if (!live) return;
    const l = live;
    clearTimeout(holdTimer);
    if (!allowShapeEdit) {
      live = null;
      studio.drawing = false;
      if (!l.vector) engine.cancel();
      if (createdForStroke && ctx.stage.isConnected) studio.undo();
      ctx.request();
      return;
    }
    if (!l.shape) {
      for (const a of l.assist.flush()) {
        l.last = a;
        for (const q of l.smoother.push(a)) {
          l.record.points.push(q);
          if (!l.vector) engine.addDabs(l.walker.push(q));
        }
      }
      for (const q of l.smoother.finish(l.last)) {
        l.record.points.push(q);
        if (!l.vector) engine.addDabs(l.walker.push(q));
      }
    }
    live = null;
    studio.drawing = false;
    // post-correction: freehand strokes only (a ruler or a shape is already exact)
    const corrected = !l.shape && !l.assist.active && !l.stroke.erase && ink.correct > 0 && l.record.points.length > 2;
    if (corrected) l.record.points = smoothStroke(l.record.points, ink.correct);
    const pts = l.record.points;
    if (l.vector) {
      if (!pts.length) return;
      const stroke = l.stroke;
      if (l.record.brush.vectorStyle) stroke.styledVector = true;
      stroke.pts = pts.map((q) => ({ x: q.x / dpi, y: q.y / dpi }));
      stroke.pressure = pts.map((q) => Math.max(0, Math.min(1, q.pressure)));
      const layer = findLayer(page, l.layerId)!.layer;
      editVector(l.layerId, 'Vector line', [...layer.strokes, stroke]);
      if (createdForStroke) studio.history.combine(2, 'Vector line on a new layer');
      if (allowShapeEdit && l.shape) {
        shapeTool = mode.tool;
        shapeEditor.remember({ shape: l.shape.shown, pressure: l.shape.pressure, layerId: l.layerId, seed: stroke.seed, record: l.record });
      }
      studio.markStage(page, 'draw', 1);
      ctx.chrome();
      return;
    }
    if (!pts.length) {
      engine.cancel();
      return;
    }
    const commit = engine.commit(corrected || !!l.shape);
    if (!commit) return;
    const stroke = l.stroke;
    stroke.pts = pts.map((q) => ({ x: q.x / dpi, y: q.y / dpi }));
    stroke.pressure = pts.map((q) => Math.max(0, Math.min(1, q.pressure)));
    const canvas = art.planes[l.layerId]!;
    const id = l.layerId;
    keepResident();
    studio.run(
      {
        label: stroke.erase ? 'Erase' : 'Stroke',
        do: () => {
          putPixels(canvas, commit.rect, commit.after);
          strokesOf(id)?.push(stroke);
          touchLayer(art, id);
        },
        undo: () => {
          putPixels(canvas, commit.rect, commit.before);
          const list = strokesOf(id);
          const i = list ? list.findIndex((s) => s.seed === stroke.seed) : -1;
          if (list && i >= 0) list.splice(i, 1);
          touchLayer(art, id);
        },
      },
      true,
    );
    strokesOf(id)?.push(stroke); // applied above: the engine already painted it
    touchLayer(art, id);
    if (createdForStroke) studio.history.combine(2, stroke.erase ? 'Erase' : 'Stroke on a new layer');
    if (allowShapeEdit && l.shape) {
      shapeTool = mode.tool;
      shapeEditor.remember({ shape: l.shape.shown, pressure: l.shape.pressure, layerId: id, seed: stroke.seed, record: l.record, original: commit });
    }
    studio.markStage(page, 'draw', 1);
    ctx.chrome();
  }

  const fillVariant = (): FillVariant => (variantOf(mode, 'fill') || 'bucket') as FillVariant;

  /** The fill kit for a colour layer, cached until another layer or the panels change. */
  function kitFor(layerId: string): FillKit {
    const panels = ctx.panels();
    const revs = Object.entries(art.revs).filter(([id]) => id !== layerId).map(([id, r]) => `${id}:${r}`).join(',');
    const vis = page.groups.map((g) => `${g.visible ? 1 : 0}${g.layers.map((l) => `${l.id}${l.visible ? 1 : 0}${l.fillRef ? 1 : 0}`).join('')}`).join('|');
    const key = `${layerId}|${revs}|${vis}`;
    if (kitCache && kitCache.key === key && kitCache.panels === panels) return kitCache.kit;
    const layer = findLayer(page, layerId)!.layer;
    const kit = layerKit(page, art, layer, dpi, panels);
    kitCache = { key, panels, kit };
    return kit;
  }

  const baseFill = (at: Pt): Fill => ({
    at,
    color: state.color,
    gap: state.gap,
    ...(state.threshold !== FILL_THRESHOLD ? { threshold: state.threshold } : {}),
    ...(state.grow ? { grow: state.grow } : {}),
    ...(state.referAll ? { refer: 'all' as const } : {}),
  });

  /** Paint fills on a colour layer and record them as one undo step. */
  function commitFills(layerId: string, fills: Fill[], created: boolean, label: string): number {
    const kit = kitFor(layerId);
    const colour = planeCanvas(art, layerId, browserPlaneOps);
    const done: { fill: Fill; paint: FillPaint }[] = [];
    for (const f of fills) {
      const paint = paintFill(kit, colour, f);
      if (paint) done.push({ fill: f, paint });
    }
    if (!done.length) {
      if (created) studio.undo();
      return 0;
    }
    const kept = done.map((d) => d.fill);
    keepResident();
    studio.run(
      {
        label,
        do: () => {
          for (const d of done) putPixels(colour, d.paint.rect, d.paint.after);
          fillsOf(layerId)?.push(...kept);
          touchLayer(art, layerId);
        },
        undo: () => {
          for (let i = done.length - 1; i >= 0; i--) putPixels(colour, done[i]!.paint.rect, done[i]!.paint.before);
          const list = fillsOf(layerId) ?? [];
          for (const f of kept) {
            const i = list.lastIndexOf(f);
            if (i >= 0) list.splice(i, 1);
          }
          touchLayer(art, layerId);
        },
      },
      true,
    );
    fillsOf(layerId)?.push(...kept);
    touchLayer(art, layerId);
    if (created) studio.history.combine(2, `${label} on a new layer`);
    studio.markStage(page, 'draw', 1);
    ctx.chrome();
    return done.length;
  }

  /** Where fills at a point go: its panel's colour layer (or the selected layer). */
  function fillTarget(p: Pt): { layerId: string; created: boolean } | null {
    if (!ctx.panels().length) {
      ctx.hint('Carve panels first. Fills stay inside panels or gutters.', { tone: 'warn' });
      return null;
    }
    const t = resolve(p, 'colour', true);
    if (typeof t === 'string') {
      toast(t);
      return null;
    }
    return t;
  }

  /** A tinted picture of what a fill would paint (for the threshold drag and the closure check). */
  function showPreview(layerId: string, f: Fill): void {
    const m = kitFor(layerId).mask(f);
    if (!m) {
      preview = null;
      return;
    }
    const { res } = m;
    const w = res.x1 - res.x0 + 1;
    const hh = res.y1 - res.y0 + 1;
    const img = h('canvas', { width: w, height: hh });
    const data = new ImageData(w, hh);
    const c = parseInt(state.color.slice(1), 16);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      if (!res.mask[(res.y0 + y) * art.width + res.x0 + x]) continue;
      const i = (y * w + x) * 4;
      data.data[i] = (c >> 16) & 255;
      data.data[i + 1] = (c >> 8) & 255;
      data.data[i + 2] = c & 255;
      data.data[i + 3] = 150;
    }
    img.getContext('2d')!.putImageData(data, 0, 0);
    preview = { layerId, img, x0: res.x0, y0: res.y0 };
  }

  function fillDown(p: Pt, e: PointerEvent): void {
    const v = fillVariant();
    if (v === 'flats') { sweep = [p]; return; }
    if (v === 'bucket') {
      const t = fillTarget(p);
      if (!t) return;
      pour = { at: pointInLayer(p, t.layerId), layerId: t.layerId, created: t.created, x0: e.clientX, base: state.threshold, threshold: state.threshold };
      return;
    }
    sweep = [p];
  }

  function fillMove(p: Pt, e: PointerEvent): void {
    if (pour) {
      const dx = e.clientX - pour.x0;
      if (Math.abs(dx) < 6 && !preview) return;
      pour.threshold = Math.max(1, Math.min(254, Math.round(pour.base * Math.pow(2, dx / 80))));
      const now = performance.now();
      if (now - previewAt > 90) {
        previewAt = now;
        showPreview(pour.layerId, { ...baseFill(pour.at), threshold: pour.threshold });
        ctx.hint(`Line threshold ${pour.threshold} (${dx > 0 ? 'only solid lines stop it' : 'faint lines stop it too'})`, { timeout: 1300 });
      }
      ctx.request();
      return;
    }
    if (sweep) {
      const last = sweep[sweep.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.01) sweep.push(p);
      ctx.request();
    }
  }

  function fillUp(): void {
    if (pour) {
      const pr = pour;
      pour = null;
      preview = null;
      state.threshold = pr.threshold;
      const n = commitFills(pr.layerId, [{ ...baseFill(pr.at) }], pr.created, 'Fill');
      if (!n) toast('Nothing to fill there (on a line, or already that colour).');
      ctx.request();
      return;
    }
    if (!sweep) return;
    const screenPath = sweep;
    sweep = null;
    const v = fillVariant();
    if (v === 'flats') { autoFlats(screenPath[0]!); return; }
    const t = fillTarget(screenPath[0]!);
    if (!t) return;
    const path = screenPath.map((p) => pointInLayer(p, t.layerId));
    if (v === 'drag') {
      // one seed every 0.03": areas already reached by an earlier seed are skipped
      const kit = kitFor(t.layerId);
      const covered = new Uint8Array(art.width * art.height);
      const fills: Fill[] = [];
      let walked = 0.03;
      for (let i = 0; i < path.length; i++) {
        if (i > 0) walked += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
        if (walked < 0.03) continue;
        walked = 0;
        const q = path[i]!;
        const k = Math.floor(q.y * dpi) * art.width + Math.floor(q.x * dpi);
        if (covered[k]) continue;
        const f: Fill = { ...baseFill(q), exact: true };
        const m = kit.mask(f);
        if (!m) continue;
        for (let y = m.res.y0; y <= m.res.y1; y++) for (let x = m.res.x0; x <= m.res.x1; x++) if (m.res.mask[y * art.width + x]) covered[y * art.width + x] = 1;
        fills.push(f);
      }
      const n = commitFills(t.layerId, fills, t.created, 'Drag fill');
      toast(n ? `Filled ${n} area${n === 1 ? '' : 's'}.` : 'Nothing to fill along that path.');
    } else if (v === 'lasso') {
      if (path.length < 3) return;
      const n = commitFills(t.layerId, [{ ...baseFill(path[0]!), lasso: path }], t.created, 'Enclose and fill');
      if (!n) toast('No closed areas inside that loop.');
    } else if (v === 'leftover') {
      const n = commitFills(t.layerId, [{ ...baseFill(path[0]!), leftover: { path, r: state.leftR } }], t.created, 'Fill leftovers');
      if (!n) toast('No unfilled specks there.');
    }
    ctx.request();
  }

  function autoFlats(p: Pt): void {
    const panel = panelAt(ctx.panels(), p);
    const t = fillTarget(p);
    if (!panel || !t) return;
    const kit = kitFor(t.layerId);
    const seeds = kit.flats(panel.source ?? panel, baseFill(pointInLayer(p, t.layerId)));
    if (!seeds.length) {
      if (t.created) studio.undo();
      toast('No closed areas found in this panel.');
      return;
    }
    const colours = flatColours(seeds.length, panel.index);
    const n = commitFills(t.layerId, seeds.map((sd, i) => ({ ...baseFill(sd.at), color: colours[i]! })), t.created, 'Auto flats');
    toast(`Flatted ${n} areas. Recolour any with the bucket; undo to take them all back.`, 2600);
    ctx.request();
  }

  /** Open line ends on the page (closure check), cached per revision. */
  function looseEnds(): Pt[] {
    const key = `${Object.entries(art.revs).join(',')}|${state.gap}|${state.threshold}`;
    if (endsCache?.key === key) return endsCache.ends;
    const lines = page.groups.flatMap((g) => g.layers.filter((l) => l.fillRef && l.visible));
    const kit = new FillKit(() => refAlpha(lines, art, art.width, art.height), art.width, art.height, dpi, ctx.panels());
    const strokes = lines.flatMap((l) => l.strokes);
    const ends = openEnds(strokes, kit.walls('refs'), art.width, art.height, dpi, Math.max(state.gap, 2 / dpi), state.threshold);
    endsCache = { key, ends };
    return ends;
  }

  function fillOverlay(g: CanvasRenderingContext2D, s: number): void {
    if (preview) {
      g.save();
      const panel = layerPanel(preview.layerId);
      if (panel) applyPanelTransform(g, panel, s);
      g.imageSmoothingEnabled = false;
      g.drawImage(preview.img, (preview.x0 / dpi) * s, (preview.y0 / dpi) * s, (preview.img.width / dpi) * s, (preview.img.height / dpi) * s);
      g.restore();
    }
    if (sweep && sweep.length > 1) {
      const v = fillVariant();
      g.save();
      g.strokeStyle = v === 'leftover' ? 'rgba(200,85,61,.35)' : '#C8553D';
      g.lineWidth = v === 'leftover' ? state.leftR * 2 * s : 2;
      g.lineCap = g.lineJoin = 'round';
      if (v === 'lasso') g.setLineDash([6, 4]);
      g.beginPath();
      sweep.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
      if (v === 'lasso') g.closePath();
      g.stroke();
      g.restore();
    }
    if (state.check && mode.tool === 'fill') {
      g.save();
      g.lineWidth = 2;
      for (const q of looseEnds()) {
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.beginPath();
        g.arc(q.x * s, q.y * s, 9, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#E0342B';
        g.beginPath();
        g.arc(q.x * s, q.y * s, 7, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  /** Closure check: show what a tap here would fill, without filling. */
  function checkHover(p: Pt): void {
    if (!state.check || pour || sweep || fillVariant() !== 'bucket') return;
    const now = performance.now();
    if (now - previewAt < 120) return;
    previewAt = now;
    const panel = panelAt(ctx.panels(), p);
    if (!panel) {
      preview = null;
      return;
    }
    const group = groupAt(page, ctx.panels(), p);
    const layer = target === 'layer' ? active()?.layer : layerOfType(group, 'colour');
    if (!layer) {
      // no colour layer yet: preview against a throwaway kit of this group's lines
      preview = null;
      return;
    }
    showPreview(layer.id, baseFill(pointInLayer(p, layer.id)));
    ctx.request();
  }


  /**
   * Speed or focus lines: real ink strokes on the panel's ink layer (or the selected layer), drawn
   * with the current ink brush, all as one undo step.
   */
  function generate(at: Pt, toward: Pt | null): void {
    const panels = ctx.panels();
    const panel = panelAt(panels, at);
    if (!panel) {
      ctx.hint('Click inside a panel to place comic lines.', { tone: 'warn' });
      return;
    }
    const target = resolve(at, 'ink', true);
    if (typeof target === 'string') {
      toast(target);
      return;
    }
    at = pointInLayer(at, target.layerId);
    if (toward) toward = pointInLayer(toward, target.layerId);
    const source = layerPanel(target.layerId)?.source ?? panel;
    const kind = variantOf(mode, 'lines') === 'speed' ? 'speed' : 'focus';
    const seed = Date.now() % 100000;
    let angle = ink.speed.angle;
    if (toward && Math.hypot(toward.x - at.x, toward.y - at.y) > 0.1) {
      angle = Math.round((Math.atan2(toward.y - at.y, toward.x - at.x) * 180) / Math.PI);
      ink.speed.angle = angle;
      saveInk();
    }
    const lines: GenLine[] = kind === 'focus'
      ? focusLines(source.pts, at, { ...ink.focus, seed })
      : speedLines(source.pts, angle, { ...ink.speed, seed });
    if (!lines.length) {
      if (target.created) studio.undo();
      return;
    }
    const brush = currentBrush('ink');
    const brushId = studio.brushId(brush);
    const w = sizeIn('ink');
    const opacity = toolOpacity('ink');
    const layer = findLayer(page, target.layerId)!.layer;
    const pass: LinePass = brush.pass;
    const canvas = planeCanvas(art, layer.id, browserPlaneOps);
    engine.resize(art.width, art.height);
    engine.bind(canvas);
    const strokes: Stroke[] = [];
    const commits: NonNullable<ReturnType<RasterEngine['commit']>>[] = [];
    lines.forEach((ln, i) => {
      // densify so the pressure ramp reads along the whole line
      const pts: Pt[] = [];
      const pr: number[] = [];
      for (let k = 0; k < ln.pts.length - 1; k++) {
        const a = ln.pts[k]!;
        const b = ln.pts[k + 1]!;
        const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.02));
        for (let j = 0; j < n; j++) {
          const t = j / n;
          pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
          pr.push(ln.pressure[k]! + (ln.pressure[k + 1]! - ln.pressure[k]!) * t);
        }
      }
      pts.push(ln.pts.at(-1)!);
      pr.push(ln.pressure.at(-1)!);
      const stroke: Stroke = { pts, pressure: pr, w, brushId, seed: seed * 1000 + i, ...(pass !== passForType(layer.type) ? { pass } : {}) };
      if (opacity < 1) stroke.opacity = opacity;
      const rec: StrokeRecord = { id: `gen${i}`, ...strokeStyle(brushId, w, pass, dpi, false, opacity), seed: stroke.seed, points: pts.map((q, j) => ({ x: q.x * dpi, y: q.y * dpi, pressure: pr[j]!, tiltX: 0, tiltY: 0, t: j * 8 })) };
      engine.begin(rec, null);
      const c = engine.commit(true);
      if (c) commits.push(c);
      strokes.push(stroke);
    });
    const id = layer.id;
    keepResident();
    const label = kind === 'focus' ? 'Focus lines' : 'Speed lines';
    studio.run(
      {
        label,
        do: () => {
          for (const c of commits) putPixels(canvas, c.rect, c.after);
          strokesOf(id)?.push(...strokes);
          touchLayer(art, id);
        },
        undo: () => {
          for (let i = commits.length - 1; i >= 0; i--) putPixels(canvas, commits[i]!.rect, commits[i]!.before);
          const list = strokesOf(id);
          if (list) for (const s of strokes) {
            const i = list.findIndex((x) => x.seed === s.seed);
            if (i >= 0) list.splice(i, 1);
          }
          touchLayer(art, id);
        },
      },
      true,
    );
    strokesOf(id)?.push(...strokes);
    touchLayer(art, id);
    if (target.created) studio.history.combine(2, `${label} on a new layer`);
    studio.markStage(page, 'draw', 1);
    ctx.chrome();
    toast(`${lines.length} ${kind} lines. Undo to try again: each click gives a new pattern.`, 1800);
  }

  /** Ruler handles (page inches) and how to move them. */
  function handles(): { at: Pt; move: (p: Pt) => void }[] {
    const r = ink.ruler;
    if (r.kind === 'radial') return [{ at: r.center, move: (p) => (r.center = p) }];
    if (r.kind === 'perspective') return r.vps.map((v, i) => ({ at: v, move: (p: Pt) => (r.vps[i] = p) }));
    return [];
  }

  function rulerMenu(anchor: HTMLElement): void {
    const build = (): HTMLElement => {
      const r = ink.ruler;
      const kids: HTMLElement[] = [
        h('h4', {}, 'Ruler'),
        seg<RulerKind>(RULERS, r.kind, (v) => { r.kind = v; ctx.hint(v === 'off' ? 'Drawing assist off' : 'Drawing assist · ' + RULERS.find((x) => x.id === v)!.label, { timeout: 2200 }); saveInk(); rebuildMenu(); ctx.request(); anchor.textContent = `📐 ${RULERS.find((x) => x.id === v)!.label}`; }, 'Ruler'),
      ];
      if (r.kind === 'parallel') kids.push(slider('Angle', -90, 90, 1, r.angle, (v) => `${v}°`, (v) => { r.angle = v; ctx.request(); }, () => saveInk()));
      if (r.kind === 'perspective') {
        const both = h('input', { type: 'checkbox', checked: r.vps.length > 1 });
        both.addEventListener('change', () => {
          const a = r.vps[0]!;
          r.vps = both.checked ? [a, { x: a.x + 8, y: a.y }] : [a];
          saveInk();
          ctx.request();
        });
        const vert = h('input', { type: 'checkbox', checked: r.vertical });
        vert.addEventListener('change', () => { r.vertical = vert.checked; saveInk(); });
        kids.push(h('div', { class: 'row' }, h('label', {}, both, 'Two-point')), h('div', { class: 'row' }, h('label', {}, vert, 'Vertical lines too')));
      }
      if (r.kind !== 'off') {
        kids.push(slider('Strength', 0.3, 1, 0.05, r.strength, (v) => `${Math.round(v * 100)}%`, (v) => { r.strength = v; }, () => saveInk()));
        const tip = r.kind === 'straight' ? 'Each stroke locks to a straight line once it has a direction.'
          : r.kind === 'parallel' ? 'Strokes run at the ruler angle.'
          : r.kind === 'radial' ? 'Strokes aim at the centre. Drag the handle to move it.'
          : 'Strokes pick the vanishing point that matches their direction. Drag the handles; they can sit off the page.';
        kids.push(h('p', { class: 'note', style: 'margin:4px 8px' }, tip));
      }
      return h('div', { style: 'width:250px' }, ...kids);
    };
    const holder = h('div', {}, build());
    const rebuildMenu = () => holder.replaceChildren(build());
    popover(anchor, holder, 'below', 'Ruler');
  }

  /** Faint guides for the active ruler, and its handles. */
  function drawRuler(g: CanvasRenderingContext2D, s: number): void {
    const r = ink.ruler;
    if (r.kind === 'off' || r.kind === 'straight' || !brushTool()) return;
    g.save();
    g.strokeStyle = 'rgba(200,85,61,.35)';
    g.lineWidth = 1;
    g.beginPath();
    const ray = (o: Pt, a: number) => {
      g.moveTo(o.x * s, o.y * s);
      g.lineTo((o.x + Math.cos(a) * 40) * s, (o.y + Math.sin(a) * 40) * s);
    };
    if (r.kind === 'parallel') {
      const a = (r.angle * Math.PI) / 180;
      const n = { x: -Math.sin(a), y: Math.cos(a) };
      for (let k = -30; k <= 30; k++) ray({ x: 3.3 + n.x * k * 0.5 - Math.cos(a) * 20, y: 5 + n.y * k * 0.5 - Math.sin(a) * 20 }, a);
    } else if (r.kind === 'radial') {
      for (let k = 0; k < 36; k++) ray(r.center, (k / 36) * Math.PI * 2);
    } else {
      for (const v of r.vps) for (let k = 0; k < 48; k++) ray(v, (k / 48) * Math.PI * 2);
      if (r.vps.length > 1) {
        g.moveTo(r.vps[0]!.x * s, r.vps[0]!.y * s);
        g.lineTo(r.vps[1]!.x * s, r.vps[1]!.y * s);
      }
    }
    g.stroke();
    for (const hd of handles()) {
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.strokeStyle = '#C8553D';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(hd.at.x * s, hd.at.y * s, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(hd.at.x * s, hd.at.y * s, 2.5, 0, Math.PI * 2);
      g.fillStyle = '#C8553D';
      g.fill();
    }
    g.restore();
  }

  // ---- vector layers

  /** Replace a vector layer's strokes as one undo step; the bitmap is redrawn from them. */
  function editVector(layerId: string, label: string, next: Stroke[], before?: Stroke[]): void {
    const was = structuredClone(before ?? findLayer(page, layerId)!.layer.strokes);
    const now = structuredClone(next);
    const apply = (list: Stroke[]) => {
      const layer = findLayer(page, layerId)?.layer;
      if (!layer) return;
      layer.strokes = structuredClone(list);
      renderVectorLayer(layer, planeCanvas(art, layerId, browserPlaneOps), dpi);
      touchLayer(art, layerId);
    };
    keepResident();
    studio.run({ label, do: () => apply(now), undo: () => apply(was) }, true);
    apply(now);
    if (vsel && vsel.layerId === layerId && vsel.index >= now.length) vsel = null;
    ctx.request();
  }

  /** Redraw a vector layer from its current (live-edited) strokes, without an undo step. */
  function redrawVector(layerId: string): void {
    const layer = findLayer(page, layerId)?.layer;
    if (!layer) return;
    renderVectorLayer(layer, planeCanvas(art, layerId, browserPlaneOps), dpi);
    touchLayer(art, layerId);
    ctx.request();
  }

  /** Vector layers the edit tools may touch: the selected one, or every visible, unlocked one. */
  function editableVectors(): Layer[] {
    if (target === 'layer') {
      const a = active();
      return a?.layer.vector && !a.layer.locked && a.layer.visible && !a.group.locked && a.group.visible ? [a.layer] : [];
    }
    return page.groups.filter((g) => g.visible && !g.locked).flatMap((g) => g.layers.filter((l) => l.vector && l.visible && !l.locked)).reverse();
  }

  const selection = vectorSelection(ctx, (p) => {
    const layers = editableVectors();
    if (target === 'layer') return layers;
    const id = groupAt(page, ctx.panels(), p).id;
    const inContext = (l: Layer) => findLayer(page, l.id)?.group.id === id;
    return [...layers.filter(inContext), ...layers.filter((l) => !inContext(l))];
  }, editVector, (id) => layerPlacement(id));

  const rasterLayersAt = (p: Pt) => {
    const allowed = (l: Layer) => l.visible && !l.locked && !l.vector && !l.image && !l.screenTone && (state.showPencil || l.type !== 'pencil');
    if (target === 'layer') {
      const a = active();
      return a && a.group.visible && !a.group.locked && allowed(a.layer) ? [a.layer] : [];
    }
    const group = groupAt(page, ctx.panels(), p);
    if (!group.visible || group.locked) return [];
    return group.layers.filter(allowed).sort((a, b) => Number(b.overFrame) - Number(a.overFrame));
  };
  const pixels = rasterSelection(ctx, rasterLayersAt, keepResident, (id) => layerPlacement(id));
  const smudge = smudgeTool(ctx, rasterLayersAt, keepResident, (id) => layerPlacement(id));
  let smudgeSize = 18;
  let smudgeStrength = 0.55;
  let cloneFrom: Pt | undefined;
  let pickingClone = false;
  const pixelBrush = () => mode.tool === 'smudge' || mode.tool === 'clone';
  const smudgePoint = (p: Pt, e: PointerEvent) => ({ ...p, pressure: e.pointerType === 'pen' ? e.pressure : 1 });

  function hitVector(p: Pt): { layer: Layer; index: number; at: number } | null {
    const reach = 8 / ctx.scale();
    const panels = ctx.panels();
    const under = panelAt(panels, p);
    for (const layer of editableVectors().reverse()) {
      const group = findLayer(page, layer.id)?.group;
      if (group?.kind === 'panel' && group.mask && !layer.overFrame && (!under || panelForGroup(panels, group) !== under)) continue;
      const placed = group && panelForGroup(panels, group)?.transform;
      const hit = hitStroke(layer.strokes, mapPanelPoint(p, placed ? invert(placed.matrix) : null), reach);
      if (hit) return { layer, index: hit.index, at: hit.at };
    }
    return null;
  }

  function layerPanel(id: string) {
    const group = findLayer(page, id)?.group;
    return group ? panelForGroup(ctx.panels(), group) : null;
  }

  /** The moved panel a layer is shown through, if any (Over, Background and Gutters never move). */
  function layerPlacement(id: string): Placement | null {
    return placementOf(layerPanel(id)?.transform?.matrix);
  }

  function pointInLayer(p: Pt, id: string): Pt {
    const matrix = layerPanel(id)?.transform?.matrix;
    return mapPanelPoint(p, matrix ? invert(matrix) : null);
  }

  const editVariant = (): EditVariant => (variantOf(mode, 'vedit') || 'pull') as EditVariant;

  function vectorDown(p: Pt, addNode = false): void {
    if (vectorErase()) {
      if (!editableVectors().length) {
        toast('No vector lines to erase here. The Vector pen (V) makes them.');
        return;
      }
      verase = [p];
      return;
    }
    const v = editVariant();
    const hit = hitVector(p);
    if (v === 'pull' || v === 'nodes' || v === 'move') {
      if (!hit) {
        vsel = null;
        selectedNode = null;
        ctx.chrome();
        ctx.request();
        return;
      }
      const before = structuredClone(hit.layer.strokes);
      const source = hit.layer.strokes[hit.index]!;
      const { stroke, index } = v === 'pull' || (v === 'nodes' && addNode) ? pointAt(source, hit.at) : { stroke: source, index: Math.round(hit.at) };
      vsel = { layerId: hit.layer.id, index: hit.index };
      selectedNode = v === 'nodes' ? index : null;
      if (v === 'nodes' && addNode && stroke !== source) {
        const next = [...hit.layer.strokes];
        next[hit.index] = stroke;
        editVector(hit.layer.id, 'Insert vector point', next, before);
        ctx.chrome();
        return;
      }
      vdrag = { layerId: hit.layer.id, before, index: hit.index, grabbed: stroke, grab: index, from: pointInLayer(p, hit.layer.id), moved: false, kind: v === 'move' ? 'move' : 'pull' };
      hit.layer.strokes[hit.index] = stroke;
      ctx.chrome();
      ctx.request();
      return;
    }
    const layer = hit?.layer ?? editableVectors()[0];
    if (!layer) {
      toast('No vector lines here. The Vector pen (V) makes them.');
      return;
    }
    vbrush = { layerId: layer.id, before: structuredClone(layer.strokes), last: pointInLayer(p, layer.id) };
    widthBrush(p);
  }

  function widthBrush(p: Pt): void {
    if (!vbrush) return;
    const layer = findLayer(page, vbrush.layerId)?.layer;
    if (!layer) return;
    p = pointInLayer(p, layer.id);
    const factor = editVariant() === 'wider' ? 1.08 : 1 / 1.08;
    let any = false;
    layer.strokes = layer.strokes.map((st) => {
      const next = brushWidth(st, [vbrush!.last, p], vstate.widthR, factor);
      if (next) any = true;
      return next ?? st;
    });
    vbrush.last = p;
    if (any) redrawVector(layer.id);
  }

  function vectorMove(p: Pt): void {
    if (verase) {
      const last = verase[verase.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.01) verase.push(p);
      ctx.request();
      return;
    }
    if (vdrag) {
      const layer = findLayer(page, vdrag.layerId)?.layer;
      if (!layer) return;
      p = pointInLayer(p, layer.id);
      const delta = { x: p.x - vdrag.from.x, y: p.y - vdrag.from.y };
      if (Math.hypot(delta.x, delta.y) * ctx.scale() > 2) vdrag.moved = true;
      layer.strokes[vdrag.index] = vdrag.kind === 'move'
        ? { ...vdrag.grabbed, pts: vdrag.grabbed.pts.map((pt) => ({ x: pt.x + delta.x, y: pt.y + delta.y })) }
        : reshape(vdrag.grabbed, vdrag.grab, delta, editVariant() === 'nodes' ? 0 : vstate.pullR);
      redrawVector(layer.id);
      return;
    }
    if (vbrush) widthBrush(p);
  }

  function vectorUp(): void {
    if (verase) {
      const path = verase;
      verase = null;
      const r = sizeIn('eraser') / 2;
      let n = 0;
      for (const layer of editableVectors()) {
        const next = eraseStrokes(layer.strokes, path.map((p) => pointInLayer(p, layer.id)), r, vstate.erase, passForType(layer.type), dpi, () => (Date.now() % 1_000_000) * 100 + (seedCounter++ % 100));
        if (!next) continue;
        editVector(layer.id, `Erase vector (${vstate.erase === 'whole' ? 'whole line' : vstate.erase === 'crossing' ? 'to crossings' : 'touched part'})`, next);
        n++;
      }
      if (n > 1) studio.history.combine(n, 'Erase vector');
      if (!n) toast('The eraser did not touch a vector line.');
      vsel = null;
      ctx.chrome();
      ctx.request();
      return;
    }
    if (vdrag) {
      const d = vdrag;
      vdrag = null;
      const layer = findLayer(page, d.layerId)?.layer;
      if (!layer) return;
      if (!d.moved) {
        // a click selects without changing the line
        layer.strokes = structuredClone(d.before);
        redrawVector(d.layerId);
        return;
      }
      editVector(d.layerId, d.kind === 'move' ? 'Move vector line' : 'Reshape line', layer.strokes, d.before);
      return;
    }
    if (vbrush) {
      const b = vbrush;
      vbrush = null;
      const layer = findLayer(page, b.layerId)?.layer;
      if (!layer) return;
      if (JSON.stringify(layer.strokes) === JSON.stringify(b.before)) return;
      editVector(b.layerId, editVariant() === 'wider' ? 'Thicken lines' : 'Thin lines', layer.strokes, b.before);
    }
  }

  /** Change the selected vector line as one undo step. */
  function cancelVector(): void {
    const edit = vdrag ?? vbrush;
    vdrag = vbrush = verase = null;
    if (edit) {
      const layer = findLayer(page, edit.layerId)?.layer;
      if (layer) { layer.strokes = edit.before; redrawVector(layer.id); }
    }
    ctx.request();
  }

  function changeSelected(label: string, f: (s: Stroke) => Stroke | null): void {
    if (!vsel) return;
    const layer = findLayer(page, vsel.layerId)?.layer;
    const st = layer?.strokes[vsel.index];
    if (!layer || !st) return;
    selectedNode = null;
    const next = f(st);
    const list = [...layer.strokes];
    if (next) list[vsel.index] = next;
    else {
      list.splice(vsel.index, 1);
      vsel = null;
    }
    editVector(layer.id, label, list);
    ctx.chrome();
  }

  function vectorOverlay(g: CanvasRenderingContext2D, s: number): void {
    if (live?.vector && live.record.points.length) {
      g.save();
      const group = findLayer(page, live.layerId)?.group;
      const panel = group && panelForGroup(ctx.panels(), group);
      if (panel) applyPanelTransform(g, panel, s);
      g.scale(s / dpi, s / dpi);
      drawVectorStroke(g, live.record, Infinity);
      g.restore();
    }
    if (verase && verase.length) {
      g.save();
      g.strokeStyle = 'rgba(200,85,61,.35)';
      g.lineWidth = sizeIn('eraser') * s;
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      verase.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
      if (verase.length === 1) g.lineTo(verase[0]!.x * s + 0.1, verase[0]!.y * s);
      g.stroke();
      g.restore();
    }
    if (mode.tool === 'vedit' && vsel) {
      const st = findLayer(page, vsel.layerId)?.layer.strokes[vsel.index];
      if (!st) return;
      g.save();
      const panel = layerPanel(vsel.layerId);
      if (panel) applyPanelTransform(g, panel, s);
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.beginPath();
      st.pts.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
      g.stroke();
      g.fillStyle = '#fff';
      const step = Math.max(1, Math.round(st.pts.length / 40));
      st.pts.forEach((q, i) => {
        if (i % step && i !== st.pts.length - 1 && i !== selectedNode) return;
        g.fillStyle = i === selectedNode ? '#83c6f2' : '#fff';
        g.beginPath();
        g.arc(q.x * s, q.y * s, i === selectedNode ? 5 : 2.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
      g.restore();
    }
  }

  async function rebuild(): Promise<void> {
    const n = page.groups.reduce((a, g) => a + g.layers.reduce((b, l) => b + l.strokes.length + l.fills.length, 0), 0);
    if (!(await confirmDialog('Rebuild from strokes?', `Redraws every layer from its ${n} stored strokes and fills. It can take a while and clears the undo history.`, 'Rebuild'))) return;
    toast('Rebuilding…');
    await new Promise((r) => setTimeout(r, 30));
    const brushIds = new Set(page.groups.flatMap((g) => g.layers.flatMap((l) => l.strokes.map((s) => s.brushId))));
    await Promise.all([...brushIds].map((id) => book.brushes?.[id] ?? entry(id)?.settings).filter((b) => b !== undefined).map(warmBrush));
    const start = performance.now();
    rebuildPage(page, art, dpi, engine, browserPlaneOps);
    studio.history.clear();
    studio.saver.markDirty();
    ctx.request();
    toast(`Rebuilt in ${((performance.now() - start) / 1000).toFixed(1)} s.`);
  }

  const mode: DeskMode = {
    id: 'draw',
    actions: [{ label: 'Adjustments', glyph: '◒', run: adjustLayer }],
    sidebar: controls,
    get resetOptions() {
      if (mode.tool !== 'fill') return undefined;
      return () => {
        state.gap = FILL_GAP;
        state.threshold = FILL_THRESHOLD;
        ctx.chrome();
        ctx.request();
      };
    },
    tools: [
      { id: 'ink', label: 'Brush', glyph: '✒', key: 'i', group: 'paint' },
      { id: 'smudge', label: 'Smudge', glyph: '≈', key: 's', group: 'paint' },
      { id: 'eraser', label: 'Eraser', glyph: '⌫', key: 'e', group: 'paint', variants: [
        { id: 'ink', label: 'Erase ink', glyph: '⌫' },
        { id: 'pencil', label: 'Erase pencil', glyph: '⌦' },
        { id: 'vector', label: 'Erase vector lines', glyph: '⌧' },
      ] },
      { id: 'pencil', label: 'Pencil', glyph: '✏', key: 'p', group: 'paint' },
      { id: 'clone', label: 'Clone', glyph: '⧉', group: 'paint' },
      { id: 'vpen', label: 'Vector pen', glyph: '✑', key: 'v', group: 'vector' },
      { id: 'vedit', label: 'Edit lines', glyph: '⌇', key: 'a', group: 'vector', variants: [
        { id: 'pull', label: 'Pull and select', glyph: '⌇' },
        { id: 'nodes', label: 'Edit points', glyph: '◇' },
        { id: 'move', label: 'Move line', glyph: '✥' },
        { id: 'wider', label: 'Thicken', glyph: '⬤' },
        { id: 'thinner', label: 'Thin', glyph: '•' },
      ] },
      { id: 'lines', label: 'Comic lines', glyph: '✺', key: 'l', group: 'colour', variants: [
        { id: 'focus', label: 'Focus lines', glyph: '✺' },
        { id: 'speed', label: 'Speed lines', glyph: '≡' },
      ] },
      { id: 'fill', label: 'Colour', glyph: '◐', key: 'f', group: 'colour', variants: [
        { id: 'bucket', label: 'Bucket', glyph: '◐' },
        { id: 'drag', label: 'Drag fill', glyph: '〰' },
        { id: 'lasso', label: 'Enclose and fill', glyph: '◌' },
        { id: 'leftover', label: 'Fill leftovers', glyph: '⁘' },
        { id: 'flats', label: 'Auto flats', glyph: '▦' },
      ] },
      { id: 'tone', label: 'Screentone', glyph: '▦', key: 't', group: 'colour' },
      { id: 'selection', label: 'Select lines', glyph: '⬚', key: 'm', group: 'edit', variants: [...MARQUEE_SHAPES] },
      { id: 'pixels', label: 'Transform', glyph: '↗', key: 'r', group: 'edit', variants: [...MARQUEE_SHAPES] },
      { id: 'image', label: 'Position image', glyph: '▧', group: 'image' },
    ],
    tool: 'ink',
    cursor: () => (pickingColor ? 'cross' : mode.tool === 'image' || shapeEditor.active() ? 'move' : ['fill', 'tone', 'lines', 'vedit', 'selection', 'pixels'].includes(mode.tool) ? 'cross' : 'brush'),
    ctx(bar) {
      if (mode.tool !== 'pixels') pixels.clear();
      if (mode.tool !== 'selection') selection.resetMarquee();
      if (mode.tool !== 'tone') tone.clear();
      if (!pixelBrush()) smudge.clear();
      refreshShapeActions();
      const bt = brushTool();
      const hasInkColor = bt !== null && currentBrush(bt).pass === 'ink';
      if (!hasInkColor && mode.tool !== 'fill') pickingColor = false;
      if (bt) {
        const cur = currentBrush(bt);
        const pick = h('button', { class: 'btn brushbtn', type: 'button', title: 'Choose a brush', 'aria-haspopup': 'dialog' }, cur.name, ' ▾');
        void warmBrush(cur.settings);
        pick.addEventListener('click', () => brushPicker(pick, studio, bt, cur.id, (e) => pickBrush(bt, e), mode.tool === 'vpen'));
        bar.append(pick, h('button', { class: 'icon', type: 'button', title: 'Brush Studio: edit this brush', 'aria-label': 'Edit brush', onclick: () => brushStudio(studio, cur, (e) => pickBrush(bt, e), mode.tool === 'vpen') }, '✎'));
        if (hasInkColor) bar.append(...colourControls(false));
      }
      showBrushControls(sizeTool() ?? (mode.tool === 'lines' ? 'ink' : null));
      if (pixelBrush()) bar.append(
        ...(mode.tool === 'clone' ? [h('button', { class: 'btn', type: 'button', 'aria-pressed': String(pickingClone), onclick: () => { pickingClone = !pickingClone; ctx.chrome(); } }, pickingClone ? 'Tap the source' : 'Set source')] : []),
        brushControl('Size', 'pt', smudgeSize, 1, 72, 0.5, (v) => { smudgeSize = v; ctx.request(); }, () => {}),
        brushControl('Strength', '%', smudgeStrength * 100, 1, 100, 1, (v) => { smudgeStrength = v / 100; }, () => {}),
        h('span', { class: 'hint' }, mode.tool === 'clone' ? 'Alt-click or tap Set source, then paint on the same layer.' : 'Drag through paint to blend it'),
      );
      if (bt) {
        const stroke = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'dialog' }, 'Stroke ▾');
        stroke.addEventListener('click', () => {
          const qs = h('input', { type: 'checkbox', checked: ink.quickShape });
          qs.addEventListener('change', () => { ink.quickShape = qs.checked; saveInk(); });
          popover(stroke, h('div', { class: 'stroke-options' },
            slider('Stabilize', 0, 1, 0.05, stabilizeOf(bt), (v) => `${Math.round(v * 100)}%`, (v) => { if (mode.tool === 'vpen') ink.vectorStabilize = v; else ink.stabilize[bt] = v; }, saveInk),
            slider('Correct', 0, 1, 0.05, ink.correct, (v) => (v ? `${Math.round(v * 100)}%` : 'off'), (v) => { ink.correct = v; }, saveInk),
            h('label', { class: 'mini', title: 'Hold at the end of a stroke to snap it to a clean shape' }, qs, 'QuickShape')), 'below', 'Stroke settings');
        });
        const ruler = RULERS.find((x) => x.id === ink.ruler.kind)!;
        const rb = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'dialog', title: 'Rulers: straight, parallel, radial, perspective' }, ruler.id === 'off' ? 'Rulers ▾' : `Ruler · ${ruler.label} ▾`);
        rb.addEventListener('click', () => rulerMenu(rb));
        if (currentBrush(bt).id === 'g-pen') {
          const pressure = h('button', { class: 'btn', type: 'button', 'aria-label': 'G-pen pressure', 'aria-haspopup': 'dialog' }, 'Pressure ▾');
          pressure.onclick = () => popover(pressure, h('div', {},
            h('h4', {}, 'G-pen pressure'),
            seg<GPenPressure>([{ id: 'light', label: 'Light touch' }, { id: 'balanced', label: 'Balanced' }, { id: 'firm', label: 'Firm' }], ink.gPenPressure ?? 'balanced', (response) => {
              ink.gPenPressure = response;
              saveInk();
              closePopover();
              pressure.focus();
            }, 'Pressure response'),
          ), 'below', 'G-pen pressure');
          bar.append(pressure);
        }
        bar.append(stroke, rb);
      }
      if (mode.tool === 'lines') {
        const v = variantOf(mode, 'lines');
        bar.append(seg([{ id: 'focus', label: 'Focus' }, { id: 'speed', label: 'Speed' }], v, (x) => ctx.setVariant('lines', x), 'Kind'));
        if (v === 'focus') {
          bar.append(
            slider('Lines', 20, 240, 5, ink.focus.count, String, (x) => (ink.focus.count = x), () => saveInk()),
            slider('Clear zone', 0.1, 0.85, 0.05, ink.focus.inner, (x) => `${Math.round(x * 100)}%`, (x) => (ink.focus.inner = x), () => saveInk()),
            slider('Rough', 0, 1, 0.05, ink.focus.jitter, (x) => `${Math.round(x * 100)}%`, (x) => (ink.focus.jitter = x), () => saveInk()),
            h('span', { class: 'hint' }, 'Click the focus point in a panel.'),
          );
        } else {
          bar.append(
            slider('Lines', 8, 120, 1, ink.speed.count, String, (x) => (ink.speed.count = x), () => saveInk()),
            slider('Length', 0.2, 1, 0.05, ink.speed.length, (x) => `${Math.round(x * 100)}%`, (x) => (ink.speed.length = x), () => saveInk()),
            slider('Rough', 0, 1, 0.05, ink.speed.jitter, (x) => `${Math.round(x * 100)}%`, (x) => (ink.speed.jitter = x), () => saveInk()),
            h('span', { class: 'hint' }, `Drag in a panel along the motion (or click: ${ink.speed.angle}°).`),
          );
        }
        bar.append(h('span', { class: 'hint' }, `Uses ${currentBrush('ink').name} at the ink size.`));
      }
      if (mode.tool === 'eraser' && target === 'auto') bar.append(seg([{ id: 'ink', label: 'Ink' }, { id: 'pencil', label: 'Pencil' }, { id: 'vector', label: 'Vector' }], variantOf(mode, 'eraser') || 'ink', (v) => ctx.setVariant('eraser', v), 'Erase on'));
      if (vectorErase()) {
        bar.append(seg<VectorErase>([{ id: 'intersection', label: 'Touched part' }, { id: 'crossing', label: 'To crossings' }, { id: 'whole', label: 'Whole line' }], vstate.erase, (v) => { vstate.erase = v; ctx.chrome(); }, 'Vector erase'),
          h('span', { class: 'hint' }, vstate.erase === 'crossing' ? 'Cleans overshoots: removes the piece up to the nearest crossing lines.' : vstate.erase === 'whole' ? 'Removes every line the eraser touches.' : 'Cuts only where the eraser crosses a line.'));
      }
      if (mode.tool === 'vpen') bar.append(h('span', { class: 'hint' }, 'Editable lines on a vector layer. Reshape and re-weight them with Edit lines (A).'));
      if (mode.tool === 'tone') bar.append(...tone.controls(active()?.layer.id).filter((el) => el !== null));
      if (mode.tool === 'vedit') {
        const v = editVariant();
        bar.append(seg<EditVariant>([{ id: 'pull', label: 'Pull' }, { id: 'nodes', label: 'Points' }, { id: 'move', label: 'Move line' }, { id: 'wider', label: 'Thicken' }, { id: 'thinner', label: 'Thin' }], v, (x) => { selectedNode = null; ctx.setVariant('vedit', x); }, 'Edit'));
        if (v === 'pull') bar.append(slider('Reach', 0, 2, 0.05, vstate.pullR, (x) => (x ? `${x.toFixed(2)}″` : 'one point'), (x) => (vstate.pullR = x)));
        else if (v === 'nodes') bar.append(h('span', { class: 'hint' }, 'Drag a point. Shift-click the line to add one.'),
          h('button', { class: 'btn', type: 'button', disabled: selectedNode === null, onclick: () => { const index = selectedNode; if (index !== null) changeSelected('Delete vector point', (s) => removePoint(s, index)); } }, 'Delete point'));
        else if (v !== 'move') bar.append(slider('Brush', 0.03, 0.5, 0.01, vstate.widthR, (x) => `${(x * 2 * 72).toFixed(0)}pt`, (x) => (vstate.widthR = x)));
        const sel = vsel ? findLayer(page, vsel.layerId)?.layer.strokes[vsel.index] : null;
        if (sel) {
          bar.append(
            h('span', { class: 'mini' }, 'Line',
              h('button', { class: 'btn', type: 'button', title: 'Thinner line', onclick: () => changeSelected('Thinner line', (x) => scaleWidth(x, 1 / 1.2)) }, '−'),
              h('b', {}, `${(sel.w * 72).toFixed(1)}pt`),
              h('button', { class: 'btn', type: 'button', title: 'Thicker line', onclick: () => changeSelected('Thicker line', (x) => scaleWidth(x, 1.2)) }, '+')),
            h('button', { class: 'btn', type: 'button', title: 'Smooth out wobbles', onclick: () => changeSelected('Smooth line', (x) => smooth(x, 3)) }, 'Smooth'),
            h('button', { class: 'btn', type: 'button', title: 'Drop points the line does not need', onclick: () => { const n = sel.pts.length; changeSelected('Simplify line', (x) => simplify(x, 0.006)); const m = vsel ? findLayer(page, vsel.layerId)?.layer.strokes[vsel.index]?.pts.length : 0; toast(`${n} → ${m ?? n} points.`, 1400); } }, 'Simplify'),
            h('button', { class: 'btn', type: 'button', title: 'Reset width changes along the line', onclick: () => changeSelected('Even width', (x) => { const { pw: _pw, ...rest } = x; return rest; }) }, 'Even width'),
            h('button', { class: 'btn danger', type: 'button', title: 'Delete line (Del)', onclick: () => changeSelected('Delete line', () => null) }, 'Delete'),
          );
        } else if (v !== 'nodes') bar.append(h('span', { class: 'hint' }, v === 'move' ? 'Drag a vector line to move it as a whole.' : v === 'pull' ? 'Drag a vector line to pull it into shape; click one to select it.' : `Brush over vector lines to make them ${v === 'wider' ? 'thicker' : 'thinner'} there.`));
      }
      if (mode.tool === 'fill') {
        const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Fill colour' },
          PALETTE.map((c) => h('button', { type: 'button', 'aria-label': c, 'aria-pressed': String(c === state.color), style: `background:${c}`, onclick: () => { state.color = c; ctx.chrome(); } })));
        const fv = fillVariant();
        bar.append(
          seg<FillVariant>([{ id: 'bucket', label: 'Bucket' }, { id: 'drag', label: 'Drag' }, { id: 'lasso', label: 'Enclose' }, { id: 'leftover', label: 'Leftovers' }, { id: 'flats', label: 'Flats' }], fv, (v) => ctx.setVariant('fill', v), 'Fill kind'),
        );
        if (fv !== 'flats') bar.append(...colourControls(true), swatches);
        else pickingColor = false;
        bar.append(
          slider('Close gaps', 0, 0.08, 0.005, state.gap, (v) => `${Math.round(v * dpi)}px`, (v) => (state.gap = v), () => ctx.request()),
          slider('Threshold', 1, 254, 1, state.threshold, String, (v) => {
            state.threshold = v;
            ctx.hint('Gap closing · line threshold ' + v, { timeout: 1800 });
          }, () => ctx.request()),
          slider('Grow', -0.02, 0.02, 0.001, state.grow, (v) => `${v > 0 ? '+' : ''}${Math.round(v * dpi)}px`, (v) => (state.grow = v)),
        );
        if (fv === 'leftover') bar.append(slider('Brush', 0.02, 0.25, 0.01, state.leftR, (v) => `${(v * 2 * 72).toFixed(0)}pt`, (v) => (state.leftR = v)));
        bar.append(h('span', { class: 'mini' }, 'Walls',
          seg([{ id: 'refs', label: 'Reference lines' }, { id: 'all', label: 'All visible' }], state.referAll ? 'all' : 'refs', (v) => { state.referAll = v === 'all'; ctx.chrome(); }, 'Walls')));
        const chk = h('input', { type: 'checkbox', checked: state.check });
        chk.addEventListener('change', () => { state.check = chk.checked; preview = null; ctx.request(); });
        bar.append(h('label', { class: 'mini', title: 'Show open line ends, and what a tap would fill (C)' }, chk, 'Check gaps (C)'));
        bar.append(h('span', { class: 'hint' }, FILL_HINT[fv]));
      }
      updateLayerButton(contextLayers);
      const actions = h('button', { class: 'btn draw-actions', type: 'button', 'aria-haspopup': 'dialog' }, 'Actions ▾');
      actions.addEventListener('click', () => popover(actions, h('div', {},
        h('button', { class: 'item', type: 'button', onclick: () => { closePopover(); images.open(); } }, h('span', {}, '▧'), 'Place image'),
        h('button', { class: 'item', type: 'button', onclick: () => { closePopover(); adjustLayer(); } }, h('span', {}, '◒'), 'Adjustments'),
        h('h4', {}, 'Drawing assist'),
        h('div', { class: 'row' }, h('label', {}, 'Symmetry', h('select', { 'aria-label': 'Symmetry', onchange: (e) => {
          const select = e.target as HTMLSelectElement;
          ink.symmetry = select.value as SymmetryMode;
          ctx.hint(ink.symmetry === 'off' ? 'Drawing assist off' : 'Drawing assist · ' + select.selectedOptions[0]!.textContent + ' symmetry', { timeout: 2200 });
          saveInk(); ctx.request();
        } }, (['off', 'vertical', 'horizontal', 'quadrant', 'radial'] as const).map((value) => h('option', { value, selected: (ink.symmetry ?? 'off') === value }, value[0]!.toUpperCase() + value.slice(1)))))),
        h('button', { class: 'item', type: 'button', onclick: () => { closePopover(); void rebuild(); } }, h('span', {}, '↻'), 'Rebuild from strokes')), 'below', 'Draw actions'));
      bar.prepend(actions, contextLayers, h('button', { class: 'btn', type: 'button', onclick: () => openBookAssets(studio, images.open) }, 'Assets'));
      if (mode.tool === 'image') bar.append(h('span', { class: 'hint' }, 'Drag the image to move it. Drag its corner to resize.'));
      if (mode.tool === 'selection') bar.append(
        seg([...MARQUEE_SHAPES], marqueeShape(variantOf(mode, 'selection')), (x) => { selection.resetMarquee(); ctx.setVariant('selection', x); }, 'Selection shape'),
        ...selection.controls(),
      );
      if (mode.tool === 'pixels') bar.append(
        seg([...MARQUEE_SHAPES], marqueeShape(variantOf(mode, 'pixels')), (x) => { pixels.resetMarquee(); ctx.setVariant('pixels', x); }, 'Pixel selection shape'),
        ...pixels.controls(),
      );
      refreshPicker();
      const show = h('input', { type: 'checkbox', checked: state.showPencil });
      show.addEventListener('change', () => { state.showPencil = show.checked; if (mode.tool === 'pixels') { pixels.clear(); ctx.chrome(); } ctx.request(); });
      bar.append(h('label', { class: 'mini' }, show, 'Show pencil'));
    },
    inspector(el) {
      updateLayerButton(inspectorLayers);
      if (mode.tool === 'image') {
        el.append(h('div', { class: 'sec' }, inspectorLayers), images.options());
        return;
      }
      el.append(
        h('div', { class: 'insp-head' }, h('div', { class: 'ins-title' }, 'Draw')),
        h('div', { class: 'sec stack' }, inspectorLayers,
          h('button', { class: 'btn', type: 'button', onclick: adjustLayer }, 'Adjustments'),
          h('button', { class: 'btn', type: 'button', onclick: () => images.open() }, 'Place image')),
      );
    },
    contextMenu(p) {
      const use = (id: string) => () => { mode.tool = id; ctx.chrome(); ctx.request(); };
      const tool = (id: string, label: string, key?: string) => ({ label, key, checked: mode.tool === id, run: use(id) });
      return [
        { label: 'Pick colour here', run: () => {
          const color = colourAt(p);
          if (!color) { toast('No colour under the pointer.'); return; }
          if (mode.tool === 'fill') state.color = color;
          else { ink.color = color; saveInk(); }
          ctx.chrome();
        } },
        'sep',
        tool('ink', 'Brush', 'I'), tool('pencil', 'Pencil', 'P'), tool('eraser', 'Eraser', 'E'),
        tool('fill', 'Colour', 'F'), tool('selection', 'Select lines', 'M'), tool('pixels', 'Transform', 'R'),
        'sep',
        { label: 'Show pencil', checked: state.showPencil, run: () => { state.showPencil = !state.showPencil; pixels.clear(); ctx.chrome(); } },
        { label: 'Layers…', run: () => contextLayers.click() },
      ];
    },
    down(p, e) {
      if (shapeEditor.active()) { shapeEditor.down(p, e); return; }
      if (!shapeActions.hidden) { shapeEditor.clear(); refreshShapeActions(); }
      if (pickingColor) {
        const color = colourAt(p);
        if (!color) return;
        if (mode.tool === 'fill') state.color = color;
        else { ink.color = color; saveInk(); }
        pickingColor = false;
        ctx.chrome();
        return;
      }
      if (mode.tool === 'image') { images.start(p); return; }
      if (mode.tool === 'selection') { selection.down(p, e, marqueeShape(variantOf(mode, 'selection'))); return; }
      if (target === 'auto') {
        lastCanvasGroupId = groupAt(page, ctx.panels(), p).id;
        contextGroupId = null;
      }
      if (mode.tool === 'pixels') {
        pixels.down(p, e, marqueeShape(variantOf(mode, 'pixels'))); return;
      }
      if (mode.tool === 'tone') { tone.down(p); return; }
      if (mode.tool === 'smudge') { smudge.down(smudgePoint(p, e), smudgeSize / PT, smudgeStrength); return; }
      if (mode.tool === 'clone') {
        if (!cloneFrom || pickingClone || e.altKey) { cloneFrom = p; pickingClone = false; ctx.chrome(); ctx.request(); }
        else smudge.down(smudgePoint(p, e), smudgeSize / PT, smudgeStrength, cloneFrom);
        return;
      }
      if (mode.tool === 'fill') {
        preview = null;
        fillDown(p, e);
        return;
      }
      if (mode.tool === 'lines') {
        lineDrag = { from: p, to: p };
        return;
      }
      if (mode.tool === 'vedit' || vectorErase()) {
        vectorDown(p, e.shiftKey);
        return;
      }
      if (brushTool()) {
        const reach = 12 / ctx.scale();
        const hit = handles().find((x) => Math.hypot(x.at.x - p.x, x.at.y - p.y) < reach);
        if (hit) {
          dragHandle = hit.move;
          return;
        }
      }
      beginStroke(p, e);
    },
    move(p, e) {
      hover = p;
      if (shapeEditor.active()) { shapeEditor.move(p, e); return; }
      if (mode.tool === 'image') { images.move(p); return; }
      if (mode.tool === 'selection') { selection.move(p, e); return; }
      if (mode.tool === 'pixels') { pixels.move(p, e); return; }
      if (mode.tool === 'tone') { tone.move(p); return; }
      if (pixelBrush()) { smudge.move(smudgePoint(p, e)); return; }
      if (pour || sweep) {
        fillMove(p, e);
        return;
      }
      if (dragHandle) {
        dragHandle(p);
        ctx.request();
        return;
      }
      if (lineDrag) {
        lineDrag.to = p;
        ctx.request();
        return;
      }
      if (vdrag || vbrush || verase) {
        vectorMove(p);
        return;
      }
      if (!live) return;
      p = mapPanelPoint(p, live.inverse);
      if (live.shape) adjustShape({ x: p.x * dpi, y: p.y * dpi }, e.shiftKey);
      else addPoint(sample(p, e));
    },
    up(p, e) {
      if (shapeEditor.active()) { shapeEditor.up(p, e); return; }
      if (mode.tool === 'image') { if (e.type !== 'pointercancel') images.move(p); images.end(e.type === 'pointercancel'); return; }
      if (mode.tool === 'selection') { selection.up(p, e); return; }
      if (mode.tool === 'pixels') { pixels.up(p, e); return; }
      if (mode.tool === 'tone') { tone.up(p, e.type === 'pointercancel'); return; }
      if (pixelBrush()) {
        if (e.type !== 'pointercancel' && e.pointerType !== 'pen') smudge.move(smudgePoint(p, e));
        smudge.up(e.type === 'pointercancel');
        return;
      }
      if (pour || sweep) {
        if (e.type === 'pointercancel') {
          const created = pour?.created;
          pour = null; sweep = null; preview = null;
          if (created) studio.undo();
        } else fillUp();
        return;
      }
      if (dragHandle) {
        dragHandle = null;
        saveInk();
        return;
      }
      if (lineDrag) {
        const d = lineDrag;
        lineDrag = null;
        if (e.type !== 'pointercancel') generate(d.from, variantOf(mode, 'lines') === 'speed' ? d.to : null);
        return;
      }
      if (vdrag || vbrush || verase) {
        if (e.type === 'pointercancel') cancelVector();
        else vectorUp();
        return;
      }
      endStroke(e.type !== 'pointercancel');
    },
    hover(p) {
      hover = p;
      if (p && mode.tool === 'selection') selection.hover(p);
      if (p && mode.tool === 'pixels') pixels.hover(p);
      if (p && mode.tool === 'tone') tone.hover(p);
      if (mode.tool === 'fill' && p) checkHover(p);
    },
    modifierTouch(active) {
      constrainTouch = active;
      if (live?.shape) adjustShape(live.shape.at, live.shape.shift);
    },
    live: () => shapeEditor.active() ? shapeEditor.live() : pixelBrush() ? smudge.live() : mode.tool === 'pixels' ? pixels.live() : mode.tool === 'selection' ? selection.live() : live && !live.vector ? { [live.layerId]: engine.displaySource() } : {},
    placement: () => mode.tool === 'image' ? images.preview() : undefined,
    types: () => ({ pencil: state.showPencil }),
    overlay(g, s) {
      if (shapeEditor.active()) { shapeEditor.overlay(g, s); return; }
      if (mode.tool === 'image') { images.overlay(g, s); return; }
      if (mode.tool === 'selection') { selection.overlay(g, s); return; }
      if (mode.tool === 'pixels') { pixels.overlay(g, s); return; }
      if (mode.tool === 'tone') { tone.overlay(g, s); return; }
      drawRuler(g, s);
      const sym = ink.symmetry;
      if (sym && sym !== 'off' && mode.tool !== 'vpen' && sizeTool()) {
        const w = page.widthIn * s, h = page.heightIn * s;
        g.save(); g.strokeStyle = 'rgba(47,127,216,.6)'; g.lineWidth = 1; g.setLineDash([5, 5]); g.beginPath();
        if (sym !== 'horizontal') { g.moveTo(w / 2, 0); g.lineTo(w / 2, h); }
        if (sym !== 'vertical') { g.moveTo(0, h / 2); g.lineTo(w, h / 2); }
        if (sym === 'radial') {
          const d = Math.min(w, h) / 2;
          for (const sign of [-1, 1]) { g.moveTo(w / 2 - d, h / 2 - d * sign); g.lineTo(w / 2 + d, h / 2 + d * sign); }
        }
        g.stroke(); g.restore();
      }
      fillOverlay(g, s);
      vectorOverlay(g, s);
      if (lineDrag && variantOf(mode, 'lines') === 'speed') {
        g.save();
        g.strokeStyle = '#C8553D';
        g.lineWidth = 2;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.moveTo(lineDrag.from.x * s, lineDrag.from.y * s);
        g.lineTo(lineDrag.to.x * s, lineDrag.to.y * s);
        g.stroke();
        g.restore();
      }
      const t = sizeTool();
      if (mode.tool === 'clone' && cloneFrom) {
        g.save(); g.strokeStyle = '#2F7FD8'; g.lineWidth = 2; g.beginPath();
        g.arc(cloneFrom.x * s, cloneFrom.y * s, 7, 0, Math.PI * 2); g.stroke(); g.restore();
      }
      if (!hover || (!t && !pixelBrush()) || pickingColor) return;
      const r = Math.max(2, ((t ? sizeIn(t) : smudgeSize / PT) * s) / 2);
      g.save();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      g.arc(hover.x * s, hover.y * s, r + 1, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = mode.tool === 'pencil' ? '#4E7EA8' : '#191A1F';
      if (vectorErase()) g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(hover.x * s, hover.y * s, r, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    },
    key(e) {
      if (e.key === 'Enter' && mode.tool === 'selection' && selection.isMarquee()) { selection.closePolygon(); return true; }
      if (e.key === 'Enter' && mode.tool === 'pixels' && pixels.isMarquee()) { pixels.closePolygon(); return true; }
      if (mode.tool === 'tone' && tone.isMarquee()) {
        if (e.key === 'Enter') { tone.closePolygon(); return true; }
        if (e.key === 'Escape') { tone.clear(); ctx.chrome(); ctx.request(); return true; }
      }
      if (pixelBrush() && e.key === 'Escape') { smudge.clear(); pickingClone = false; ctx.chrome(); ctx.request(); return true; }
      if (shapeEditor.available() && e.key === 'Escape') { shapeEditor.cancel(); return true; }
      if (shapeEditor.available() && e.key === 'Enter' && !(e.target instanceof Element && e.target.closest('button, a, [role="button"]'))) {
        if (shapeEditor.active()) shapeEditor.apply();
        else shapeEditor.start();
        return true;
      }
      if (pickingColor && e.key === 'Escape') { pickingColor = false; ctx.chrome(); ctx.request(); return true; }
      if (mode.tool === 'image' && e.key === 'Escape') { images.end(true); ctx.request(); return true; }
      if (mode.tool === 'selection' && e.key === 'Escape') { selection.cancel(true); return true; }
      if (mode.tool === 'pixels' && e.key === 'Escape') { pixels.clear(); ctx.chrome(); ctx.request(); return true; }
      if (mode.tool === 'pixels' && e.key === 'Enter' && !(e.target instanceof Element && e.target.closest('button, a, [role="button"]'))) { pixels.apply(); return true; }
      if (e.key === 'Escape' && (vdrag || vbrush || verase)) { cancelVector(); return true; }
      if (mode.tool === 'fill' && (e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        state.check = !state.check;
        preview = null;
        ctx.hint(state.check ? 'Gap check on · red rings mark open line ends' : 'Gap check off', { timeout: 2200 });
        ctx.chrome();
        ctx.request();
        return true;
      }
      if (mode.tool === 'vedit' && vsel && (e.key === 'Delete' || e.key === 'Backspace')) {
        const index = selectedNode;
        if (editVariant() === 'nodes' && index !== null) changeSelected('Delete vector point', (s) => removePoint(s, index));
        else changeSelected('Delete line', () => null);
        return true;
      }
      if (e.key === '[' || e.key === ']') {
        const t = sizeTool() ?? (mode.tool === 'lines' ? 'ink' : null);
        if (!t) return false;
        const pt = sizeIn(t) * PT;
        const step = Math.max(SIZE_STEP, pt * 0.12);
        ink.sizes[brushKey(t)] = clampToolValue(pt + (e.key === ']' ? step : -step), MIN_SIZE, maxSize(t), SIZE_STEP);
        saveInk();
        ctx.chrome();
        ctx.request();
        return true;
      }
      return false;
    },
    dispose() {
      clearTimeout(holdTimer);
      selection.dispose();
      tone.clear();
      pixels.clear();
      smudge.clear();
      shapeEditor.clear();
      if (live) endStroke(false);
    },
  };
  return mode;
}

export type { Pass };
