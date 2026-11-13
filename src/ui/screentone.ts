import { findLayer, newLayer, TONE_SHAPES, type Pt, type ScreenTone } from '../doc/model';
import { groupAt, groupLabel, insertIndex } from '../geom/groups';
import { drawScreenTone } from '../render/tone';
import type { DeskCtx } from './desk';
import { h, seg, slider, toast } from './dom';
import { createMarquee, MARQUEE_SHAPES, marqueeShape, type MarqueeShape } from './marquee';

const PRESETS = [
  { name: 'Light dots', shape: 'dot', frequency: 60, density: 0.1, angle: 45 },
  { name: 'Mid dots', shape: 'dot', frequency: 60, density: 0.25, angle: 45 },
  { name: 'Deep dots', shape: 'dot', frequency: 60, density: 0.55, angle: 45 },
  { name: 'Retro dots', shape: 'dot', frequency: 24, density: 0.35, angle: 45 },
  { name: 'Hatching', shape: 'line', frequency: 24, density: 0.25, angle: 45 },
  { name: 'Crosshatch', shape: 'cross', frequency: 20, density: 0.35, angle: 45 },
] as const;
const SHAPE_NAMES: Record<ScreenTone['shape'], string> = { dot: 'Dots', square: 'Squares', diamond: 'Diamonds', line: 'Lines', cross: 'Crosshatch' };

export function screentoneTool(ctx: DeskCtx, select: (id: string) => void) {
  const { studio, page } = ctx;
  let placement: 'panel' | 'lasso' = 'panel';
  let start: Pt | null = null;
  let shape: MarqueeShape = 'freehand';
  const marquee = createMarquee(ctx, (region, at) => add(at, region));
  let draft: ScreenTone = { shape: 'dot', frequency: 60, density: 0.25, angle: 45, color: '#191a1f' };
  const active = (id: string) => findLayer(page, id);

  function add(at: Pt, region?: Pt[]): void {
    const panels = ctx.panels();
    const group = groupAt(page, panels, at);
    if (group.kind !== 'panel') { toast('Start inside the panel you want to tone.'); return; }
    if (group.locked || !group.visible) { toast(`${groupLabel(page, panels, group)} is ${group.locked ? 'locked' : 'hidden'}.`); return; }
    const layer = newLayer('tone');
    layer.name = SHAPE_NAMES[draft.shape] + ' tone';
    layer.screenTone = { ...draft, ...(region ? { region } : {}) };
    studio.editPage(page, 'Add screentone', ['groups'], (p) => {
      const g = p.groups.find((item) => item.id === group.id)!;
      g.layers.splice(insertIndex(g, 'tone'), 0, layer);
    });
    studio.markStage(page, 'draw', 1);
    select(layer.id);
  }

  function settings(id?: string): void {
    const entry = id ? active(id) : undefined;
    if (entry && (entry.group.locked || entry.layer.locked)) { toast('Unlock this tone layer to edit it.'); return; }
    const value = { ...(entry?.layer.screenTone ?? draft) };
    const preview = h('canvas', { width: 520, height: 155, class: 'tone-preview', 'aria-label': 'Screentone sample', role: 'img' });
    const options = h('div', { class: 'knobs' });
    const redraw = () => {
      const g = preview.getContext('2d')!;
      g.fillStyle = '#fffdf7';
      g.fillRect(0, 0, preview.width, preview.height);
      drawScreenTone(g, { ...value, region: undefined }, preview.width, preview.height, 300);
    };
    const update = () => {
      const shape = h('select', { 'aria-label': 'Pattern shape' }, TONE_SHAPES.map((id) => h('option', { value: id, selected: value.shape === id }, SHAPE_NAMES[id])));
      shape.addEventListener('change', () => { value.shape = shape.value as ScreenTone['shape']; redraw(); });
      const color = h('input', { type: 'color', value: value.color, 'aria-label': 'Tone color' });
      color.addEventListener('input', () => { value.color = color.value; redraw(); });
      options.replaceChildren(
        h('label', { class: 'mini' }, 'Shape', shape),
        slider('Density', 0, 100, 1, value.density * 100, (v) => `${v}%`, (v) => { value.density = v / 100; redraw(); }),
        slider('Frequency', 5, 120, 1, value.frequency, (v) => `${v} lpi`, (v) => { value.frequency = v; redraw(); }),
        slider('Angle', 0, 180, 1, value.angle, (v) => `${v}°`, (v) => { value.angle = v; redraw(); }),
        h('label', { class: 'mini' }, 'Ink color', color),
      );
      redraw();
    };
    const dialog = h('dialog', { class: 'tone-dialog', 'aria-label': entry ? 'Edit screentone' : 'Screentone settings' },
      h('header', {}, h('h2', {}, entry ? 'Edit screentone' : 'Screentone settings')),
      h('div', { class: 'content' }, preview,
        h('div', { class: 'tone-presets', role: 'group', 'aria-label': 'Screentone presets' }, PRESETS.map(({ name, ...preset }) =>
          h('button', { type: 'button', class: 'btn', onclick: () => { Object.assign(value, preset); update(); } }, name))), options),
      h('footer', {}, h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => {
          if (entry) studio.editPage(page, 'Edit screentone', ['groups'], (p) => {
            const layer = p.groups.find((item) => item.id === entry.group.id)?.layers.find((item) => item.id === entry.layer.id);
            if (layer) layer.screenTone = value;
          });
          else draft = value;
          dialog.close(); ctx.chrome(); ctx.request();
        } }, entry ? 'Apply' : 'Use tone')));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    update();
    dialog.showModal();
  }

  return {
    edit: settings,
    controls(id?: string) {
      return [
        seg<'panel' | 'lasso'>([{ id: 'panel', label: 'Panel' }, { id: 'lasso', label: 'Selection' }], placement, (v) => { placement = v; marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone area'),
        placement === 'lasso' ? seg([...MARQUEE_SHAPES], shape, (v) => { shape = marqueeShape(v); marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone selection shape') : null,
        ...marquee.controls(),
        h('button', { type: 'button', class: 'btn', onclick: () => settings() }, `${SHAPE_NAMES[draft.shape]} · ${Math.round(draft.density * 100)}% ▾`),
        id && active(id)?.layer.screenTone ? h('button', { type: 'button', class: 'btn', onclick: () => settings(id) }, 'Edit selected tone') : null,
        h('span', { class: 'hint' }, placement === 'panel' ? 'Tap inside a panel to add a tone layer.' : 'Draw around the area to shade.'),
      ];
    },
    clear: marquee.clear,
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    isMarquee: marquee.active,
    down(p: Pt) { if (placement === 'lasso') marquee.down(p, shape); else start = p; },
    move(p: Pt) { marquee.move(p); },
    up(p: Pt, cancelled: boolean) {
      if (placement === 'lasso') marquee.up(p, cancelled);
      else if (start && !cancelled && Math.hypot(p.x - start.x, p.y - start.y) * ctx.scale() < 12) add(p);
      start = null;
      ctx.request();
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      if (placement !== 'lasso' || !marquee.active()) return;
      g.save();
      g.strokeStyle = '#5eafc1'; g.lineWidth = 2; g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      g.restore();
    },
  };
}
