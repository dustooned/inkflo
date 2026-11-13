import { findLayer, type CloneStroke, type Layer, type Pt, type SmudgeStroke } from '../doc/model';
import { cloneSegment } from '../draw/clone';
import { smudgeSegment } from '../draw/smudge';
import { touchLayer } from '../draw/residency';
import { unionRect, type Rect } from '../engine/core/selxform';
import type { DeskCtx } from './desk';
import { toast } from './dom';
import { toSource, type Placement } from './placement';

type Sample = SmudgeStroke['points'][number];

export function smudgeTool(ctx: DeskCtx, layersAt: (p: Sample) => Layer[], keepResident: () => void, placement: (id: string) => Placement | null = () => null) {
  const { studio, page, art, book: { dpi } } = ctx;
  let draft: { id: string; place: Placement | null; source: HTMLCanvasElement; revision: number; preview: CanvasRenderingContext2D; edit: SmudgeStroke | CloneStroke; dirty: Rect | null } | null = null;

  function clear(): void {
    if (draft) studio.drawing = false;
    draft = null;
  }

  /** Page sample → the layer's source space (a moved panel keeps its pixels where it was carved). */
  const local = (place: Placement | null, p: Sample): Sample => ({ ...p, ...toSource(place, p) });

  function move(page: Sample): void {
    if (!draft) return;
    const { edit, preview } = draft;
    const p = local(draft.place, page);
    const last = edit.points.at(-1)!;
    if (edit.points.length >= 8192 || Math.hypot(last.x - p.x, last.y - p.y) * dpi < 1.5) return;
    edit.points.push(p);
    draft.dirty = unionRect(draft.dirty, edit.kind === 'clone' ? cloneSegment(preview, draft.source.getContext('2d')!, last, p, edit, dpi) : smudgeSegment(preview, last, p, edit, dpi));
  }

  return {
    clear,
    down(p: Sample, size: number, strength: number, cloneFrom?: Pt) {
      const pageAt = cloneFrom ?? p;
      const layers = layersAt({ ...p, ...pageAt });
      const drawable = layers.filter((l) => art.planes[l.id]);
      const painted = (l: Layer) => {
        const q = toSource(placement(l.id), pageAt);
        return art.planes[l.id]!.getContext('2d')!.getImageData(Math.floor(q.x * dpi), Math.floor(q.y * dpi), 1, 1).data[3];
      };
      const layer = drawable.find(painted) ?? drawable[0];
      const source = layer && art.planes[layer.id];
      if (!layer || !source) { toast(cloneFrom ? 'Set the source on a painted layer.' : 'Choose a painted layer to smudge.'); return; }
      const place = placement(layer.id);
      p = local(place, p);
      if (cloneFrom) cloneFrom = toSource(place, cloneFrom);
      if (place) size /= place.k;
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const preview = canvas.getContext('2d', { willReadFrequently: true })!;
      preview.drawImage(source, 0, 0);
      const edit = { points: [p], size, strength, strokes: layer.strokes.length, fills: layer.fills.length };
      draft = { id: layer.id, place, source, revision: art.revs[layer.id] ?? 0, preview, dirty: null,
        edit: cloneFrom ? { kind: 'clone', ...edit, offset: { x: cloneFrom.x - p.x, y: cloneFrom.y - p.y } } : { kind: 'smudge', ...edit } };
      if (cloneFrom) {
        draft.edit.points.push(p);
        draft.dirty = cloneSegment(preview, source.getContext('2d')!, p, p, draft.edit as CloneStroke, dpi);
      }
      studio.drawing = true;
    },
    move,
    up(cancel: boolean) {
      const d = draft;
      clear();
      if (cancel || !d?.dirty) return;
      const { id, source, dirty: { x, y, w, h }, preview, edit } = d;
      const target = findLayer(page, id);
      if (!target || target.group.locked || !target.group.visible || target.layer.locked || !target.layer.visible ||
        art.planes[id] !== source || (art.revs[id] ?? 0) !== d.revision) return;
      const g = source.getContext('2d')!;
      const before = g.getImageData(x, y, w, h);
      const after = preview.getImageData(x, y, w, h);
      if (before.data.every((value, i) => value === after.data[i])) return;
      const old = target.layer.pixelTransforms;
      const next = [...old ?? [], edit];
      const write = (image: ImageData, operations: typeof old) => {
        const layer = findLayer(page, id)?.layer;
        if (!layer) return;
        g.putImageData(image, x, y);
        if (operations) layer.pixelTransforms = operations;
        else delete layer.pixelTransforms;
        touchLayer(art, id);
      };
      keepResident();
      studio.run({ label: edit.kind === 'clone' ? 'Clone' : 'Smudge', do: () => write(after, next), undo: () => write(before, old) });
      studio.markStage(page, 'draw', 1);
    },
    live(): Record<string, HTMLCanvasElement> {
      return draft?.dirty && (art.revs[draft.id] ?? 0) === draft.revision ? { [draft.id]: draft.preview.canvas } : {};
    },
  };
}
