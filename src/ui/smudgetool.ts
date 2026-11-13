import { findLayer, type Layer, type SmudgeStroke } from '../doc/model';
import { smudgeSegment } from '../draw/smudge';
import { touchLayer } from '../draw/residency';
import { unionRect, type Rect } from '../engine/core/selxform';
import type { DeskCtx } from './desk';
import { toast } from './dom';

type Sample = SmudgeStroke['points'][number];

export function smudgeTool(ctx: DeskCtx, layersAt: (p: Sample) => Layer[], keepResident: () => void) {
  const { studio, page, art, book: { dpi } } = ctx;
  let draft: { id: string; source: HTMLCanvasElement; revision: number; preview: CanvasRenderingContext2D; edit: SmudgeStroke; dirty: Rect | null } | null = null;

  function clear(): void {
    if (draft) studio.drawing = false;
    draft = null;
  }

  function move(p: Sample): void {
    if (!draft) return;
    const { edit, preview } = draft;
    const last = edit.points.at(-1)!;
    if (edit.points.length >= 8192 || Math.hypot(last.x - p.x, last.y - p.y) * dpi < 1.5) return;
    edit.points.push(p);
    draft.dirty = unionRect(draft.dirty, smudgeSegment(preview, last, p, edit, dpi));
  }

  return {
    clear,
    down(p: Sample, size: number, strength: number) {
      const layers = layersAt(p);
      const x = Math.floor(p.x * dpi), y = Math.floor(p.y * dpi);
      const drawable = layers.filter((l) => art.planes[l.id]);
      const layer = drawable.find((l) => art.planes[l.id]!.getContext('2d')!.getImageData(x, y, 1, 1).data[3]) ?? drawable[0];
      const source = layer && art.planes[layer.id];
      if (!layer || !source) { toast('Choose a painted layer to smudge.'); return; }
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const preview = canvas.getContext('2d', { willReadFrequently: true })!;
      preview.drawImage(source, 0, 0);
      draft = { id: layer.id, source, revision: art.revs[layer.id] ?? 0, preview, dirty: null,
        edit: { kind: 'smudge', points: [p], size, strength, strokes: layer.strokes.length, fills: layer.fills.length } };
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
      studio.run({ label: 'Smudge', do: () => write(after, next), undo: () => write(before, old) });
      studio.markStage(page, 'draw', 1);
    },
    live(): Record<string, HTMLCanvasElement> {
      return draft?.dirty && (art.revs[draft.id] ?? 0) === draft.revision ? { [draft.id]: draft.preview.canvas } : {};
    },
  };
}
