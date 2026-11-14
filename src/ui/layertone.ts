import type { Studio } from '../app/studio';
import { findLayer, TONE_SHAPES, type Page, type ToneScreen } from '../doc/model';
import { touchLayer, type PageArt } from '../draw/residency';
import { drawLayerBitmap } from '../render/page';
import { drawLayerAsTone } from '../render/tone';
import { h, slider, toast } from './dom';

/**
 * Show as tone: a painted layer's greys print as halftone dots of one ink (Clip Studio's layer
 * screentone). Non-destructive: the pixels stay as painted; Bake turns the dots into pixels.
 */
const SHAPE_NAMES: Record<ToneScreen['shape'], string> = { dot: 'Dots', square: 'Squares', diamond: 'Diamonds', line: 'Lines', cross: 'Crosshatch' };
export const DEFAULT_TONE_SCREEN: ToneScreen = { shape: 'dot', frequency: 60, angle: 45, color: '#191a1f' };
const PREVIEW_DPI = 200;

/** Where the layer has paint (inches), for a preview that shows it. */
function contentBox(c: HTMLCanvasElement, pageW: number): { x: number; y: number } | null {
  const step = Math.max(1, Math.round(c.width / 400));
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) {
    if (d[(y * c.width + x) * 4 + 3]! > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const k = pageW / c.width;
  return { x: ((x0 + x1) / 2) * k, y: ((y0 + y1) / 2) * k };
}

export function openLayerTone(studio: Studio, page: Page, art: PageArt, layerId: string, refresh: () => void): void {
  const found = findLayer(page, layerId);
  const plane = art.planes[layerId];
  if (!found || !plane?.width) { toast('Paint on this layer first, then show it as tone.'); return; }
  if (found.layer.locked || found.group.locked) { toast('Unlock this layer to change its tone.'); return; }
  const was = found.layer.asTone;
  const value: ToneScreen = { ...(was ?? DEFAULT_TONE_SCREEN) };
  const centre = contentBox(plane, page.widthIn) ?? { x: page.widthIn / 2, y: page.heightIn / 2 };
  const preview = h('canvas', { width: 520, height: 300, class: 'tone-preview', 'aria-label': 'This layer as tone, at print size', role: 'img' });
  const area = { x0: centre.x - 260 / PREVIEW_DPI, y0: centre.y - 150 / PREVIEW_DPI, x1: centre.x + 260 / PREVIEW_DPI, y1: centre.y + 150 / PREVIEW_DPI };
  const redraw = () => {
    const g = preview.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#fffdf7';
    g.fillRect(0, 0, preview.width, preview.height);
    g.translate(-area.x0 * PREVIEW_DPI, -area.y0 * PREVIEW_DPI);
    drawLayerAsTone(g, { ...found.layer, id: 'layer-tone-preview', asTone: value }, plane, `${art.revs[layerId] ?? 0}`, page.widthIn * PREVIEW_DPI, page.heightIn * PREVIEW_DPI, PREVIEW_DPI, found.layer.image, area, drawLayerBitmap);
  };
  const set = (label: string, next: ToneScreen | undefined) => {
    studio.editPage(page, label, ['groups'], (p) => {
      const l = findLayer(p, layerId)?.layer;
      if (!l) return;
      if (next) l.asTone = { ...next }; else delete l.asTone;
    });
    refresh();
  };
  const shape = h('select', { 'aria-label': 'Dot shape' }, TONE_SHAPES.map((id) => h('option', { value: id, selected: value.shape === id }, SHAPE_NAMES[id])));
  shape.addEventListener('change', () => { value.shape = shape.value as ToneScreen['shape']; redraw(); });
  const color = h('input', { type: 'color', value: value.color, 'aria-label': 'Ink colour' });
  color.addEventListener('input', () => { value.color = color.value; redraw(); });
  const dialog = h('dialog', { class: 'tone-dialog', 'aria-label': 'Show as tone' },
    h('header', {}, h('h2', {}, 'Show as tone'), h('p', { class: 'note' }, `${found.layer.name}: each dot carries the average grey of its cell, in one ink. Your painting stays as it is.`)),
    h('div', { class: 'content' }, preview, h('p', { class: 'note', style: 'margin:0' }, 'Preview at 200 dpi, centred on the paint. Exports screen at their own resolution.'),
      h('div', { class: 'knobs' },
        h('label', { class: 'mini' }, 'Shape', shape),
        slider('Frequency', 5, 120, 1, value.frequency, (v) => `${v} lpi`, (v) => { value.frequency = v; redraw(); }),
        slider('Angle', 0, 180, 1, value.angle, (v) => `${v}°`, (v) => { value.angle = v; redraw(); }),
        h('label', { class: 'mini' }, 'Ink colour', color))),
    h('footer', {},
      was ? h('button', { class: 'btn', type: 'button', onclick: () => { set('Show layer as painted', undefined); dialog.close(); } }, 'Show as painted') : null,
      h('span', { class: 'spacer', style: 'flex:1' }),
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { set(was ? 'Tone settings' : 'Show layer as tone', value); dialog.close(); } }, was ? 'Apply' : 'Show as tone')));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  redraw();
}

/** Turn the shown tone into the layer's pixels at the book's resolution (one undo step). */
export function bakeLayerTone(studio: Studio, page: Page, art: PageArt, layerId: string, refresh: () => void): void {
  const found = findLayer(page, layerId);
  const plane = art.planes[layerId];
  const tone = found?.layer.asTone;
  if (!found || !plane?.width || !tone) return;
  if (found.layer.image) { toast('A placed image keeps its own pixels. Bake works on painted layers.'); return; }
  const g = plane.getContext('2d', { willReadFrequently: true })!;
  const before = g.getImageData(0, 0, plane.width, plane.height);
  const dpi = Math.round(plane.width / page.widthIn);
  const out = document.createElement('canvas');
  out.width = plane.width; out.height = plane.height;
  const og = out.getContext('2d', { willReadFrequently: true })!;
  drawLayerAsTone(og, { ...found.layer, id: 'layer-tone-bake' }, plane, `${art.revs[layerId] ?? 0}`, plane.width, plane.height, dpi, undefined, undefined, drawLayerBitmap);
  const after = og.getImageData(0, 0, out.width, out.height);
  out.width = 0;
  const apply = (img: ImageData, withTone: boolean) => {
    g.putImageData(img, 0, 0);
    touchLayer(art, layerId);
    const l = findLayer(page, layerId)?.layer;
    if (l) { if (withTone) l.asTone = { ...tone }; else delete l.asTone; }
  };
  studio.run({ label: 'Bake tone to pixels', do: () => apply(after, false), undo: () => apply(before, true) });
  refresh();
  toast('The dots are now this layer’s pixels. Undo brings back the painting.', 3000);
}
