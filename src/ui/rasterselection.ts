import { findLayer, type Layer, type PixelTransform, type Pt } from '../doc/model';
import { composeMatrix, IDENTITY_MATRIX, isUnmoved, liftPixels, paintPixelTransform, transformDestination, type LiftedPixels } from '../draw/pixeltransform';
import { touchLayer } from '../draw/residency';
import { applyPoint, IDENTITY, invert, matrixFor, unionRect, type Mat, type Rect, type XParams } from '../engine/core/selxform';
import type { Bounds } from '../geom/resizebox';
import type { DeskCtx } from './desk';
import { h, seg, toast } from './dom';
import { drawSelectionFrame, grabSelection, selectionCenter, selectionCorners, selectionTransform, type SelectionGrab } from './selectiongesture';
import { createMarquee, type MarqueeShape } from './marquee';
import { toSource, withPlacement, type Placement } from './placement';

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

export function rasterSelection(ctx: DeskCtx, layersAt: (p: Pt) => Layer[], keepResident: () => void, placement: (id: string) => Placement | null = () => null) {
  const { page, art, studio, book } = ctx;
  const dpi = book.dpi;
  let selected: Selection | null = null;
  const marquee = createMarquee(ctx, (polygon, from) => {
    for (const layer of layersAt(from)) {
      const source = art.planes[layer.id];
      if (!source) continue;
      const place = placement(layer.id);
      const local = polygon.map((p) => toSource(place, p));
      const lifted = liftPixels(source, local, dpi);
      if (!lifted) continue;
      selected = { id: layer.id, name: layer.name, source, revision: art.revs[layer.id] ?? 0, polygon: local, lifted, place };
      break;
    }
      if (!selected) toast('No painted pixels in this selection.');
  });
  let drag: { grab: SelectionGrab; from: Pt; bounds: Bounds; base: Mat; moved: boolean } | null = null;
  let matrix = IDENTITY_MATRIX;
  let preview: CanvasRenderingContext2D | null = null;
  let rendered: Mat | null = null;
  let renderedCopy = false;
  let copy = false;
  let dirty: Rect | null = null;
  let resizeMode: 'uniform' | 'freeform' = 'freeform';

  function current(): Selection | null {
    if (!selected) return null;
    const match = findLayer(page, selected.id);
    if (!match || match.layer.vector || match.layer.image || match.layer.locked || !match.layer.visible || !match.group.visible || match.group.locked ||
      selected.source !== art.planes[selected.id] || selected.revision !== (art.revs[selected.id] ?? 0)) return null;
    return selected;
  }

  function stopGesture(): void {
    if (drag) studio.drawing = false;
    marquee.clear();
    drag = null;
  }

  function clear(): void {
    stopGesture();
    selected = null;
    matrix = IDENTITY_MATRIX;
    copy = false;
    preview = null;
    rendered = null;
    dirty = null;
  }

  function bounds(s: Selection): Bounds {
    const { x, y, w, h } = s.lifted.rect;
    const pts = selectionCorners({ x: x / dpi, y: y / dpi }, { x: (x + w) / dpi, y: (y + h) / dpi });
    const mapped = pts.map((p) => applyPoint(matrix, p.x, p.y));
    const xs = mapped.map((p) => p[0]), ys = mapped.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  function frame(b: Bounds, scale: number): Bounds {
    const px = Math.max(0, 24 / scale - (b.x1 - b.x0)) / 2;
    const py = Math.max(0, 24 / scale - (b.y1 - b.y0)) / 2;
    return { x0: b.x0 - px, y0: b.y0 - py, x1: b.x1 + px, y1: b.y1 + py };
  }

  function apply(): void {
    const s = current();
    if (!s || isUnmoved(matrix) || drag) return;
    const { source, lifted, id } = s;
    const destination = transformDestination(lifted, matrix, dpi, source.width, source.height);
    if (!destination) { toast('Move the selection back onto the page before applying.'); return; }
    const region = unionRect(lifted.rect, destination)!;
    const g = source.getContext('2d')!;
    const { x, y, w, h } = region;
    const before = g.getImageData(x, y, w, h);
    const layer = findLayer(page, id)!.layer;
    const previous = layer.pixelTransforms;
    const edit: PixelTransform = { polygon: s.polygon, matrix: [...matrix], strokes: layer.strokes.length, fills: layer.fills.length, ...(copy ? { copy: true } : {}) };
    const next = [...previous ?? [], edit];
    let after: ImageData;
    try {
      paintPixelTransform(g, lifted, matrix, dpi, copy);
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

  function adjust(patch: Partial<XParams>, b: Bounds, base: Mat): void {
    const pivot = selectionCenter(b);
    const next = composeMatrix(matrixFor({ ...IDENTITY, ...patch }, pivot.x, pivot.y), base);
    if (next.every(Number.isFinite) && invert(next)) matrix = next;
  }

  return {
    down(p: Pt, e: PointerEvent, shape: MarqueeShape) {
      if (marquee.active()) { marquee.down(p, shape); return; }
      const s = current();
      if (s) {
        const b = bounds(s);
        const at = toSource(s.place, p);
        const grab = grabSelection(frame(b, ctx.scale()), at, ctx.scale(), e.pointerType === 'touch');
        if (grab) {
          drag = { grab, from: at, bounds: b, base: matrix, moved: false };
          studio.drawing = true;
          return;
        }
        if (!isUnmoved(matrix)) { toast('Apply or cancel the transform before making a new selection.'); return; }
      }
      clear();
      marquee.down(p, shape);
      ctx.chrome();
    },
    move(p: Pt, e: PointerEvent) {
      if (marquee.active()) { marquee.move(p); return; }
      const s = current();
      if (!drag || !s) return;
      p = toSource(s.place, p);
      if (!drag.moved && Math.hypot(p.x - drag.from.x, p.y - drag.from.y) * ctx.scale() < 2) return;
      drag.moved = true;
      const modifiers = { shiftKey: e.shiftKey || (drag.grab.kind === 'resize' && resizeMode === 'uniform'), altKey: e.altKey };
      adjust(selectionTransform(drag.grab, drag.bounds, drag.from, p, modifiers, 1 / dpi), drag.bounds, drag.base);
    },
    up(p: Pt, e: PointerEvent) {
      if (e.type === 'pointercancel') {
        if (drag) matrix = drag.base;
        stopGesture();
        ctx.chrome();
        ctx.request();
        return;
      }
      if (drag) {
        this.move(p, e);
        stopGesture();
        ctx.chrome();
        return;
      }
      marquee.up(p, false);
    },
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    resetMarquee: marquee.clear,
    isMarquee: marquee.active,
    clear,
    apply,
    live(): Record<string, HTMLCanvasElement> {
      const s = current();
      if (!s || isUnmoved(matrix)) return {};
      if (!preview) {
        const canvas = document.createElement('canvas');
        canvas.width = s.source.width;
        canvas.height = s.source.height;
        preview = canvas.getContext('2d')!;
        preview.drawImage(s.source, 0, 0);
      }
      if (rendered !== matrix || renderedCopy !== copy) {
        if (dirty) {
          const { x, y, w, h } = dirty;
          preview.clearRect(x, y, w, h);
          preview.drawImage(s.source, x, y, w, h, x, y, w, h);
        }
        dirty = paintPixelTransform(preview, s.lifted, matrix, dpi, copy);
        rendered = matrix;
        renderedCopy = copy;
      }
      return { [s.id]: preview.canvas };
    },
    controls() {
      const s = current();
      if (!s && selected) clear();
      const action = (label: string, patch: Partial<XParams>) => h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => {
        if (!s || current() !== s || drag) return;
        adjust(patch, bounds(s), matrix);
        ctx.chrome();
        ctx.request();
      } }, label);
      return [...marquee.controls(), h('button', { class: 'btn primary', type: 'button', disabled: !s || isUnmoved(matrix), onclick: apply }, 'Apply'),
        h('button', { class: 'btn', type: 'button', disabled: !s && !marquee.active(), onclick: () => { clear(); ctx.chrome(); ctx.request(); } }, 'Cancel'),
        seg<'uniform' | 'freeform'>([{ id: 'freeform', label: 'Freeform' }, { id: 'uniform', label: 'Uniform' }], resizeMode, (value) => { resizeMode = value; ctx.chrome(); }, 'Transform scale'),
        h('button', { class: 'btn', type: 'button', disabled: !s, 'aria-pressed': String(copy), onclick: () => { copy = !copy; ctx.chrome(); ctx.request(); } }, 'Keep original'),
        action('Flip horizontal', { flipH: true }), action('Flip vertical', { flipV: true }), action('Rotate 45°', { rotate: 45 }),
        h('span', { class: 'hint' }, s ? `${s.name} · Drag inside to move or use the handles` : 'Draw around pixels on a paint layer')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      const s = current();
      if (s) withPlacement(g, s.place, scale, (sc, k) => drawSelectionFrame(g, frame(bounds(s), sc), sc, undefined, true, 4 / k));
      g.restore();
    },
  };
}
