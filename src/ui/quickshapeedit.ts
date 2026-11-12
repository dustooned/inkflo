import { findLayer, type Pt, type Stroke } from '../doc/model';
import { adjustShapeHandle, editableShape, shapeHandles, shapeStrokePoints, type EditableShape, type ShapeGrab } from '../draw/shapeedit';
import { touchLayer } from '../draw/residency';
import { putPixels, type RasterEngine, type StrokeCommit } from '../engine/brush/raster';
import type { Command } from '../engine/core/history';
import { SHAPE_NAMES, type Shape } from '../engine/core/quickshape';
import { unionRect } from '../engine/core/selxform';
import type { StrokeRecord } from '../engine/core/stroke';
import { renderVectorLayer } from '../render/vector';
import type { DeskCtx } from './desk';
import { h, toast } from './dom';

interface LandedShape {
  shape: Shape;
  layerId: string;
  seed: number;
  pressure: number[];
  record: StrokeRecord;
  /** Absent for vector layers. Raster can lift only the original stroke's exact pixel delta. */
  original?: Pick<StrokeCommit, 'rect' | 'before'>;
}

export function quickShapeEditor(ctx: DeskCtx, engine: RasterEngine, editVector: (id: string, label: string, strokes: Stroke[]) => void) {
  const { studio, page, art, book: { dpi } } = ctx;
  let last: (Omit<LandedShape, 'shape'> & { shape: EditableShape; history: Command; revision: number }) | null = null;
  let draft: EditableShape | null = null;
  let round = false;
  let drag: { at: Pt; before: EditableShape; grab: ShapeGrab } | null = null;
  let preview: HTMLCanvasElement | null = null;
  let rendered: EditableShape | null = null;
  let paint: StrokeCommit | null = null;

  function clear(): void {
    if (drag) studio.drawing = false;
    if (preview && last?.original) {
      const source = art.planes[last.layerId];
      if (source) engine.bind(source);
    }
    last = null;
    draft = null;
    drag = null;
    preview = null;
    rendered = null;
    paint = null;
  }

  function current() {
    if (!last) return null;
    const found = findLayer(page, last.layerId);
    if (last.history !== studio.history.peekUndo() || last.revision !== (art.revs[last.layerId] ?? 0) || !found ||
      !found.group.visible || found.group.locked || !found.layer.visible || found.layer.locked) { clear(); return null; }
    const index = found.layer.strokes.length - 1;
    const stroke = found.layer.strokes[index];
    if (!stroke || stroke.seed !== last.seed) { clear(); return null; }
    return { ...found, index, stroke, entry: last };
  }

  function start(): void {
    const target = current();
    if (!target || draft) return;
    draft = target.entry.shape;
    round = draft.kind === 'ellipse' && Math.abs(draft.rx - draft.ry) < 1e-6;
    ctx.chrome();
    ctx.request();
  }

  function sameShape(a: EditableShape, b: EditableShape): boolean {
    return a === b || JSON.stringify(a) === JSON.stringify(b);
  }

  function replacement(stroke: Stroke, points: StrokeRecord['points']): Stroke {
    return { ...stroke, pts: points.map((p) => ({ x: p.x / dpi, y: p.y / dpi })), pressure: points.map((p) => p.pressure) };
  }

  function render(target: NonNullable<ReturnType<typeof current>>, shape: EditableShape): HTMLCanvasElement | null {
    const { entry, layer, stroke, index } = target;
    if (rendered === shape) return preview;
    const source = art.planes[layer.id];
    if (!source) return null;
    if (!preview) {
      preview = document.createElement('canvas');
      preview.width = source.width;
      preview.height = source.height;
      if (entry.original) {
        preview.getContext('2d')!.drawImage(source, 0, 0);
        putPixels(preview, entry.original.rect, entry.original.before);
      }
    }
    const points = shapeStrokePoints(shape, entry.pressure, dpi, entry.record.points[0]?.t);
    if (entry.original) {
      if (paint) putPixels(preview, paint.rect, paint.before);
      engine.resize(preview.width, preview.height);
      engine.bind(preview);
      engine.begin({ ...entry.record, points }, null);
      paint = engine.commit(true);
    } else {
      const strokes = layer.strokes.slice();
      strokes[index] = replacement(stroke, points);
      renderVectorLayer({ ...layer, strokes }, preview, dpi);
    }
    rendered = shape;
    return preview;
  }

  function cancel(): void {
    clear();
    ctx.chrome();
    ctx.request();
  }

  function apply(): void {
    const target = current();
    if (!target || !draft || drag || sameShape(target.entry.shape, draft)) return;
    const { entry, layer, stroke, index } = target;
    const next = replacement(stroke, shapeStrokePoints(draft, entry.pressure, dpi, entry.record.points[0]?.t));
    const label = `Edit ${SHAPE_NAMES[draft.kind].toLowerCase()}`;
    if (!entry.original) {
      const strokes = layer.strokes.slice();
      strokes[index] = next;
      clear();
      editVector(layer.id, label, strokes);
    } else {
      const source = art.planes[layer.id];
      const canvas = render(target, draft);
      if (!source || !canvas || !paint) { toast('Move the shape onto the page to apply the edit.'); return; }
      const region = unionRect(entry.original.rect, paint.rect)!;
      const { x, y, w, h } = region;
      const before = source.getContext('2d')!.getImageData(x, y, w, h);
      const after = canvas.getContext('2d')!.getImageData(x, y, w, h);
      const write = (pixels: ImageData, value: Stroke) => {
        const match = findLayer(page, layer.id);
        if (!match || match.layer.strokes[index]?.seed !== entry.seed) return;
        putPixels(source, region, pixels);
        match.layer.strokes[index] = value;
        touchLayer(art, layer.id);
      };
      clear();
      studio.run({ label, do: () => write(after, next), undo: () => write(before, stroke) });
    }
    ctx.chrome();
    ctx.request();
  }

  function move(p: Pt, e: PointerEvent): void {
    if (!drag) return;
    const delta = { x: p.x * dpi - drag.at.x, y: p.y * dpi - drag.at.y };
    draft = adjustShapeHandle(drag.before, drag.grab, delta, e.shiftKey || round);
  }

  return {
    clear,
    cancel,
    apply,
    start,
    remember(landed: LandedShape) {
      const history = studio.history.peekUndo();
      if (history && editableShape(landed.shape)) last = { ...landed, shape: landed.shape, history, revision: art.revs[landed.layerId] ?? 0 };
    },
    active: () => !!current() && !!draft,
    available: () => !!current(),
    down(p: Pt, e: PointerEvent) {
      if (!draft) return;
      const at = { x: p.x * dpi, y: p.y * dpi };
      const reach = (e.pointerType === 'touch' ? 16 : 10) * dpi / ctx.scale();
      const nearest = shapeHandles(draft).map((handle) => ({ handle, distance: Math.hypot(handle.at.x - at.x, handle.at.y - at.y) })).sort((a, b) => a.distance - b.distance)[0]!;
      if (nearest.distance > reach) return;
      drag = { at, before: draft, grab: nearest.handle.grab };
      studio.drawing = true;
    },
    move,
    up(p: Pt, e: PointerEvent) {
      if (!drag) return;
      if (e.type === 'pointercancel') draft = drag.before;
      else move(p, e);
      drag = null;
      studio.drawing = false;
      ctx.chrome();
      ctx.request();
    },
    controls(): HTMLElement[] {
      const target = current();
      if (!target) return [];
      if (!draft) return [h('button', { class: 'btn', type: 'button', onclick: start }, 'Edit shape')];
      const buttons: HTMLElement[] = [h('button', { class: 'btn primary', type: 'button', disabled: sameShape(target.entry.shape, draft), onclick: apply }, 'Apply shape'),
        h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel')];
      if (draft.kind === 'ellipse') {
        const check = h('input', { type: 'checkbox', checked: round });
        check.addEventListener('change', () => {
          round = check.checked;
          if (round && draft?.kind === 'ellipse') {
            const radius = Math.sqrt(draft.rx * draft.ry);
            draft = { ...draft, rx: radius, ry: radius };
          }
          ctx.chrome();
          ctx.request();
        });
        buttons.push(h('label', { class: 'mini' }, check, 'Keep round'));
      }
      return [...buttons, h('span', { class: 'hint' }, 'Drag a handle · Shift to constrain')];
    },
    live(): Record<string, HTMLCanvasElement> {
      const target = current();
      if (!target || !draft || sameShape(target.entry.shape, draft)) return {};
      const canvas = render(target, draft);
      return canvas ? { [target.layer.id]: canvas } : {};
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      if (!draft) return;
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.fillStyle = '#FFFDF7';
      g.lineWidth = 1.8;
      for (const { at, grab } of shapeHandles(draft)) {
        const x = at.x * scale / dpi, y = at.y * scale / dpi;
        g.beginPath();
        if (grab.kind === 'move') g.rect(x - 4, y - 4, 8, 8);
        else g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.restore();
    },
  };
}
