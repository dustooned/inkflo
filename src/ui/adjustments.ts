import { findLayer, type Layer, type PixelAdjustment } from '../doc/model';
import { adjustPixels } from '../draw/adjustment';
import { touchLayer } from '../draw/residency';
import { NO_HSB, isNoHSB } from '../engine/core/adjust';
import { makeCanvas } from '../io/canvasops';
import type { DeskCtx } from './desk';
import { card } from './card';
import { h, slider, toast } from './dom';

export function openAdjustments(ctx: DeskCtx, layerId: string | null, keepResident: () => void): void {
  const { art, page, studio, book: { dpi } } = ctx;
  const match = layerId ? findLayer(page, layerId) : null;
  const source = layerId ? art.planes[layerId] : null;
  if (!match || !source || match.layer.vector || match.layer.image || match.layer.screenTone || !match.layer.visible || match.layer.locked || !match.group.visible || match.group.locked) {
    toast('Choose an unlocked paint layer with artwork from Layers.');
    return;
  }
  const { layer } = match;
  const revision = art.revs[layer.id] ?? 0;
  const edit: PixelAdjustment = { kind: 'adjustment', ...NO_HSB, blur: 0, strokes: layer.strokes.length, fills: layer.fills.length };
  const scale = Math.min(1, 440 / source.width, 360 / source.height);
  const preview = makeCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  preview.className = 'adjust-preview';
  preview.setAttribute('aria-label', 'Layer adjustment preview');
  const pg = preview.getContext('2d')!;
  pg.drawImage(source, 0, 0, preview.width, preview.height);
  const original = pg.getImageData(0, 0, preview.width, preview.height);
  const enabled = h('input', { type: 'checkbox', checked: true });
  let pending = 0;
  const render = () => {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = 0;
      pg.putImageData(enabled.checked ? adjustPixels(pg, original, edit, dpi * scale) : original, 0, 0);
    });
  };
  enabled.addEventListener('change', render);
  const control = (key: 'hue' | 'sat' | 'bright' | 'blur', label: string, min: number, max: number) => slider(label, min, max, 1, 0,
    (v) => key === 'hue' ? `${v}°` : key === 'blur' ? `${v} pt` : `${v}%`, (v) => { edit[key] = key === 'blur' ? v / 72 : v; render(); });
  const apply = h('button', { class: 'btn primary', type: 'button', onclick: () => {
    if (!edit.blur && isNoHSB(edit)) { dialog.close(); return; }
    if (art.planes[layer.id] !== source || (art.revs[layer.id] ?? 0) !== revision) { toast('The layer changed. Open Adjustments again.'); dialog.close(); return; }
    if (edit.blur && source.width * source.height > 12_000_000) { toast('This layer is too large for Gaussian blur in this browser.'); return; }
    const g = source.getContext('2d')!;
    const before = g.getImageData(0, 0, source.width, source.height);
    const after = adjustPixels(g, before, edit, dpi);
    const old = layer.pixelTransforms;
    const next = [...old ?? [], { ...edit }];
    const write = (pixels: ImageData, operations: Layer['pixelTransforms']) => {
      const target = findLayer(page, layer.id)?.layer;
      if (!target) return;
      if (operations) target.pixelTransforms = operations;
      else delete target.pixelTransforms;
      g.putImageData(pixels, 0, 0);
      touchLayer(art, layer.id);
    };
    keepResident();
    studio.run({ label: 'Adjust paint layer', do: () => write(after, next), undo: () => write(before, old) });
    dialog.close(); ctx.chrome(); ctx.request();
  } }, 'Apply');
  const { dialog, open } = card({
    title: 'Adjustments',
    className: 'adjust-dialog',
    detail: h('p', { class: 'note' }, layer.name),
    preview,
    sections: [h('label', { class: 'mini' }, enabled, 'Preview adjustment'),
      control('hue', 'Hue', -180, 180), control('sat', 'Saturation', -100, 100),
      control('bright', 'Brightness', -100, 100), control('blur', 'Gaussian blur', 0, 10)],
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'), apply],
    onClose: () => { if (pending) cancelAnimationFrame(pending); },
    returnFocus: () => document.querySelector('.screen .chrome-actions [aria-label="Adjustments"], .screen .draw-actions'),
  });
  open();
}
