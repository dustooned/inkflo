import { allLayers, type Fill, type Layer, type LayerGroup, type LayerType, type Page, type Pass, type Pt, type Stroke } from '../doc/model';
import { brushFor, PASS_STYLE } from './brushes';
import { planeCanvas, touchLayer, type PageArt, type PlaneOps } from './residency';
import type { RasterEngine } from '../engine/brush/raster';
import type { StrokePoint, StrokeRecord } from '../engine/core/stroke';
import { polygonMask } from '../engine/fill/fill';
import { renderVectorLayer } from '../render/vector';
import { gutterMask } from '../geom/gutters';
import { FillKit, FILL_THRESHOLD, hexRgb, type Refer } from './fillkit';
import { derivePanels, panelAt, type Panel } from '../geom/carve';
import { fillRefLayers } from '../geom/groups';

/**
 * Rebuild layer bitmaps from the page's data (strokes and fills).
 *
 * Strokes are stored in page units (inches) so one page renders at any dpi: screen, 300 dpi
 * library bitmaps, 600 dpi print export (rule 5: one render path).
 */

/** Synthetic sample spacing at `REF_DPI`, because the spec `Stroke` carries no time (speed taper is approximate). */
export const SAMPLE_MS = 8;

/**
 * The resolution the engine's pixel-valued brush settings are tuned for. Taper lengths are in
 * pixels and speed is in px/ms, so both are scaled by `dpi / REF_DPI` to make a stroke look the
 * same at any dpi.
 */
export const REF_DPI = 300;

export type LinePass = Exclude<Pass, 'colour'>;

/** The pass a brush draws in on a layer of this type, unless the stroke says otherwise. */
export function passForType(type: LayerType): LinePass {
  return type === 'pencil' ? 'pencil' : 'ink';
}

/** The engine brush and colour a stroke draws with at `dpi` (shared by live drawing and replay). */
export function strokeStyle(brushId: string, w: number, pass: LinePass, dpi: number, erase = false, opacity = 1, color = PASS_STYLE[pass].color): Pick<StrokeRecord, 'brush' | 'color' | 'tool'> {
  const k = dpi / REF_DPI;
  const brush = brushFor(brushId, pass);
  brush.size = w * dpi;
  brush.taperStart *= k;
  brush.taperEnd *= k;
  if (!erase) brush.opacity *= PASS_STYLE[pass].opacity;
  brush.opacity *= opacity;
  return { brush, color, tool: erase ? 'eraser' : 'brush' };
}

/** One stored stroke as the engine's record, scaled to `dpi`. Pure, so it is testable without a canvas. */
export function toRecord(stroke: Stroke, pass: LinePass, dpi: number, id = 'replay'): StrokeRecord {
  const k = dpi / REF_DPI;
  const points: StrokePoint[] = stroke.pts.map((p, i) => ({
    x: p.x * dpi,
    y: p.y * dpi,
    pressure: stroke.pressure?.[i] ?? 1,
    tiltX: 0,
    tiltY: 0,
    t: i * SAMPLE_MS * k, // same speed in page units at every dpi
    ...(stroke.pw ? { w: stroke.pw[i] ?? 1 } : {}),
  }));
  const style = strokeStyle(stroke.brushId, stroke.w, stroke.pass ?? pass, dpi, stroke.erase, stroke.opacity, stroke.color);
  if (stroke.flat?.[0]) style.brush.taperStart = 0;
  if (stroke.flat?.[1]) style.brush.taperEnd = 0;
  return { id, ...style, seed: stroke.seed, points };
}

/** The pixel mask (1 = inside) of a panel at `dpi`, for clipping strokes and fills. */
export function panelMask(panel: Panel, dpi: number, w: number, h: number): Uint8Array | null {
  return polygonMask(panel.pts.map((p) => [p.x * dpi, p.y * dpi] as const), w, h)?.mask ?? null;
}

/** Replay strokes onto a canvas (already cleared and bound). */
function replayStrokes(strokes: Stroke[], pass: LinePass, dpi: number, w: number, h: number, engine: RasterEngine, panels: Panel[], tag: string): void {
  const masks = new Map<Panel, Uint8Array | null>();
  strokes.forEach((s, i) => {
    let clip: Uint8Array | null = null;
    if (s.clip && s.pts[0]) {
      const p = panelAt(panels, s.pts[0]);
      if (p) {
        if (!masks.has(p)) masks.set(p, panelMask(p, dpi, w, h));
        clip = masks.get(p) ?? null;
      }
    }
    engine.begin(toRecord(s, pass, dpi, `${tag}:${i}`), clip);
    engine.commit(true);
  });
}

// ---------------------------------------------------------------------------------------------
// Colour fills

export { FILL_THRESHOLD };

/** The alpha of the fill-reference layers, combined (max), the walls fills stop at. */
export function refAlpha(layers: Layer[], art: PageArt, w: number, h: number): Uint8Array {
  const alpha = new Uint8Array(w * h);
  for (const l of layers) {
    if (l.image) continue;
    const c = art.planes[l.id];
    if (!c || !c.width) continue;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    for (let i = 0; i < alpha.length; i++) {
      const a = d[i * 4 + 3]!;
      if (a > alpha[i]!) alpha[i] = a;
    }
  }
  return alpha;
}

/** The layers a fill reads walls from: the group's references, or every visible line layer. */
export function wallLayers(page: Page, group: LayerGroup, refer: Refer): Layer[] {
  if (refer === 'refs') return fillRefLayers(page, group);
  return page.groups.filter((g) => g.visible).flatMap((g) => g.layers.filter((l) => l.visible && l.type !== 'colour'));
}

/** A fill kit for a colour layer: walls from its group (or all lines), panels as the outer wall. */
export function layerKit(page: Page, art: PageArt, layer: Layer, dpi: number, panels: Panel[]): FillKit {
  const group = page.groups.find((g) => g.layers.some((l) => l.id === layer.id))!;
  return new FillKit((refer) => refAlpha(wallLayers(page, group, refer).filter((l) => l.id !== layer.id), art, art.width, art.height), art.width, art.height, dpi, panels, group.kind === 'gutter' ? gutterMask(page, dpi, art.width, art.height) : undefined);
}

export interface FillPaint {
  rect: { x: number; y: number; w: number; h: number };
  before: ImageData;
  after: ImageData;
}

/**
 * Paint one fill onto a colour canvas. Returns before/after pixels for undo, or null when
 * nothing is painted.
 */
export function paintFill(kit: FillKit, colour: HTMLCanvasElement, fill: Fill): FillPaint | null {
  const w = colour.width;
  const g = colour.getContext('2d', { willReadFrequently: true })!;
  const whole = fill.leftover ? g.getImageData(0, 0, w, colour.height).data : undefined;
  const m = kit.mask(fill, whole);
  if (!m) return null;
  const { res, rgbAt } = m;
  const rect = { x: res.x0, y: res.y0, w: res.x1 - res.x0 + 1, h: res.y1 - res.y0 + 1 };
  const before = g.getImageData(rect.x, rect.y, rect.w, rect.h);
  const after = new ImageData(new Uint8ClampedArray(before.data), rect.w, rect.h);
  const own = hexRgb(fill.color);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const k = (rect.y + y) * w + rect.x + x;
      if (!res.mask[k]) continue;
      const c = rgbAt?.get(k) ?? own;
      const i = (y * rect.w + x) * 4;
      after.data[i] = (c >> 16) & 255;
      after.data[i + 1] = (c >> 8) & 255;
      after.data[i + 2] = c & 255;
      after.data[i + 3] = 255;
    }
  }
  g.putImageData(after, rect.x, rect.y);
  return { rect, before, after };
}

// ---------------------------------------------------------------------------------------------
// Whole layers and pages


/**
 * Clear one layer's bitmap and redraw it from its data: fills first (from the group's
 * reference lines, which must already be current), then strokes. Bumps the layer's revision.
 */
export function replayLayer(page: Page, art: PageArt, layer: Layer, dpi: number, engine: RasterEngine, ops: Pick<PlaneOps, 'newCanvas' | 'resize'>, panels: Panel[] = derivePanels(page)): void {
  if (layer.image) return;
  if (!layer.strokes.length && !layer.fills.length && !art.planes[layer.id]) return; // nothing drawn, nothing to clear
  const canvas = planeCanvas(art, layer.id, ops);
  ops.resize(canvas, art.width, art.height); // resizing clears
  if (layer.fills.length) {
    const kit = layerKit(page, art, layer, dpi, panels);
    for (const f of layer.fills) paintFill(kit, canvas, f);
  }
  if (layer.vector) {
    renderVectorLayer(layer, canvas, dpi);
  } else if (layer.strokes.length) {
    engine.resize(art.width, art.height);
    engine.bind(canvas);
    replayStrokes(layer.strokes, passForType(layer.type), dpi, art.width, art.height, engine, panels, `${page.id}:${layer.id}`);
  }
  touchLayer(art, layer.id);
}

/** Rebuild every layer of a page: reference layers first, so fills see current walls. */
export function rebuildPage(page: Page, art: PageArt, dpi: number, engine: RasterEngine, ops: Pick<PlaneOps, 'newCanvas' | 'resize'>): void {
  const panels = derivePanels(page);
  const layers = allLayers(page);
  for (const l of layers) if (!l.fills.length) replayLayer(page, art, l, dpi, engine, ops, panels);
  for (const l of layers) if (l.fills.length) replayLayer(page, art, l, dpi, engine, ops, panels);
}

export type { Pt };
