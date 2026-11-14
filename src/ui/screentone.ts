import { findLayer, newLayer, TONE_SHAPES, type Pt, type ScreenTone, type ToneGradient } from '../doc/model';
import { invert } from '../engine/core/selxform';
import { mapPanelPoint } from '../geom/carve';
import { groupAt, groupLabel, insertIndex, panelForGroup } from '../geom/groups';
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
type Stops = ToneGradient['stops'];
/** Gradient stacks: positions 0–1 along the drag, tone 0–1. */
const GRADIENTS: { name: string; kind: ToneGradient['kind']; stops: Stops }[] = [
  { name: 'Fade out', kind: 'linear', stops: [{ at: 0, density: 0.6 }, { at: 1, density: 0 }] },
  { name: 'Fade in', kind: 'linear', stops: [{ at: 0, density: 0 }, { at: 1, density: 0.6 }] },
  { name: 'Sky', kind: 'linear', stops: [{ at: 0, density: 0.5 }, { at: 0.55, density: 0.15 }, { at: 1, density: 0 }] },
  { name: 'Band', kind: 'linear', stops: [{ at: 0, density: 0 }, { at: 0.5, density: 0.5 }, { at: 1, density: 0 }] },
  { name: 'Spotlight', kind: 'radial', stops: [{ at: 0, density: 0 }, { at: 0.45, density: 0.1 }, { at: 1, density: 0.7 }] },
  { name: 'Glow', kind: 'radial', stops: [{ at: 0, density: 0.7 }, { at: 1, density: 0 }] },
];
const SHAPE_NAMES: Record<ScreenTone['shape'], string> = { dot: 'Dots', square: 'Squares', diamond: 'Diamonds', line: 'Lines', cross: 'Crosshatch' };

export function screentoneTool(ctx: DeskCtx, select: (id: string) => void, selected: () => string | null = () => null) {
  const { studio, page } = ctx;
  let placement: 'panel' | 'lasso' = 'panel';
  let fill: 'flat' | 'gradient' = 'flat';
  let start: Pt | null = null;
  let dragTo: Pt | null = null;
  let shape: MarqueeShape = 'freehand';
  const marquee = createMarquee(ctx, (region, at) => add(at, region));
  let draft: ScreenTone = { shape: 'dot', frequency: 60, density: 0.25, angle: 45, color: '#191a1f' };
  let draftGradient: { kind: ToneGradient['kind']; stops: Stops } = { kind: 'linear', stops: GRADIENTS[0]!.stops.map((s) => ({ ...s })) };
  const active = (id: string) => findLayer(page, id);

  function add(at: Pt, region?: Pt[], gradient?: { from: Pt; to: Pt }): void {
    const panels = ctx.panels();
    const group = groupAt(page, panels, at);
    if (group.kind !== 'panel') { toast('Start inside the panel you want to tone.'); return; }
    if (group.locked || !group.visible) { toast(`${groupLabel(page, panels, group)} is ${group.locked ? 'locked' : 'hidden'}.`); return; }
    const layer = newLayer('tone');
    const matrix = panelForGroup(panels, group)?.transform?.matrix;
    const inverse = matrix ? invert(matrix) : null;
    const inPanel = (p: Pt) => mapPanelPoint(p, inverse);
    layer.name = SHAPE_NAMES[draft.shape] + (gradient ? ' gradient' : ' tone');
    layer.screenTone = {
      ...draft,
      ...(region ? { region: region.map(inPanel) } : {}),
      ...(gradient ? { gradient: { kind: draftGradient.kind, from: inPanel(gradient.from), to: inPanel(gradient.to), stops: draftGradient.stops.map((s) => ({ ...s })) } } : {}),
    };
    studio.editPage(page, gradient ? 'Add gradient tone' : 'Add screentone', ['groups'], (p) => {
      const g = p.groups.find((item) => item.id === group.id)!;
      g.layers.splice(insertIndex(g, 'tone'), 0, layer);
    });
    studio.markStage(page, 'draw', 1);
    select(layer.id);
  }

  /** Drag on a selected gradient tone in its own panel: aim it again. True when it did. */
  function reaim(from: Pt, to: Pt): boolean {
    const id = selected();
    const entry = id ? active(id) : null;
    const g = entry?.layer.screenTone?.gradient;
    if (!entry || !g || entry.layer.locked || entry.group.locked) return false;
    const panels = ctx.panels();
    if (groupAt(page, panels, from).id !== entry.group.id) return false;
    const matrix = panelForGroup(panels, entry.group)?.transform?.matrix;
    const inverse = matrix ? invert(matrix) : null;
    studio.editPage(page, 'Aim gradient tone', ['groups'], (p) => {
      const layer = p.groups.find((x) => x.id === entry.group.id)?.layers.find((x) => x.id === entry.layer.id);
      if (layer?.screenTone?.gradient) layer.screenTone = { ...layer.screenTone, gradient: { ...layer.screenTone.gradient, from: mapPanelPoint(from, inverse), to: mapPanelPoint(to, inverse) } };
    });
    return true;
  }

  function settings(id?: string): void {
    const entry = id ? active(id) : undefined;
    if (entry && (entry.group.locked || entry.layer.locked)) { toast('Unlock this tone layer to edit it.'); return; }
    const value: ScreenTone = structuredClone(entry?.layer.screenTone ?? draft);
    // a gradient being set up (new) or edited
    let grad: { kind: ToneGradient['kind']; stops: Stops } | null = entry ? (value.gradient ? { kind: value.gradient.kind, stops: value.gradient.stops } : null) : (fill === 'gradient' ? structuredClone(draftGradient) : null);
    const preview = h('canvas', { width: 520, height: 155, class: 'tone-preview', 'aria-label': 'Screentone sample', role: 'img' });
    const options = h('div', { class: 'knobs' });
    const stopsBox = h('div', { class: 'tone-stops' });
    const redraw = () => {
      const g = preview.getContext('2d')!;
      g.fillStyle = '#fffdf7';
      g.fillRect(0, 0, preview.width, preview.height);
      const sample: ScreenTone = { ...value, region: undefined };
      if (grad) sample.gradient = grad.kind === 'radial'
        ? { kind: 'radial', from: { x: 260 / 300, y: 77 / 300 }, to: { x: 520 / 300, y: 77 / 300 }, stops: grad.stops }
        : { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 520 / 300, y: 0 }, stops: grad.stops };
      else delete sample.gradient;
      drawScreenTone(g, sample, preview.width, preview.height, 300, undefined, 'tone-preview');
    };
    const paintStops = () => {
      if (!grad) { stopsBox.replaceChildren(); return; }
      const sorted = grad.stops.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at);
      stopsBox.replaceChildren(
        h('div', { class: 'tone-stops-head' }, h('b', {}, 'Stops'),
          seg<ToneGradient['kind']>([{ id: 'linear', label: 'Linear' }, { id: 'radial', label: 'Radial' }], grad.kind, (k) => { grad!.kind = k; paintStops(); redraw(); }, 'Gradient kind'),
          h('button', { class: 'btn', type: 'button', disabled: grad.stops.length >= 16, onclick: () => {
            // a new stop halfway along the widest gap, at the tone already there
            const s = [...grad!.stops].sort((a, b) => a.at - b.at);
            let at = 0.5, best = -1;
            for (let i = 1; i < s.length; i++) if (s[i]!.at - s[i - 1]!.at > best) { best = s[i]!.at - s[i - 1]!.at; at = (s[i]!.at + s[i - 1]!.at) / 2; }
            const left = s.filter((x) => x.at <= at).at(-1) ?? s[0]!, right = s.find((x) => x.at >= at) ?? s.at(-1)!;
            grad!.stops.push({ at, density: (left.density + right.density) / 2 });
            paintStops(); redraw();
          } }, '+ Stop')),
        ...sorted.map(({ s, i }) => h('div', { class: 'tone-stop' },
          slider('Where', 0, 100, 1, Math.round(s.at * 100), (v) => `${v}%`, (v) => { s.at = v / 100; redraw(); }, () => paintStops()),
          slider('Tone', 0, 100, 1, Math.round(s.density * 100), (v) => `${v}%`, (v) => { s.density = v / 100; redraw(); }),
          h('button', { class: 'btn icon-only', type: 'button', 'aria-label': `Remove stop ${i + 1}`, disabled: grad!.stops.length <= 2, onclick: () => { grad!.stops.splice(i, 1); paintStops(); redraw(); } }, '✕'))),
        h('div', { class: 'tone-presets', role: 'group', 'aria-label': 'Gradient presets' }, GRADIENTS.map((p) =>
          h('button', { type: 'button', class: 'btn', onclick: () => { grad = { kind: p.kind, stops: p.stops.map((x) => ({ ...x })) }; paintStops(); redraw(); } }, p.name))));
    };
    const update = () => {
      const shapeSel = h('select', { 'aria-label': 'Pattern shape' }, TONE_SHAPES.map((sid) => h('option', { value: sid, selected: value.shape === sid }, SHAPE_NAMES[sid])));
      shapeSel.addEventListener('change', () => { value.shape = shapeSel.value as ScreenTone['shape']; redraw(); });
      const color = h('input', { type: 'color', value: value.color, 'aria-label': 'Tone color' });
      color.addEventListener('input', () => { value.color = color.value; redraw(); });
      options.replaceChildren(...[
        h('label', { class: 'mini' }, 'Shape', shapeSel),
        grad ? null : slider('Density', 0, 100, 1, value.density * 100, (v) => `${v}%`, (v) => { value.density = v / 100; redraw(); }),
        slider('Frequency', 5, 120, 1, value.frequency, (v) => `${v} lpi`, (v) => { value.frequency = v; redraw(); }),
        slider('Angle', 0, 180, 1, value.angle, (v) => `${v}°`, (v) => { value.angle = v; redraw(); }),
        h('label', { class: 'mini' }, 'Ink color', color),
      ].filter((x): x is HTMLElement => x !== null));
      paintStops();
      redraw();
    };
    const dialog = h('dialog', { class: 'tone-dialog', 'aria-label': entry ? 'Edit screentone' : 'Screentone settings' },
      h('header', {}, h('h2', {}, entry ? (grad ? 'Edit gradient tone' : 'Edit screentone') : grad ? 'Gradient tone settings' : 'Screentone settings')),
      h('div', { class: 'content' }, preview,
        grad ? null : h('div', { class: 'tone-presets', role: 'group', 'aria-label': 'Screentone presets' }, PRESETS.map(({ name, ...preset }) =>
          h('button', { type: 'button', class: 'btn', onclick: () => { Object.assign(value, preset); update(); } }, name))),
        options, stopsBox),
      h('footer', {}, h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => {
          if (entry) studio.editPage(page, grad ? 'Edit gradient tone' : 'Edit screentone', ['groups'], (p) => {
            const layer = p.groups.find((item) => item.id === entry.group.id)?.layers.find((item) => item.id === entry.layer.id);
            if (!layer) return;
            const next: ScreenTone = { ...value };
            if (grad && value.gradient) next.gradient = { ...value.gradient, kind: grad.kind, stops: grad.stops.map((s) => ({ ...s })) };
            layer.screenTone = next;
          });
          else {
            const { gradient: _g, ...flat } = value;
            draft = flat;
            if (grad) draftGradient = { kind: grad.kind, stops: grad.stops.map((s) => ({ ...s })) };
          }
          dialog.close(); ctx.chrome(); ctx.request();
        } }, entry ? 'Apply' : 'Use tone')));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    update();
    dialog.showModal();
  }

  const gradientLabel = () => {
    const g = GRADIENTS.find((p) => p.kind === draftGradient.kind && JSON.stringify(p.stops) === JSON.stringify(draftGradient.stops));
    return g?.name ?? `${draftGradient.kind === 'radial' ? 'Radial' : 'Linear'} · ${draftGradient.stops.length} stops`;
  };

  return {
    edit: settings,
    controls(id?: string) {
      const sel = id ? active(id)?.layer.screenTone : undefined;
      return [
        seg<'flat' | 'gradient'>([{ id: 'flat', label: 'Flat' }, { id: 'gradient', label: 'Gradient' }], fill, (v) => { fill = v; if (v === 'gradient') placement = 'panel'; marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone fill'),
        fill === 'flat' ? seg<'panel' | 'lasso'>([{ id: 'panel', label: 'Panel' }, { id: 'lasso', label: 'Selection' }], placement, (v) => { placement = v; marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone area') : null,
        fill === 'flat' && placement === 'lasso' ? seg([...MARQUEE_SHAPES], shape, (v) => { shape = marqueeShape(v); marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone selection shape') : null,
        ...(fill === 'flat' ? marquee.controls() : []),
        h('button', { type: 'button', class: 'btn', onclick: () => settings() }, `${SHAPE_NAMES[draft.shape]} · ${fill === 'gradient' ? gradientLabel() : Math.round(draft.density * 100) + '%'} ▾`),
        sel ? h('button', { type: 'button', class: 'btn', onclick: () => settings(id) }, sel.gradient ? 'Edit selected gradient' : 'Edit selected tone') : null,
        h('span', { class: 'hint' }, fill === 'gradient'
          ? (sel?.gradient ? 'Drag in its panel to aim the selected gradient again, or in another panel for a new one.' : 'Drag across a panel: the gradient runs from where you start to where you let go.')
          : placement === 'panel' ? 'Tap inside a panel to add a tone layer.' : 'Draw around the area to shade.'),
      ];
    },
    clear: marquee.clear,
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    isMarquee: marquee.active,
    down(p: Pt) { if (fill === 'flat' && placement === 'lasso') marquee.down(p, shape); else { start = p; dragTo = null; } },
    move(p: Pt) { if (fill === 'gradient' && start) { dragTo = p; ctx.request(); } else marquee.move(p); },
    up(p: Pt, cancelled: boolean) {
      if (fill === 'flat' && placement === 'lasso') marquee.up(p, cancelled);
      else if (start && !cancelled) {
        const far = Math.hypot(p.x - start.x, p.y - start.y) * ctx.scale();
        if (fill === 'gradient') {
          if (far < 12) toast('Drag across the panel to set the gradient’s direction.');
          else if (!reaim(start, p)) add(start, undefined, { from: start, to: p });
        } else if (far < 12) add(p);
      }
      start = null;
      dragTo = null;
      ctx.request();
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      if (fill === 'gradient' && start && dragTo) {
        // the gradient's direction while dragging: a line with its ends
        g.save();
        g.strokeStyle = '#2F6F7E'; g.fillStyle = '#FFFDF7'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(start.x * scale, start.y * scale); g.lineTo(dragTo.x * scale, dragTo.y * scale); g.stroke();
        if (draftGradient.kind === 'radial') { g.setLineDash([5, 4]); g.beginPath(); g.arc(start.x * scale, start.y * scale, Math.hypot(dragTo.x - start.x, dragTo.y - start.y) * scale, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
        for (const q of [start, dragTo]) { g.beginPath(); g.arc(q.x * scale, q.y * scale, 6, 0, Math.PI * 2); g.fill(); g.stroke(); }
        g.restore();
        return;
      }
      if (placement !== 'lasso' || !marquee.active()) return;
      g.save();
      g.strokeStyle = '#5eafc1'; g.lineWidth = 2; g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      g.restore();
    },
  };
}
