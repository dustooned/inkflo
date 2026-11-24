import { findLayer, type Layer, type PixelTransform, type Pt } from '../doc/model';
import { IDENTITY_MATRIX, isUnmoved, liftPixels, paintPixelTransform, transformDestination, type LiftedPixels } from '../draw/pixeltransform';
import { touchLayer } from '../draw/residency';
import { applyPoint, unionRect, type Mat, type Rect } from '../engine/core/selxform';
import { boxFromBounds } from '../geom/xformbox';
import type { DeskCtx } from './desk';
import { h, seg, toast } from './dom';
import { createMarquee, type MarqueeShape } from './marquee';
import { selectionCorners } from './selectiongesture';
import { toSource, withPlacement, type Placement } from './placement';
import { createTransformBox, type PinchGesture } from './transformbox';

interface Selection {
  id: string;
  name: string;
  source: HTMLCanvasElement;
  revision: number;
  polygon: Pt[];
  lifted: LiftedPixels;
  /** The panel placement the layer is shown through; the selection works in its source space. */
  place: Placement | null;
}

export function rasterSelection(ctx: DeskCtx, layersIn: (polygon: Pt[], from: Pt) => Layer[], keepResident: () => void,
  placement: (id: string) => Placement | null, emptyHint: () => string) {
  const { page, art, studio, book } = ctx;
  const dpi = book.dpi;
  let selected: Selection | null = null;
  /** The last area selected (page inches), kept after the tool changes: a gradient can use it. */
  let lastArea: Pt[] | null = null;
  const xf = createTransformBox({ scale: () => ctx.scale(), minSize: 1 / dpi, changed: () => ctx.request(), chrome: () => ctx.chrome() });
  const marquee = createMarquee(ctx, (polygon, from) => pick(polygon, from));
  function pick(polygon: Pt[], from: Pt, only?: Layer): void {
    lastArea = polygon.map((p) => ({ ...p }));
    for (const layer of only ? [only] : layersIn(polygon, from)) {
      const source = art.planes[layer.id];
      if (!source) continue;
      const place = placement(layer.id);
      const local = polygon.map((p) => toSource(place, p));
      const lifted = liftPixels(source, local, dpi);
      if (!lifted) continue;
      selected = { id: layer.id, name: layer.name, source, revision: art.revs[layer.id] ?? 0, polygon: local, lifted, place };
      const { x, y, w, h } = lifted.rect;
      xf.start(boxFromBounds({ x0: x / dpi, y0: y / dpi, x1: (x + w) / dpi, y1: (y + h) / dpi }));
      break;
    }
    if (!selected) toast(emptyHint());
  }
  /** The matrix the art is currently carried by; identity while the box is untouched. */
  const cur = (): Mat => xf.matrix() ?? IDENTITY_MATRIX;
  let preview: CanvasRenderingContext2D | null = null;
  let rendered: Mat | null = null;
  let renderedCopy = false;
  let renderedCrisp = false;
  let copy = false;
  /** Nearest-neighbour resampling: hard pixel edges, for pixel art and screentone. */
  let crisp = false;
  let dirty: Rect | null = null;

  function current(): Selection | null {
    if (!selected) return null;
    const match = findLayer(page, selected.id);
    if (!match || match.layer.vector || match.layer.image || match.layer.screenTone || match.layer.locked || !match.layer.visible ||
      !match.group.visible || match.group.locked || match.layer.opacity <= 0 || match.group.opacity <= 0 ||
      selected.source !== art.planes[selected.id] || selected.revision !== (art.revs[selected.id] ?? 0)) return null;
    return selected;
  }

  /** What the box needs to know about where the art sits: its placement zoom, and the page to snap to. */
  const view = (s: Selection) => ({ k: s.place?.k ?? 1, extent: s.place ? null : { w: page.widthIn, h: page.heightIn } });

  function stopGesture(): void {
    if (xf.dragging()) { studio.drawing = false; xf.up(); }
    marquee.clear();
  }

  function clear(): void {
    stopGesture();
    selected = null;
    xf.clear();
    copy = false;
    preview = null;
    rendered = null;
    dirty = null;
  }

  function apply(): void {
    const s = current();
    const matrix = cur();
    if (!s || isUnmoved(matrix) || xf.dragging()) return;
    const { source, lifted, id } = s;
    const destination = transformDestination(lifted, matrix, dpi, source.width, source.height);
    if (!destination) { toast('Move the selection back onto the page before applying.'); return; }
    const region = unionRect(lifted.rect, destination)!;
    const g = source.getContext('2d')!;
    const { x, y, w, h } = region;
    const before = g.getImageData(x, y, w, h);
    const layer = findLayer(page, id)!.layer;
    const previous = layer.pixelTransforms;
    const edit: PixelTransform = { polygon: s.polygon, matrix: [...matrix], strokes: layer.strokes.length, fills: layer.fills.length, ...(copy ? { copy: true } : {}), ...(crisp ? { crisp: true } : {}) };
    const next = [...previous ?? [], edit];
    let after: ImageData;
    try {
      paintPixelTransform(g, lifted, matrix, dpi, copy, crisp);
      after = g.getImageData(x, y, w, h);
    } catch (error) {
      g.putImageData(before, x, y);
      throw error;
    }
    const write = (pixels: ImageData, operations: Layer['pixelTransforms']) => {
      g.putImageData(pixels, x, y);
      const match = findLayer(page, id);
      if (match) {
        if (operations) match.layer.pixelTransforms = operations;
        else delete match.layer.pixelTransforms;
      }
      touchLayer(art, id);
    };
    keepResident();
    layer.pixelTransforms = next;
    touchLayer(art, id);
    studio.run({ label: 'Transform paint', do: () => write(after, next), undo: () => write(before, previous) }, true);
    studio.markStage(page, 'draw', 1);
    clear();
    ctx.chrome();
    ctx.request();
  }

  return {
    /** The outline of the last selection made with this tool (page inches), or null. */
    lastArea: () => lastArea,
    down(p: Pt, e: PointerEvent, shape: MarqueeShape) {
      if (marquee.active()) { marquee.down(p, shape); return; }
      const s = current();
      if (s) {
        if (xf.down(toSource(s.place, p), e, view(s))) { studio.drawing = true; return; }
        if (xf.moved()) { toast('Apply or cancel the transform before making a new selection.'); return; }
      }
      clear();
      marquee.down(p, shape);
      ctx.chrome();
    },
    move(p: Pt, e: PointerEvent) {
      if (marquee.active()) { marquee.move(p); return; }
      const s = current();
      if (!xf.dragging() || !s) return;
      xf.move(toSource(s.place, p), e);
    },
    up(p: Pt, e: PointerEvent) {
      if (e.type === 'pointercancel') {
        xf.cancel();
        studio.drawing = false;
        marquee.clear();
        ctx.chrome();
        ctx.request();
        return;
      }
      if (xf.dragging()) {
        this.move(p, e);
        stopGesture();
        ctx.chrome();
        return;
      }
      marquee.up(p, false);
    },
    /** Two fingers while art is selected pinch, twist and drag the box instead of the view. */
    pinch(g: PinchGesture | null): boolean {
      const s = current();
      if (!g) return xf.pinch(null);
      if (!s) return false;
      return xf.pinch({ ...g, anchor: toSource(s.place, g.anchor), to: toSource(s.place, g.to) });
    },
    /** Take everything on the current layer (or the first layer with paint) as the selection. */
    selectLayer() {
      if (current() && xf.moved()) return;
      clear();
      pick(selectionCorners({ x: 0, y: 0 }, { x: page.widthIn, y: page.heightIn }), { x: page.widthIn / 2, y: page.heightIn / 2 });
      ctx.chrome();
      ctx.request();
    },
    hasSelection: () => !!current(),
    /** Unapplied changes are waiting (a new selection must not silently drop them). */
    pending: () => !!current() && xf.moved(),
    /** Pointer-style pick: everything painted on this layer. */
    pickLayer(layer: Layer): boolean {
      clear();
      pick(selectionCorners({ x: 0, y: 0 }, { x: page.widthIn, y: page.heightIn }), { x: page.widthIn / 2, y: page.heightIn / 2 }, layer);
      return !!selected;
    },
    /** Take hold of the box under `p` without starting a new selection. */
    tryGrab(p: Pt, e: PointerEvent): boolean {
      const s = current();
      if (!s || !xf.down(toSource(s.place, p), e, view(s))) return false;
      studio.drawing = true;
      return true;
    },
    /** The selected pixels as a clipboard piece: size in inches, centre on the page. */
    clipboard(): { name: string; canvas: HTMLCanvasElement; widthIn: number; heightIn: number; centre: Pt } | null {
      const sel = current();
      if (!sel) return null;
      const { rect, pixels } = sel.lifted;
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      canvas.getContext('2d')!.drawImage(pixels, 0, 0);
      const mid = { x: (rect.x + rect.w / 2) / dpi, y: (rect.y + rect.h / 2) / dpi };
      const centre = sel.place ? (() => { const [x, y] = applyPoint(sel.place!.m, mid.x, mid.y); return { x, y }; })() : mid;
      const k = sel.place?.k ?? 1;
      return { name: sel.name + ' piece', canvas, widthIn: rect.w / dpi * k, heightIn: rect.h / dpi * k, centre };
    },
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    resetMarquee: marquee.clear,
    isMarquee: marquee.active,
    clear,
    apply,
    live(): Record<string, HTMLCanvasElement> {
      const s = current();
      const matrix = cur();
      if (!s || isUnmoved(matrix)) return {};
      if (!preview) {
        const canvas = document.createElement('canvas');
        canvas.width = s.source.width;
        canvas.height = s.source.height;
        preview = canvas.getContext('2d')!;
        preview.drawImage(s.source, 0, 0);
      }
      if (rendered !== matrix || renderedCopy !== copy || renderedCrisp !== crisp) {
        if (dirty) {
          const { x, y, w, h } = dirty;
          preview.clearRect(x, y, w, h);
          preview.drawImage(s.source, x, y, w, h, x, y, w, h);
        }
        dirty = paintPixelTransform(preview, s.lifted, matrix, dpi, copy, crisp);
        rendered = matrix;
        renderedCopy = copy;
        renderedCrisp = crisp;
      }
      return { [s.id]: preview.canvas };
    },
    controls() {
      const s = current();
      if (!s && selected) clear();
      return [...marquee.controls(),
        h('button', { class: 'btn primary', type: 'button', disabled: !s || !xf.moved(), onclick: apply }, 'Apply'),
        h('button', { class: 'btn', type: 'button', disabled: !s && !marquee.active(), onclick: () => { clear(); ctx.chrome(); ctx.request(); } }, 'Cancel'),
        h('button', { class: 'btn', type: 'button', title: 'Select everything painted on this layer', onclick: () => this.selectLayer() }, 'Whole layer'),
        ...xf.controls({ extent: () => (s && !s.place ? { w: page.widthIn, h: page.heightIn } : null) }),
        h('button', { class: 'btn', type: 'button', disabled: !s, 'aria-pressed': String(copy), title: 'Leave the original in place and place a copy', onclick: () => { copy = !copy; ctx.chrome(); ctx.request(); } }, 'Keep original'),
        seg<'smooth' | 'crisp'>([{ id: 'smooth', label: 'Smooth', hint: 'Blend edges when resizing or turning' }, { id: 'crisp', label: 'Crisp', hint: 'Hard pixel edges, nothing blended' }],
          crisp ? 'crisp' : 'smooth', (v) => { crisp = v === 'crisp'; ctx.chrome(); ctx.request(); }, 'Resampling'),
        h('span', { class: 'hint' }, s ? `${s.name} · Drag inside to move, a handle to resize, the knob or a corner's outside to turn · two fingers pinch and twist` : 'Draw around paint, or choose Whole layer. For vector ink, use Select lines.')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      const s = current();
      if (s) withPlacement(g, s.place, scale, (sc, k) => xf.overlay(g, sc, view(s)));
      g.restore();
    },
  };
}
