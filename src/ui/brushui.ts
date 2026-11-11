import type { Studio } from '../app/studio';
import { allBrushes, getUserBrushes, GROUP_LABEL, PASS_STYLE, type BrushEntry, type BrushGroup, type LinePass } from '../draw/brushes';
import { dabsForStroke } from '../engine/brush/dabs';
import { RasterEngine } from '../engine/brush/raster';
import { cloneBrush, dyn, type BrushSettings } from '../engine/core/brush';
import type { StrokePoint } from '../engine/core/stroke';
import { confirmDialog, h, toast } from './dom';
import { closePopover, popover } from './popover';

/**
 * Brush picker (a popover of preview strokes, grouped) and the Brush Studio (edit a brush's
 * settings with a live preview; save as one of "My brushes" on this device).
 */

const PREVIEW_W = 200;
const PREVIEW_H = 44;
const previews = new Map<string, string>();
let previewEngine: RasterEngine | null = null;

/** An S-curve with a pressure swell, as a real brush would draw it. */
function sampleStroke(w: number, hgt: number): StrokePoint[] {
  const n = 60;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { x: 12 + t * (w - 24), y: hgt / 2 + Math.sin(t * Math.PI * 2) * (hgt * 0.26), pressure: Math.sin(t * Math.PI) * 0.9 + 0.1, tiltX: 0, tiltY: 0, t: i * 8 };
  });
}

/** Paint a brush's sample stroke onto a canvas (cleared first). */
export function paintPreview(canvas: HTMLCanvasElement, settings: BrushSettings, pass: LinePass, widthIn: number): void {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!previewEngine) previewEngine = new RasterEngine(canvas.width, canvas.height);
  const eng = previewEngine;
  eng.resize(canvas.width, canvas.height);
  eng.bind(canvas);
  const brush = cloneBrush(settings);
  const full = widthIn * 300;
  const size = Math.max(2, Math.min(canvas.height * 0.4, full * 0.45));
  const k = size / Math.max(1, full);
  brush.size = size;
  brush.taperStart *= k * 3;
  brush.taperEnd *= k * 3;
  brush.opacity *= PASS_STYLE[pass].opacity;
  const points = sampleStroke(canvas.width, canvas.height);
  eng.begin({ id: 'preview', tool: 'brush', brush, color: PASS_STYLE[pass].color, seed: 7, points }, null);
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  eng.addDabs(dabsForStroke(brush, 7, points, len));
  eng.commit(true);
}

function previewUrl(e: BrushEntry): string {
  const key = `${e.id}|${JSON.stringify(e.settings).length}|${e.w}`;
  let url = previews.get(key);
  if (!url) {
    const c = h('canvas', { width: PREVIEW_W, height: PREVIEW_H });
    paintPreview(c, e.settings, e.pass, e.w);
    url = c.toDataURL();
    previews.set(key, url);
  }
  return url;
}

/**
 * The brush picker: every brush grouped, with a preview stroke each. Brushes of the tool's own
 * pass come first; the others are still offered (an ink brush on a pencil tool is allowed).
 */
export function brushPicker(anchor: HTMLElement, studio: Studio, pass: LinePass, current: string, onPick: (e: BrushEntry) => void): void {
  const groups = new Map<BrushGroup, BrushEntry[]>();
  for (const e of allBrushes()) {
    const list = groups.get(e.group) ?? [];
    list.push(e);
    groups.set(e.group, list);
  }
  const order: BrushGroup[] = pass === 'pencil' ? ['pencil', 'mine', 'ink', 'paint', 'texture', '2dope'] : ['ink', 'mine', 'paint', 'texture', 'pencil', '2dope'];
  const list = h('div', { class: 'brushlist' });
  for (const g of order) {
    const items = groups.get(g);
    if (!items?.length) continue;
    list.append(h('h4', {}, GROUP_LABEL[g]));
    for (const e of items) {
      list.append(h('button', {
        type: 'button', class: 'brushitem', 'aria-pressed': String(e.id === current), title: e.note,
        onclick: () => { closePopover(); onPick(e); },
      }, h('span', { class: 'bname' }, e.name, h('small', {}, e.note)), h('img', { src: previewUrl(e), alt: '', width: PREVIEW_W / 2, height: PREVIEW_H / 2 })));
    }
  }
  const cur = allBrushes().find((e) => e.id === current);
  popover(anchor, h('div', { style: 'width:300px' }, list,
    h('div', { class: 'sep' }),
    h('button', { type: 'button', class: 'item', onclick: () => { closePopover(); if (cur) brushStudio(studio, cur, onPick); } }, h('span', {}, '✎'), 'Edit in Brush Studio…')), 'below', 'Brushes');
}

// ---------------------------------------------------------------------------------------------
// Brush Studio

interface Knob {
  label: string;
  min: number;
  max: number;
  step: number;
  get: (b: BrushSettings) => number;
  set: (b: BrushSettings, v: number) => void;
  fmt?: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const SECTIONS: { title: string; knobs: Knob[] }[] = [
  { title: 'Stroke', knobs: [
    { label: 'Spacing', min: 0.02, max: 1, step: 0.01, get: (b) => b.spacing, set: (b, v) => (b.spacing = v), fmt: pct },
    { label: 'Flow', min: 0.05, max: 1, step: 0.01, get: (b) => b.flow, set: (b, v) => (b.flow = v), fmt: pct },
    { label: 'Opacity', min: 0.05, max: 1, step: 0.01, get: (b) => b.opacity, set: (b, v) => (b.opacity = v), fmt: pct },
    { label: 'Scatter', min: 0, max: 1, step: 0.01, get: (b) => b.scatter, set: (b, v) => (b.scatter = v), fmt: pct },
  ] },
  { title: 'Stabilize', knobs: [
    { label: 'Stabilize', min: 0, max: 1, step: 0.01, get: (b) => b.smoothing, set: (b, v) => (b.smoothing = v), fmt: pct },
  ] },
  { title: 'Taper', knobs: [
    { label: 'Start', min: 0, max: 200, step: 1, get: (b) => b.taperStart, set: (b, v) => (b.taperStart = v), fmt: (v) => `${v}px` },
    { label: 'End', min: 0, max: 200, step: 1, get: (b) => b.taperEnd, set: (b, v) => (b.taperEnd = v), fmt: (v) => `${v}px` },
    { label: 'Tip size', min: 0, max: 1, step: 0.01, get: (b) => b.taperSize ?? 1, set: (b, v) => (b.taperSize = v), fmt: pct },
    { label: 'Sharpness', min: 0, max: 1, step: 0.01, get: (b) => b.taperShape ?? 0, set: (b, v) => (b.taperShape = v), fmt: pct },
  ] },
  { title: 'Shape', knobs: [
    { label: 'Hardness', min: 0, max: 1, step: 0.01, get: (b) => b.hardness, set: (b, v) => (b.hardness = v), fmt: pct },
    { label: 'Roundness', min: 0.05, max: 1, step: 0.01, get: (b) => b.roundness, set: (b, v) => (b.roundness = v), fmt: pct },
    { label: 'Angle', min: 0, max: 180, step: 1, get: (b) => b.angle, set: (b, v) => (b.angle = v), fmt: (v) => `${v}°` },
  ] },
  { title: 'Grain', knobs: [
    { label: 'Grain', min: 0, max: 1, step: 0.01, get: (b) => b.grain, set: (b, v) => (b.grain = v), fmt: pct },
    { label: 'Scale', min: 0.2, max: 3, step: 0.05, get: (b) => b.grainScale, set: (b, v) => (b.grainScale = v), fmt: (v) => `${v.toFixed(2)}×` },
  ] },
  { title: 'Pressure', knobs: [
    { label: 'Size at light touch', min: 0, max: 1, step: 0.01, get: (b) => (b.sizeDyn.control === 'off' ? 1 : b.sizeDyn.min), set: (b, v) => (b.sizeDyn = v >= 1 ? dyn('off') : { ...b.sizeDyn, control: 'pressure', min: v }), fmt: pct },
    { label: 'Size response', min: 0.3, max: 2.5, step: 0.05, get: (b) => b.sizeDyn.curve, set: (b, v) => (b.sizeDyn = { ...b.sizeDyn, curve: v }), fmt: (v) => (v < 1 ? `soft ${v.toFixed(2)}` : v > 1 ? `firm ${v.toFixed(2)}` : 'linear') },
    { label: 'Opacity at light touch', min: 0, max: 1, step: 0.01, get: (b) => (b.opacityDyn.control === 'off' ? 1 : b.opacityDyn.min), set: (b, v) => (b.opacityDyn = v >= 1 ? dyn('off') : { ...b.opacityDyn, control: 'pressure', min: v }), fmt: pct },
  ] },
];

/**
 * Edit a brush. Library brushes are never changed: saving makes a copy in "My brushes". Strokes
 * already drawn keep their own snapshot, so editing never changes finished art.
 */
export function brushStudio(studio: Studio, start: BrushEntry, onPick: (e: BrushEntry) => void): void {
  const mine = start.group === 'mine';
  const draft: BrushEntry = { ...start, settings: cloneBrush(start.settings) };
  const big = h('canvas', { width: 520, height: 120, class: 'brushpad' });
  const redraw = () => paintPreview(big, draft.settings, draft.pass, draft.w);
  const name = h('input', { type: 'text', value: mine ? draft.name : `${draft.name} (mine)`, maxlength: 40, 'aria-label': 'Brush name' });
  const width = h('input', { type: 'range', min: 0.004, max: 0.2, step: 0.002, value: draft.w, 'aria-label': 'Default width' });
  const widthOut = h('b', {}, `${(draft.w * 72).toFixed(1)}pt`);
  width.addEventListener('input', () => {
    draft.w = Number(width.value);
    widthOut.textContent = `${(draft.w * 72).toFixed(1)}pt`;
    redraw();
  });
  const passSel = h('select', { 'aria-label': 'Colour' }, h('option', { value: 'ink', selected: draft.pass === 'ink' }, 'Ink black'), h('option', { value: 'pencil', selected: draft.pass === 'pencil' }, 'Pencil blue'));
  passSel.addEventListener('change', () => {
    draft.pass = passSel.value === 'pencil' ? 'pencil' : 'ink';
    redraw();
  });

  const knobRow = (k: Knob) => {
    const input = h('input', { type: 'range', min: k.min, max: k.max, step: k.step, value: k.get(draft.settings), 'aria-label': k.label });
    const out = h('b', {}, (k.fmt ?? String)(k.get(draft.settings)));
    input.addEventListener('input', () => {
      k.set(draft.settings, Number(input.value));
      out.textContent = (k.fmt ?? String)(Number(input.value));
      redraw();
    });
    return h('label', { class: 'knob' }, h('span', {}, k.label), input, out);
  };

  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Brush settings' });
  const panel = h('div', { class: 'knobs' });
  const show = (i: number) => {
    tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
    panel.replaceChildren(...SECTIONS[i]!.knobs.map(knobRow));
  };
  SECTIONS.forEach((s, i) => tabs.append(h('button', { type: 'button', role: 'tab', onclick: () => show(i) }, s.title)));

  const d = h('dialog', { class: 'brushstudio', 'aria-label': 'Brush Studio' },
    h('header', {}, h('h2', {}, 'Brush Studio'), h('p', { class: 'note', style: 'margin:4px 0 0' }, mine ? 'Changes apply to new strokes. Finished art keeps the brush it was drawn with.' : 'Library brushes stay as they are: saving makes a copy in My brushes.')),
    h('div', { class: 'content' },
      big,
      h('div', { class: 'row', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
        h('label', { class: 'field', style: 'flex:1' }, 'Name', name),
        h('label', { class: 'mini' }, 'Width', width, widthOut),
        h('label', { class: 'mini' }, 'Colour', passSel)),
      tabs, panel),
    h('footer', {},
      mine ? h('button', { class: 'btn danger', type: 'button', style: 'margin-right:auto', onclick: async () => {
        if (!(await confirmDialog('Delete this brush?', `“${draft.name}” is removed from My brushes on this device. Art already drawn with it is not changed.`, 'Delete'))) return;
        await studio.saveUserBrushes(getUserBrushes().filter((b) => b.id !== draft.id));
        d.close();
        toast('Brush deleted.');
      } }, 'Delete') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => { draft.settings = cloneBrush(start.settings); draft.w = start.w; width.value = String(draft.w); show(0); redraw(); } }, 'Reset'),
      h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const label = name.value.trim() || draft.name;
        const saved: BrushEntry = { ...draft, id: mine ? draft.id : `my-${Date.now().toString(36)}`, name: label, group: 'mine', note: mine ? draft.note : `From ${start.name}`, settings: { ...draft.settings, name: label } };
        const list = getUserBrushes().filter((b) => b.id !== saved.id);
        await studio.saveUserBrushes([...list, saved]);
        d.close();
        onPick(saved);
        toast(`Saved “${label}” to My brushes.`);
      } }, mine ? 'Save' : 'Save as my brush')),
  );
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  show(0);
  redraw();
}
