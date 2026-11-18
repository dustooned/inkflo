import { findLayer, MAX_TONES_PER_LAYER, newLayer, setTones, TONE_SHAPES, tonesOf, type Layer, type LayerGroup, type Pt, type ScreenTone, type ToneGradient } from '../doc/model';
import { invert } from '../engine/core/selxform';
import { mapPanelPoint } from '../geom/carve';
import { groupAt, groupLabel, insertIndex, panelForGroup } from '../geom/groups';
import { shadeOf } from '../geom/tonecolour';
import { drawScreenTone } from '../render/tone';
import type { DeskCtx } from './desk';
import { h, seg, slider, toast } from './dom';
import { icon } from './icons';
import { openModal } from './modal';
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

/** What the Bucket asks the desk for: the closed line area around a tap, as an outline in page inches. */
export interface BucketQuery {
  /** The tap, in the panel's own (untransformed) space. */
  at: Pt;
  group: LayerGroup;
  gap: number;
  grow: number;
  threshold: number;
  referAll: boolean;
}
export type BucketResult = { region: Pt[] } | { problem: string };

/** What the Tone tool asks the desk for. All optional: a missing one hides its control. */
export interface ToneHooks {
  /** Bucket, Lines source: the closed line area around a tap. */
  bucket?: (q: BucketQuery) => BucketResult;
  /** Bucket, Fill source: the painted flat around a tap (`at` in the panel's own space). */
  fillArea?: (q: { at: Pt; group: LayerGroup }) => BucketResult;
  /** The colour of the flat fill under a point, in page inches. */
  fillColourAt?: (at: Pt) => string | null;
  /** The colour showing on the page at a point (for the eyedropper). */
  pageColourAt?: (at: Pt) => string | null;
}

export function screentoneTool(ctx: DeskCtx, select: (id: string) => void, selected: () => string | null = () => null, hooks: ToneHooks = {}) {
  const bucketAt = hooks.bucket;
  const { studio, page } = ctx;
  let placement: 'panel' | 'lasso' | 'bucket' = 'panel';
  /** Bucket settings: close gaps up to `gap` inches, spread `grow` inches under the lines. */
  const bucket = { gap: 0.02, grow: 0.004, referAll: false, source: 'lines' as 'lines' | 'fill' };
  /** Dots take a shade of the flat fill under the tap (instead of the colour swatch). */
  let matchFill = false;
  let picking = false;
  let fill: 'flat' | 'gradient' = 'flat';
  let start: Pt | null = null;
  let dragTo: Pt | null = null;
  let shape: MarqueeShape = 'freehand';
  const marquee = createMarquee(ctx, (region, at) => add(at, region));
  let draft: ScreenTone = { shape: 'dot', frequency: 60, density: 0.25, angle: 45, color: '#191a1f' };
  let draftGradient: { kind: ToneGradient['kind']; stops: Stops } = { kind: 'linear', stops: GRADIENTS[0]!.stops.map((s) => ({ ...s })) };
  const active = (id: string) => findLayer(page, id);
  /** The next tone starts a layer of its own (the "New tone layer" button); cleared once used. */
  let startNew = false;
  /** Which area of the selected tone layer Edit and Re-aim act on (the newest by default). */
  let picked = { layer: '', index: -1 };
  const areaOf = (layer: Layer): number => {
    const n = tonesOf(layer).length;
    return picked.layer === layer.id && picked.index >= 0 && picked.index < n ? picked.index : n - 1;
  };
  const describe = (t: ScreenTone, i: number) => `${i + 1} · ${SHAPE_NAMES[t.shape]}${t.gradient ? ' gradient' : ' ' + Math.round(t.density * 100) + '%'}${t.region ? ' (selection)' : ''}`;

  function add(at: Pt, region?: Pt[], gradient?: { from: Pt; to: Pt }, viaBucket = false): void {
    const panels = ctx.panels();
    const group = groupAt(page, panels, at);
    if (group.kind !== 'panel') { toast('Start inside the panel you want to tone.'); return; }
    if (group.locked || !group.visible) { toast(`${groupLabel(page, panels, group)} is ${group.locked ? 'locked' : 'hidden'}.`); return; }
    const matrix = panelForGroup(panels, group)?.transform?.matrix;
    const inverse = matrix ? invert(matrix) : null;
    const inPanel = (p: Pt) => mapPanelPoint(p, inverse);
    let stored: Pt[] | undefined = region?.map(inPanel);
    if (viaBucket) {
      const found = bucket.source === 'fill' ? hooks.fillArea?.({ at: inPanel(at), group }) : bucketAt?.({ at: inPanel(at), group, gap: bucket.gap, grow: bucket.grow, threshold: 24, referAll: bucket.referAll });
      if (!found) { toast('The bucket is not available here.'); return; }
      if ('problem' in found) { toast(found.problem); return; }
      stored = found.region; // already in the panel's own space
    }
    const shaded = matchFill ? hooks.fillColourAt?.(at) : null;
    const tone: ScreenTone = {
      ...draft,
      ...(shaded ? { color: shadeOf(shaded) } : {}),
      ...(stored ? { region: stored } : {}),
      ...(gradient ? { gradient: { kind: draftGradient.kind, from: inPanel(gradient.from), to: inPanel(gradient.to), stops: draftGradient.stops.map((s) => ({ ...s })) } } : {}),
    };
    // One tone layer per panel: use the selected tone layer if it is in this panel, else the panel's
    // existing one. "New tone layer" (startNew) makes a separate one on purpose.
    const usable = (l: Layer) => !!l.screenTone && l.visible && !l.locked && tonesOf(l).length < MAX_TONES_PER_LAYER;
    const selId = selected();
    const sel = selId ? active(selId) : null;
    const target = startNew ? undefined : sel && sel.group.id === group.id && usable(sel.layer) ? sel.layer : group.layers.find(usable);
    startNew = false;
    const label = gradient ? 'Add gradient tone' : viaBucket ? 'Bucket screentone' : 'Add screentone';
    if (target) {
      const id = target.id;
      const at = tonesOf(target).length;
      studio.editPage(page, label, ['groups'], (p) => {
        const l = p.groups.find((item) => item.id === group.id)?.layers.find((item) => item.id === id);
        if (l) setTones(l, [...tonesOf(l), tone]);
      });
      picked = { layer: id, index: at };
      studio.markStage(page, 'draw', 1);
      select(id);
      toast(`Added to “${target.name}”. Use New tone layer for a separate one.`);
      return;
    }
    const layer = newLayer('tone');
    layer.name = 'Screentone';
    layer.screenTone = tone;
    studio.editPage(page, gradient ? 'Add gradient tone' : 'Add screentone', ['groups'], (p) => {
      const g = p.groups.find((item) => item.id === group.id)!;
      g.layers.splice(insertIndex(g, 'tone'), 0, layer);
    });
    picked = { layer: layer.id, index: 0 };
    studio.markStage(page, 'draw', 1);
    select(layer.id);
  }

  function removeArea(layer: Layer, index: number): void {
    if (layer.locked) { toast('Unlock this tone layer to edit it.'); return; }
    const id = layer.id;
    studio.editPage(page, 'Remove tone area', ['groups'], (p) => {
      const l = findLayer(p, id)?.layer;
      if (!l) return;
      const list = tonesOf(l);
      list.splice(index, 1);
      setTones(l, list);
    });
    picked = { layer: id, index: -1 };
    ctx.chrome(); ctx.request();
  }

  /** Drag on a selected gradient tone in its own panel: aim it again. True when it did. */
  function reaim(from: Pt, to: Pt): boolean {
    const id = selected();
    const entry = id ? active(id) : null;
    const ai = entry ? areaOf(entry.layer) : -1;
    const g = entry ? tonesOf(entry.layer)[ai]?.gradient : undefined;
    if (!entry || !g || entry.layer.locked || entry.group.locked) return false;
    const panels = ctx.panels();
    if (groupAt(page, panels, from).id !== entry.group.id) return false;
    const matrix = panelForGroup(panels, entry.group)?.transform?.matrix;
    const inverse = matrix ? invert(matrix) : null;
    studio.editPage(page, 'Aim gradient tone', ['groups'], (p) => {
      const layer = p.groups.find((x) => x.id === entry.group.id)?.layers.find((x) => x.id === entry.layer.id);
      const list = layer ? tonesOf(layer) : [];
      const cur = list[ai];
      if (layer && cur?.gradient) { list[ai] = { ...cur, gradient: { ...cur.gradient, from: mapPanelPoint(from, inverse), to: mapPanelPoint(to, inverse) } }; setTones(layer, list); }
    });
    return true;
  }

  function settings(id?: string, index?: number): void {
    const entry = id ? active(id) : undefined;
    if (entry && (entry.group.locked || entry.layer.locked)) { toast('Unlock this tone layer to edit it.'); return; }
    const areaIndex = entry ? index ?? areaOf(entry.layer) : -1;
    const value: ScreenTone = structuredClone((entry ? tonesOf(entry.layer)[areaIndex] : undefined) ?? draft);
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
    openModal<'cancel' | 'apply'>({
      title: entry ? (grad ? 'Edit gradient tone' : 'Edit screentone') : grad ? 'Gradient tone settings' : 'Screentone settings',
      className: 'tone-dialog', ariaLabel: entry ? 'Edit screentone' : 'Screentone settings',
      content: [preview,
        ...(grad ? [] : [h('div', { class: 'tone-presets', role: 'group', 'aria-label': 'Screentone presets' }, PRESETS.map(({ name, ...preset }) =>
          h('button', { type: 'button', class: 'btn', onclick: () => { Object.assign(value, preset); update(); } }, name)))]),
        options, stopsBox],
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'apply', label: entry ? 'Apply' : 'Use tone', primary: true, run: () => {
        if (entry) studio.editPage(page, grad ? 'Edit gradient tone' : 'Edit screentone', ['groups'], (p) => {
          const layer = p.groups.find((item) => item.id === entry.group.id)?.layers.find((item) => item.id === entry.layer.id);
          if (!layer) return;
          const next: ScreenTone = { ...value };
          if (grad && value.gradient) next.gradient = { ...value.gradient, kind: grad.kind, stops: grad.stops.map((s) => ({ ...s })) };
          const list = tonesOf(layer);
          list[areaIndex] = next;
          setTones(layer, list);
        });
        else {
          const { gradient: _g, ...flat } = value;
          draft = flat;
          if (grad) draftGradient = { kind: grad.kind, stops: grad.stops.map((s) => ({ ...s })) };
        }
      } }],
      onClose: (id) => { if (id === 'apply') { ctx.chrome(); ctx.request(); } },
    });
    update();
  }

  /** The colour swatch: the colour the next tone gets (Match fill overrides it). */
  function colourSwatch(): HTMLElement {
    const input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#191a1f', 'aria-label': 'Tone colour', title: matchFill ? 'Match fill is on: dots take the fill shade' : 'Tone colour' });
    input.addEventListener('input', () => { draft = { ...draft, color: input.value }; });
    return h('label', { class: 'mini' }, 'Colour', input);
  }

  /** Switches for the selected tone layer: recolour, blend and clip to fills. */
  function layerOptions(layer: Layer | undefined): (HTMLElement | null)[] {
    if (!layer || !layer.screenTone) return [];
    const id = layer.id;
    const change = (label: string, fn: (l: Layer) => void) => {
      if (layer.locked) { toast('Unlock this tone layer to edit it.'); return; }
      studio.editPage(page, label, ['groups'], (p) => { const l = findLayer(p, id)?.layer; if (l) fn(l); });
      ctx.chrome(); ctx.request();
    };
    return [
      h('button', { type: 'button', class: 'btn', title: 'Give every area in this tone layer the colour in the swatch', onclick: () => change('Recolour tone layer', (l) => setTones(l, tonesOf(l).map((t) => ({ ...t, color: draft.color })))) }, 'Recolour layer'),
      h('button', { type: 'button', class: 'btn', 'aria-pressed': String(layer.blend === 'multiply'), title: 'Multiply lets the dots shade the colour beneath instead of covering it', onclick: () => change('Tone blend', (l) => { if (l.blend === 'multiply') delete l.blend; else l.blend = 'multiply'; }) }, layer.blend === 'multiply' ? 'Blend: Multiply ✓' : 'Blend: Normal'),
      h('button', { type: 'button', class: 'btn', 'aria-pressed': String(!!layer.clipToFill), title: 'Show this tone only where the colour layers have paint', onclick: () => change('Clip tone to fills', (l) => { if (l.clipToFill) delete l.clipToFill; else l.clipToFill = true; }) }, icon('toneClip', 16), layer.clipToFill ? 'Clipped to fills ✓' : 'Clip to fills'),
    ];
  }

  const gradientLabel = () => {
    const g = GRADIENTS.find((p) => p.kind === draftGradient.kind && JSON.stringify(p.stops) === JSON.stringify(draftGradient.stops));
    return g?.name ?? `${draftGradient.kind === 'radial' ? 'Radial' : 'Linear'} · ${draftGradient.stops.length} stops`;
  };

  return {
    edit: settings,
    controls(id?: string) {
      const selLayer = id ? active(id)?.layer : undefined;
      const areas = selLayer ? tonesOf(selLayer) : [];
      const ai = selLayer ? areaOf(selLayer) : -1;
      const sel = areas[ai];
      const areaSel = selLayer && areas.length > 1 ? h('select', { 'aria-label': 'Tone area in this layer' }, areas.map((t, i) => h('option', { value: String(i), selected: i === ai }, describe(t, i)))) : null;
      areaSel?.addEventListener('change', () => { picked = { layer: selLayer!.id, index: Number(areaSel.value) }; ctx.chrome(); });
      return [
        seg<'flat' | 'gradient'>([{ id: 'flat', label: 'Flat', icon: 'toneFlat', hint: 'One even tone' }, { id: 'gradient', label: 'Gradient', icon: 'toneGradient', hint: 'Tone that fades across a panel' }], fill, (v) => { fill = v; if (v === 'gradient') placement = 'panel'; marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone fill'),
        fill === 'flat' ? seg<'panel' | 'lasso' | 'bucket'>([
          { id: 'panel', label: 'Panel', icon: 'tonePanel', hint: 'Tap a panel to tone all of it' },
          { id: 'lasso', label: 'Selection', icon: 'toneLasso', hint: 'Draw around the area to tone' },
          ...(bucketAt ? [{ id: 'bucket' as const, label: 'Bucket', icon: 'toneBucket' as const, hint: 'Tap inside lines to tone that closed area' }] : []),
        ], placement, (v) => { placement = v; marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone area') : null,
        fill === 'flat' && placement === 'bucket' && hooks.fillArea ? seg<'lines' | 'fill'>([
          { id: 'lines', label: 'Lines', icon: 'toneBucket', hint: 'Tone the closed area between ink lines' },
          { id: 'fill', label: 'Fill', icon: 'toneFill', hint: 'Tone exactly the painted flat you tap' },
        ], bucket.source, (v) => { bucket.source = v; ctx.chrome(); }, 'Bucket source') : null,
        fill === 'flat' && placement === 'bucket' && bucket.source === 'lines' ? h('span', { title: 'Treat breaks in your lines up to this size as closed, so the tone does not leak.' }, slider('Close gaps', 0, 0.08, 0.005, bucket.gap, (v) => `${(v * 72).toFixed(1)}pt`, (v) => { bucket.gap = v; })) : null,
        fill === 'flat' && placement === 'bucket' && bucket.source === 'lines' ? h('span', { title: 'Spread the tone under your lines so no white edge shows.' }, slider('Under lines', 0, 0.02, 0.001, bucket.grow, (v) => `${(v * 72).toFixed(1)}pt`, (v) => { bucket.grow = v; })) : null,
        fill === 'flat' && placement === 'bucket' && bucket.source === 'lines' ? seg([{ id: 'refs', label: 'Reference lines' }, { id: 'all', label: 'All visible' }], bucket.referAll ? 'all' : 'refs', (v) => { bucket.referAll = v === 'all'; ctx.chrome(); }, 'Bucket walls') : null,
        fill === 'flat' && placement === 'lasso' ? seg([...MARQUEE_SHAPES], shape, (v) => { shape = marqueeShape(v); marquee.clear(); ctx.chrome(); ctx.request(); }, 'Tone selection shape') : null,
        ...(fill === 'flat' ? marquee.controls() : []),
        h('button', { type: 'button', class: 'btn', onclick: () => settings() }, `${SHAPE_NAMES[draft.shape]} · ${fill === 'gradient' ? gradientLabel() : Math.round(draft.density * 100) + '%'} ▾`),
        colourSwatch(),
        hooks.pageColourAt ? h('button', { type: 'button', class: 'btn', 'aria-pressed': String(picking), title: 'Tap the page to use the colour you tap as the tone colour', onclick: () => { picking = !picking; ctx.chrome(); } }, icon('eyedropper', 16), picking ? 'Tap the page' : 'Eyedropper') : null,
        hooks.fillColourAt ? h('button', { type: 'button', class: 'btn', 'aria-pressed': String(matchFill), title: 'Dots take a deeper shade of the flat fill under the tap, so a shadow on red stays red', onclick: () => { matchFill = !matchFill; ctx.chrome(); } }, icon('palette', 16), matchFill ? 'Match fill ✓' : 'Match fill') : null,
        ...layerOptions(selLayer),
        h('button', { type: 'button', class: 'btn', 'aria-pressed': String(startNew), title: 'By default new tone goes into the panel’s tone layer. Press this to start a separate layer for the next tone.', onclick: () => { startNew = !startNew; ctx.chrome(); } }, startNew ? 'Next tone: new layer ✓' : 'New tone layer'),
        areaSel,
        sel ? h('button', { type: 'button', class: 'btn', onclick: () => settings(id, ai) }, sel.gradient ? 'Edit selected gradient' : 'Edit selected tone') : null,
        selLayer && areas.length > 1 ? h('button', { type: 'button', class: 'btn', onclick: () => removeArea(selLayer, ai) }, 'Remove this area') : null,
        h('span', { class: 'hint' }, fill === 'gradient'
          ? (sel?.gradient ? 'Drag in its panel to aim the selected gradient again, or in another panel for a new one.' : 'Drag across a panel: the gradient runs from where you start to where you let go.')
          : picking ? 'Tap the page to pick a colour.' : placement === 'panel' ? 'Tap inside a panel to add tone to its tone layer.' : placement === 'bucket' ? (bucket.source === 'fill' ? 'Tap a painted flat to tone exactly that shape.' : 'Tap inside a closed line area to tone just that area.') : 'Draw around the area to shade.'),
      ];
    },
    clear: marquee.clear,
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    isMarquee: marquee.active,
    down(p: Pt) { if (picking) { start = p; dragTo = null; } else if (fill === 'flat' && placement === 'lasso') marquee.down(p, shape); else { start = p; dragTo = null; } },
    move(p: Pt) { if (fill === 'gradient' && start) { dragTo = p; ctx.request(); } else marquee.move(p); },
    up(p: Pt, cancelled: boolean) {
      if (picking) {
        if (start && !cancelled && Math.hypot(p.x - start.x, p.y - start.y) * ctx.scale() < 12) {
          const c = hooks.pageColourAt?.(p);
          if (c) { draft = { ...draft, color: c }; picking = false; ctx.chrome(); } else toast('No colour there.');
        }
        start = null; dragTo = null;
        return;
      }
      if (fill === 'flat' && placement === 'lasso') marquee.up(p, cancelled);
      else if (start && !cancelled) {
        const far = Math.hypot(p.x - start.x, p.y - start.y) * ctx.scale();
        if (fill === 'gradient') {
          if (far < 12) toast('Drag across the panel to set the gradient’s direction.');
          else if (!reaim(start, p)) add(start, undefined, { from: start, to: p });
        } else if (far < 12) add(p, undefined, undefined, placement === 'bucket');
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
