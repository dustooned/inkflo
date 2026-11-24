import { findLayer, type Layer, type PixelTransform, type Pt, type SelectionStep } from '../doc/model';
import { downscaleCanvas, downscaleLifted, IDENTITY_MATRIX, liftRecipe, paintPixelTransform, transformDestination, type LiftedPixels } from '../draw/pixeltransform';
import { touchLayer } from '../draw/residency';
import { applyPoint, unionRect, type Mat, type Rect } from '../engine/core/selxform';
import { meshToFlat } from '../geom/meshwarp';
import { boxFromBounds } from '../geom/xformbox';
import type { DeskCtx } from './desk';
import { h, seg, slider, toast } from './dom';
import { icon } from './icons';
import { popover } from './popover';
import { createMarquee, type MarqueeShape } from './marquee';
import { selectionCorners } from './selectiongesture';
import { toSource, withPlacement, type Placement } from './placement';
import { createTransformBox, type PinchGesture } from './transformbox';

interface Selection {
  id: string;
  name: string;
  source: HTMLCanvasElement;
  revision: number;
  /** The first area drawn (source space, inches). */
  polygon: Pt[];
  /** How it was made, without the feather (which is a separate setting). */
  recipe: SelectionStep[];
  lifted: LiftedPixels;
  /** The panel placement the layer is shown through; the selection works in its source space. */
  place: Placement | null;
}

export function rasterSelection(ctx: DeskCtx, layersIn: (polygon: Pt[], from: Pt) => Layer[], keepResident: () => void,
  placement: (id: string) => Placement | null, emptyHint: () => string) {
  const { page, art, studio, book } = ctx;
  const dpi = book.dpi;
  let selected: Selection | null = null;
  /** The last area selected (page inches), kept after the tool changes: a gradient can use it. */
  let lastArea: Pt[] | null = null;
  const xf = createTransformBox({ scale: () => ctx.scale(), minSize: 1 / dpi, changed: () => ctx.request(), chrome: () => ctx.chrome(), meshModes: true, unit: { label: 'px', scale: dpi } });
  const marquee = createMarquee(ctx, (polygon, from) => pick(polygon, from));
  const tints = new WeakMap<LiftedPixels, HTMLCanvasElement>();
  /** The selected area as a flat blue wash, cached per selection. */
  function tintOf(lifted: LiftedPixels): HTMLCanvasElement {
    let t = tints.get(lifted);
    if (!t) {
      t = document.createElement('canvas');
      t.width = lifted.mask.width; t.height = lifted.mask.height;
      const g = t.getContext('2d')!;
      g.drawImage(lifted.mask, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#2F7FD8';
      g.fillRect(0, 0, t.width, t.height);
      tints.set(lifted, t);
    }
    return t;
  }

  /** New or add to / subtract from what is already selected. */
  let selMode: 'replace' | 'add' | 'subtract' = 'replace';
  /** Feather radius in inches (0 = hard edge). */
  let feather = 0;
  /** Colour select: the next tap picks pixels like the one under it. */
  let picking = false;
  let tolerance = 0.2;
  let contiguous = true;
  const withFeather = (steps: SelectionStep[]): SelectionStep[] => (feather > 0 ? [...steps, { op: 'feather', radius: feather }] : steps);
  const lift = (source: HTMLCanvasElement, steps: SelectionStep[]) => liftRecipe(source, withFeather(steps), dpi);
  const boxOf = (lifted: LiftedPixels) => {
    const { x, y, w, h } = lifted.rect;
    return boxFromBounds({ x0: x / dpi, y0: y / dpi, x1: (x + w) / dpi, y1: (y + h) / dpi });
  };
  const rectPolygon = (lifted: LiftedPixels): Pt[] => {
    const { x, y, w, h } = lifted.rect;
    return selectionCorners({ x: x / dpi, y: y / dpi }, { x: (x + w) / dpi, y: (y + h) / dpi });
  };
  const isSimple = (steps: SelectionStep[]) => feather === 0 && steps.length === 1 && steps[0]!.op === 'replace' && steps[0]!.shape.kind === 'polygon';

  /** Put a new recipe's result in place of the current selection (same layer), and restart the box around it. */
  function revise(s: Selection, steps: SelectionStep[], empty: string): boolean {
    const lifted = lift(s.source, steps);
    if (!lifted) { toast(empty); return false; }
    selected = { ...s, recipe: steps, lifted };
    xf.start(boxOf(lifted));
    preview = null; rendered = null; dirty = null; low = null;
    return true;
  }
  function pending(): boolean {
    if (current() && xf.moved()) { toast('Apply or cancel the transform before changing the selection.'); return true; }
    return false;
  }

  function pick(polygon: Pt[], from: Pt, only?: Layer): void {
    lastArea = polygon.map((p) => ({ ...p }));
    const base = selMode !== 'replace' ? current() : null;
    if (base) {
      if (pending()) return;
      const step: SelectionStep = { op: selMode, shape: { kind: 'polygon', pts: polygon.map((p) => toSource(base.place, p)) } };
      if (revise(base, [...base.recipe, step], 'That leaves nothing selected.')) ctx.request();
      return;
    }
    for (const layer of only ? [only] : layersIn(polygon, from)) {
      const source = art.planes[layer.id];
      if (!source) continue;
      const place = placement(layer.id);
      const local = polygon.map((p) => toSource(place, p));
      const recipe: SelectionStep[] = [{ op: 'replace', shape: { kind: 'polygon', pts: local } }];
      const lifted = lift(source, recipe);
      if (!lifted) continue;
      selected = { id: layer.id, name: layer.name, source, revision: art.revs[layer.id] ?? 0, polygon: local, recipe, lifted, place };
      xf.start(boxOf(lifted));
      break;
    }
    if (!selected) toast(emptyHint());
  }

  /** Colour select: pixels like the one under `p`, on the selected layer (or the first layer that has paint there). */
  function pickColour(p: Pt): void {
    const base = current();
    if (base && pending()) return;
    const around = [{ x: p.x - 0.01, y: p.y - 0.01 }, { x: p.x + 0.01, y: p.y - 0.01 }, { x: p.x + 0.01, y: p.y + 0.01 }, { x: p.x - 0.01, y: p.y + 0.01 }];
    const layer = base ? findLayer(page, base.id)?.layer : layersIn(around, p)[0];
    const source = layer && art.planes[layer.id];
    if (!layer || !source) { toast(emptyHint()); return; }
    const place = base?.place ?? placement(layer.id);
    const shape = { kind: 'colour' as const, at: toSource(place, p), tolerance, contiguous };
    if (base) {
      if (revise(base, [...base.recipe, { op: selMode === 'replace' ? 'replace' : selMode, shape }], 'Nothing like that colour here.')) ctx.request();
      return;
    }
    const recipe: SelectionStep[] = [{ op: 'replace', shape }];
    const lifted = lift(source, recipe);
    if (!lifted) { toast('Nothing like that colour here.'); return; }
    selected = { id: layer.id, name: layer.name, source, revision: art.revs[layer.id] ?? 0, polygon: rectPolygon(lifted), recipe, lifted, place };
    xf.start(boxOf(lifted));
    ctx.request();
  }

  /** The matrix the art is currently carried by; identity while the box is untouched. */
  const cur = (): Mat => xf.matrix() ?? IDENTITY_MATRIX;
  let preview: CanvasRenderingContext2D | null = null;
  let rendered: object | null = null;
  let renderedCopy = false;
  let renderedCrisp = false;
  let copy = false;
  /** Nearest-neighbour resampling: hard pixel edges, for pixel art and screentone. */
  let crisp = false;
  let dirty: Rect | null = null;
  /** A reduced-resolution stand-in for big art while a gesture is in progress; the full preview returns on release. */
  let low: { k: number; source: HTMLCanvasElement; lifted: LiftedPixels; preview: CanvasRenderingContext2D; rendered: object | null; copy: boolean; crisp: boolean; dirty: Rect | null } | null = null;
  const LOW_ABOVE = 1800;
  const LOW_SIZE = 1600;

  function current(): Selection | null {
    if (!selected) return null;
    const match = findLayer(page, selected.id);
    if (!match || match.layer.vector || match.layer.image || match.layer.screenTone || match.layer.locked || !match.layer.visible ||
      !match.group.visible || match.group.locked || match.layer.opacity <= 0 || match.group.opacity <= 0 ||
      selected.source !== art.planes[selected.id] || selected.revision !== (art.revs[selected.id] ?? 0)) return null;
    return selected;
  }

  /** What the box needs to know about where the art sits: its placement zoom, and the page to snap to. */
  const view = (s: Selection) => ({ k: s.place?.k ?? 1, extent: s.place ? null : { w: page.widthIn, h: page.heightIn } });

  function stopGesture(): void {
    if (xf.dragging()) { studio.drawing = false; xf.up(); }
    marquee.clear();
  }

  function clear(): void {
    stopGesture();
    selected = null;
    xf.clear();
    copy = false;
    picking = false;
    preview = null;
    rendered = null;
    dirty = null;
    low = null;
  }

  function apply(): void {
    const s = current();
    const matrix = cur();
    const mesh = xf.mesh();
    if (!s || !xf.moved() || xf.dragging()) return;
    const { source, lifted, id } = s;
    const destination = transformDestination(lifted, matrix, dpi, source.width, source.height, mesh);
    if (!destination) { toast('Move the selection back onto the page before applying.'); return; }
    const region = unionRect(lifted.rect, destination)!;
    const g = source.getContext('2d')!;
    const { x, y, w, h } = region;
    const before = g.getImageData(x, y, w, h);
    const layer = findLayer(page, id)!.layer;
    const previous = layer.pixelTransforms;
    const simple = isSimple(s.recipe);
    const edit: PixelTransform = { polygon: simple ? s.polygon : rectPolygon(lifted), ...(simple ? {} : { selection: withFeather(s.recipe) }), matrix: [...matrix], ...(mesh ? { mesh: meshToFlat(mesh) } : {}), strokes: layer.strokes.length, fills: layer.fills.length, ...(copy ? { copy: true } : {}), ...(crisp ? { crisp: true } : {}) };
    const next = [...previous ?? [], edit];
    let after: ImageData;
    try {
      paintPixelTransform(g, lifted, matrix, dpi, copy, crisp, mesh);
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

  /** The bar's Selection menu: add and subtract, invert, feather and colour select. */
  function selectionMenu(invert: () => void): HTMLElement {
    const anchor = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-pressed': String(picking), title: 'Add to or subtract from the selection, invert it, feather its edge, or pick by colour' }, 'Selection ▾');
    anchor.addEventListener('click', () => {
      const holder = h('div', { class: 'arrange' });
      const again = () => holder.replaceChildren(...build());
      const build = (): HTMLElement[] => {
        const s = current();
        return [
          h('div', { class: 'arrange-row' }, seg<'replace' | 'add' | 'subtract'>([
            { id: 'replace', label: 'New', icon: 'select', hint: 'A new selection replaces the old one' },
            { id: 'add', label: 'Add', icon: 'selAdd', hint: 'Draw an area to add to the selection' },
            { id: 'subtract', label: 'Subtract', icon: 'selSubtract', hint: 'Draw an area to take out of the selection' },
          ], selMode, (v) => { selMode = v; again(); }, 'Selection mode')),
          h('div', { class: 'arrange-row' },
            h('button', { class: 'btn', type: 'button', disabled: !s, title: 'Select everything that is not selected', onclick: () => { invert(); again(); } }, icon('selInvert', 16), 'Invert')),
          slider('Feather', 0, 60, 1, Math.round(feather * dpi), (v) => `${v} px`, () => {}, (v) => {
            feather = v / dpi;
            const now = current();
            if (now && !pending()) { revise(now, now.recipe, 'That leaves nothing selected.'); ctx.request(); }
            ctx.chrome();
            again();
          }),
          h('div', { class: 'arrange-row' },
            h('button', { class: 'btn', type: 'button', 'aria-pressed': String(picking), title: 'Tap the art: everything like that colour is selected', onclick: () => { picking = !picking; marquee.clear(); ctx.chrome(); again(); } }, icon('eyedropper', 16), 'Colour select'),
            h('button', { class: 'btn', type: 'button', 'aria-pressed': String(contiguous), title: 'Only pixels touching the one you tap', onclick: () => { contiguous = !contiguous; again(); } }, 'Touching only')),
          slider('Tolerance', 0, 100, 1, Math.round(tolerance * 100), (v) => `${v}%`, (v) => { tolerance = v / 100; }),
        ];
      };
      holder.replaceChildren(...build());
      popover(anchor, holder, 'below', 'Selection');
    });
    return anchor;
  }

  return {
    /** The outline of the last selection made with this tool (page inches), or null. */
    lastArea: () => lastArea,
    down(p: Pt, e: PointerEvent, shape: MarqueeShape) {
      if (marquee.active()) { marquee.down(p, shape); return; }
      if (picking) { pickColour(p); ctx.chrome(); return; }
      const s = current();
      // Add and Subtract draw on the selection, wherever the press lands; New (the default) grabs the box
      if (s && selMode !== 'replace') {
        if (xf.moved()) { toast('Apply or cancel the transform before changing the selection.'); return; }
        marquee.down(p, shape);
        ctx.chrome();
        return;
      }
      if (s) {
        if (xf.down(toSource(s.place, p), e, view(s))) { studio.drawing = true; return; }
        if (xf.moved()) { toast('Apply or cancel the transform before making a new selection.'); return; }
      }
      clear();
      marquee.down(p, shape);
      ctx.chrome();
    },
    move(p: Pt, e: PointerEvent) {
      if (marquee.active()) { marquee.move(p); return; }
      const s = current();
      if (!xf.dragging() || !s) return;
      xf.move(toSource(s.place, p), e);
    },
    up(p: Pt, e: PointerEvent) {
      if (e.type === 'pointercancel') {
        xf.cancel();
        studio.drawing = false;
        marquee.clear();
        ctx.chrome();
        ctx.request();
        return;
      }
      if (xf.dragging()) {
        this.move(p, e);
        stopGesture();
        ctx.chrome();
        return;
      }
      marquee.up(p, false);
    },
    /** Two fingers while art is selected pinch, twist and drag the box instead of the view. */
    pinch(g: PinchGesture | null): boolean {
      const s = current();
      if (!g) return xf.pinch(null);
      if (!s) return false;
      return xf.pinch({ ...g, anchor: toSource(s.place, g.anchor), to: toSource(s.place, g.to) });
    },
    /** Take everything on the current layer (or the first layer with paint) as the selection. */
    selectLayer() {
      if (current() && xf.moved()) return;
      clear();
      pick(selectionCorners({ x: 0, y: 0 }, { x: page.widthIn, y: page.heightIn }), { x: page.widthIn / 2, y: page.heightIn / 2 });
      ctx.chrome();
      ctx.request();
    },
    hasSelection: () => !!current(),
    /** Select everything that is not selected. */
    invert(): void {
      const s = current();
      if (!s || pending()) return;
      if (revise(s, [...s.recipe, { op: 'invert' }], 'That leaves nothing selected.')) { ctx.chrome(); ctx.request(); }
    },
    /** Arrow-key step, in page inches. */
    nudge(dx: number, dy: number): boolean {
      if (!current() || xf.dragging()) return false;
      return xf.nudge(dx, dy);
    },
    /** Unapplied changes are waiting (a new selection must not silently drop them). */
    pending: () => !!current() && xf.moved(),
    /** Pointer-style pick: everything painted on this layer. */
    pickLayer(layer: Layer): boolean {
      clear();
      pick(selectionCorners({ x: 0, y: 0 }, { x: page.widthIn, y: page.heightIn }), { x: page.widthIn / 2, y: page.heightIn / 2 }, layer);
      return !!selected;
    },
    /** Take hold of the box under `p` without starting a new selection. */
    tryGrab(p: Pt, e: PointerEvent): boolean {
      const s = current();
      if (!s || !xf.down(toSource(s.place, p), e, view(s))) return false;
      studio.drawing = true;
      return true;
    },
    /** The selected pixels as a clipboard piece: size in inches, centre on the page. */
    clipboard(): { name: string; canvas: HTMLCanvasElement; widthIn: number; heightIn: number; centre: Pt } | null {
      const sel = current();
      if (!sel) return null;
      const { rect, pixels } = sel.lifted;
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      canvas.getContext('2d')!.drawImage(pixels, 0, 0);
      const mid = { x: (rect.x + rect.w / 2) / dpi, y: (rect.y + rect.h / 2) / dpi };
      const centre = sel.place ? (() => { const [x, y] = applyPoint(sel.place!.m, mid.x, mid.y); return { x, y }; })() : mid;
      const k = sel.place?.k ?? 1;
      return { name: sel.name + ' piece', canvas, widthIn: rect.w / dpi * k, heightIn: rect.h / dpi * k, centre };
    },
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    resetMarquee: marquee.clear,
    isMarquee: marquee.active,
    clear,
    apply,
    live(): Record<string, HTMLCanvasElement> {
      const s = current();
      const matrix = cur();
      const mesh = xf.mesh();
      if (!s || !xf.moved()) return {};
      const key = mesh ?? matrix;
      if (xf.busy() && Math.max(s.source.width, s.source.height) > LOW_ABOVE) {
        // big art: drag a smaller copy, then settle at full size when the gesture ends
        if (!low) {
          const k = LOW_SIZE / Math.max(s.source.width, s.source.height);
          const source = downscaleCanvas(s.source, k);
          const canvas = document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = source.height;
          const preview = canvas.getContext('2d')!;
          preview.drawImage(source, 0, 0);
          low = { k, source, lifted: downscaleLifted(s.lifted, k), preview, rendered: null, copy, crisp, dirty: null };
        }
        const L = low;
        if (L.rendered !== key || L.copy !== copy || L.crisp !== crisp) {
          if (L.dirty) {
            const { x, y, w, h } = L.dirty;
            L.preview.clearRect(x, y, w, h);
            L.preview.drawImage(L.source, x, y, w, h, x, y, w, h);
          }
          L.dirty = paintPixelTransform(L.preview, L.lifted, matrix, dpi * L.k, copy, crisp, mesh);
          L.rendered = key; L.copy = copy; L.crisp = crisp;
        }
        return { [s.id]: L.preview.canvas };
      }
      if (!preview) {
        const canvas = document.createElement('canvas');
        canvas.width = s.source.width;
        canvas.height = s.source.height;
        preview = canvas.getContext('2d')!;
        preview.drawImage(s.source, 0, 0);
      }
      if (rendered !== key || renderedCopy !== copy || renderedCrisp !== crisp) {
        if (dirty) {
          const { x, y, w, h } = dirty;
          preview.clearRect(x, y, w, h);
          preview.drawImage(s.source, x, y, w, h, x, y, w, h);
        }
        dirty = paintPixelTransform(preview, s.lifted, matrix, dpi, copy, crisp, mesh);
        rendered = key;
        renderedCopy = copy;
        renderedCrisp = crisp;
      }
      return { [s.id]: preview.canvas };
    },
    controls() {
      const s = current();
      if (!s && selected) clear();
      return [...marquee.controls(),
        h('button', { class: 'btn primary', type: 'button', disabled: !s || !xf.moved(), onclick: apply }, 'Apply'),
        h('button', { class: 'btn', type: 'button', disabled: !s && !marquee.active(), onclick: () => { clear(); ctx.chrome(); ctx.request(); } }, 'Cancel'),
        h('button', { class: 'btn', type: 'button', title: 'Select everything painted on this layer', onclick: () => this.selectLayer() }, 'Whole layer'),
        selectionMenu(() => this.invert()),
        ...xf.controls({
          extent: () => (s && !s.place ? { w: page.widthIn, h: page.heightIn } : null),
          extras: (refresh) => [
            h('div', { class: 'arrange-row' }, h('button', { class: 'btn', type: 'button', disabled: !s, 'aria-pressed': String(copy), title: 'Leave the original in place and place a copy', onclick: () => { copy = !copy; ctx.request(); refresh(); } }, 'Keep original')),
            seg<'smooth' | 'crisp'>([{ id: 'smooth', label: 'Smooth', hint: 'Blend edges when resizing or turning' }, { id: 'crisp', label: 'Crisp', hint: 'Hard pixel edges, nothing blended' }],
              crisp ? 'crisp' : 'smooth', (v) => { crisp = v === 'crisp'; ctx.request(); refresh(); }, 'Resampling'),
          ],
        }),
        h('span', { class: 'hint' }, s ? `${s.name} · Drag inside to move, a handle to resize, the knob or a corner's outside to turn · two fingers pinch and twist` : 'Draw around paint, or choose Whole layer. For vector ink, use Select lines.')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      const s = current();
      if (s) {
        withPlacement(g, s.place, scale, (sc) => {
          // the selected area, lightly tinted, so add / subtract / feather / colour picks can be seen
          const m = cur(), r = s.lifted.rect;
          g.save();
          g.scale(sc, sc);
          g.transform(...m);
          g.globalAlpha = 0.28;
          g.drawImage(tintOf(s.lifted), r.x / dpi, r.y / dpi, r.w / dpi, r.h / dpi);
          g.restore();
        });
        withPlacement(g, s.place, scale, (sc) => xf.overlay(g, sc, view(s)));
      }
      g.restore();
    },
  };
}
