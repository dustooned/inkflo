import { findLayer, type Layer, type Pt, type Stroke } from '../doc/model';
import { applyPoint, type Mat } from '../engine/core/selxform';
import { boxFromBounds, boxLocal } from '../geom/xformbox';
import { sampleMesh, type Mesh } from '../geom/meshwarp';
import { strokeTouchesOutline } from '../geom/selection';
import type { Bounds } from '../geom/resizebox';
import { renderVectorLayer } from '../render/vector';
import type { DeskCtx } from './desk';
import { h, toast } from './dom';
import { createMarquee, type MarqueeShape } from './marquee';
import { toSource, withPlacement, type Placement } from './placement';
import { createTransformBox, type PinchGesture } from './transformbox';

function boundsOf(strokes: Stroke[], indices: Set<number>): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const i of indices) {
    const st = strokes[i]!;
    for (const [j, p] of st.pts.entries()) {
      const pad = st.w * (st.pw?.[j] ?? 1) / 2;
      b.x0 = Math.min(b.x0, p.x - pad); b.x1 = Math.max(b.x1, p.x + pad);
      b.y0 = Math.min(b.y0, p.y - pad); b.y1 = Math.max(b.y1, p.y + pad);
    }
  }
  return b;
}

type Selection = { id: string; source: Stroke[]; indices: Set<number>; place: Placement | null };

export function vectorSelection(ctx: DeskCtx, layersIn: (polygon: Pt[], from: Pt) => Layer[], commit: (id: string, label: string, strokes: Stroke[]) => void,
  placement: (id: string) => Placement | null, emptyHint: () => string) {
  const { page, art, book, studio } = ctx;
  let selected: Selection | null = null;
  const xf = createTransformBox({ scale: () => ctx.scale(), minSize: 0.005, changed: () => ctx.request(), chrome: () => ctx.chrome(), meshModes: true, unit: { label: 'px', scale: book.dpi } });
  const marquee = createMarquee(ctx, (poly, from) => pick(poly, from, false));
  function pick(poly: Pt[], from: Pt, quiet: boolean): void {
    for (const l of layersIn(poly, from)) {
      // strokes on a moved panel are stored where the panel was carved
      const place = placement(l.id);
      const local = poly.map((p) => toSource(place, p));
      const indices = new Set<number>();
      l.strokes.forEach((stroke, i) => { if (strokeTouchesOutline(stroke, local)) indices.add(i); });
      if (!indices.size) continue;
      selected = { id: l.id, source: l.strokes, indices, place };
      xf.start(boxFromBounds(boundsOf(l.strokes, indices)));
      break;
    }
    if (!selected && !quiet) toast(emptyHint());
  }
  /** The strokes as the box would leave them, while a drag is in progress. */
  let liveStrokes: Stroke[] | null = null;
  let preview: HTMLCanvasElement | null = null;
  let rendered: Stroke[] | null = null;

  function current(): Selection | null {
    if (!selected) return null;
    const match = findLayer(page, selected.id);
    if (!match || !match.layer.vector || match.layer.strokes !== selected.source || !match.layer.visible || match.layer.locked ||
      !match.group.visible || match.group.locked || match.layer.opacity <= 0 || match.group.opacity <= 0) return null;
    return selected;
  }

  function stop(): void {
    marquee.clear();
    if (xf.dragging()) { studio.drawing = false; xf.cancel(); }
    liveStrokes = null;
    preview = null;
    rendered = null;
  }

  function clear(): void {
    stop();
    selected = null;
    xf.clear();
  }

  const view = (s: Selection) => ({ k: s.place?.k ?? 1, extent: s.place ? null : { w: page.widthIn, h: page.heightIn } });

  function apply(label: string, strokes: Stroke[]): void {
    const s = current();
    if (!s) return;
    commit(s.id, label, strokes);
    const next = findLayer(page, s.id)?.layer.strokes;
    const bent = !!xf.mesh() && xf.moved();
    selected = next ? { ...s, source: next } : null;
    if (bent && selected) xf.start(boxFromBounds(boundsOf(selected.source, selected.indices)));
    else xf.rebase();
    ctx.chrome();
  }

  /** The selected lines pushed through a Distort or Warp mesh. */
  function bend(s: Selection, mesh: Mesh, orig: { cx: number; cy: number; w: number; h: number; a: number; fx: 1 | -1; fy: 1 | -1 }): Stroke[] {
    const map = (q: Pt): Pt => { const l = boxLocal(orig, q); return sampleMesh(mesh, l.x / orig.w + 0.5, l.y / orig.h + 0.5); };
    const c = [mesh.pts[0]!, mesh.pts[mesh.cols]!, mesh.pts.at(-1)!, mesh.pts[mesh.pts.length - 1 - mesh.cols]!];
    const area = Math.abs(c.reduce((sum, p, i) => sum + p.x * c[(i + 1) % 4]!.y - c[(i + 1) % 4]!.x * p.y, 0)) / 2;
    const k = Math.sqrt(area / (orig.w * orig.h)) || 1;
    return s.source.map((st, i) => !s.indices.has(i) ? st : { ...st, w: st.w * k, pts: st.pts.map((q) => ({ ...q, ...map(q) })) });
  }
  /** The selection as the box would leave it, or null while nothing has moved. */
  function shaped(s: Selection): Stroke[] | null {
    if (!xf.moved()) return null;
    const mesh = xf.mesh(), orig = xf.orig();
    if (mesh && orig) return bend(s, mesh, orig);
    const m = xf.matrix();
    return m ? transform(s, m) : null;
  }

  function transform(s: Selection, m: Mat): Stroke[] {
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    return s.source.map((st, i) => !s.indices.has(i) ? st : { ...st, w: st.w * k, pts: st.pts.map((q) => {
      const [x, y] = applyPoint(m, q.x, q.y);
      return { x, y };
    }) });
  }

  return {
    down(p: Pt, e: PointerEvent, shape: MarqueeShape) {
      if (marquee.active()) { marquee.down(p, shape); return; }
      const s = current();
      if (s && xf.down(toSource(s.place, p), e, view(s))) { studio.drawing = true; return; }
      selected = null;
      xf.clear();
      marquee.down(p, shape);
      ctx.chrome();
    },
    move(p: Pt, e: PointerEvent) {
      if (marquee.active()) { marquee.move(p); return; }
      const s = current();
      if (!s || !xf.dragging()) return;
      xf.move(toSource(s.place, p), e);
      liveStrokes = shaped(s);
    },
    up(p: Pt, e: PointerEvent) {
      if (e.type === 'pointercancel') { stop(); ctx.chrome(); ctx.request(); return; }
      if (xf.dragging()) {
        this.move(p, e);
        const next = liveStrokes;
        const grab = xf.grab()?.kind;
        const label = grab === 'move' ? 'Move selected lines' : grab === 'rotate' ? 'Rotate selected lines' : 'Resize selected lines';
        xf.up();
        studio.drawing = false;
        marquee.clear();
        liveStrokes = null;
        preview = null;
        rendered = null;
        if (next) apply(label, next);
        else ctx.chrome();
        return;
      }
      marquee.up(p, false);
    },
    /** Two fingers while lines are selected pinch, twist and drag them instead of the view. */
    pinch(g: PinchGesture | null): boolean {
      const s = current();
      if (!g) {
        const ended = xf.moved() && s;
        xf.pinch(null);
        if (ended) {
          const next = shaped(s);
          liveStrokes = null; preview = null; rendered = null;
          if (next) apply('Transform selected lines', next);
        }
        return false;
      }
      if (!s) return false;
      if (!xf.pinch({ ...g, anchor: toSource(s.place, g.anchor), to: toSource(s.place, g.to) })) return false;
      liveStrokes = shaped(s);
      return true;
    },
    /** The selected lines on the page (a moved panel's placement applied), for the clipboard. */
    clipboard(): { type: Layer['type']; strokes: Stroke[]; centre: Pt } | null {
      const sel = current();
      if (!sel) return null;
      const layer = findLayer(page, sel.id)?.layer;
      if (!layer) return null;
      const m = sel.place?.m, k = sel.place?.k ?? 1;
      const strokes = [...sel.indices].map((i) => sel.source[i]!).map((st) => ({ ...st, w: st.w * k, pts: st.pts.map((q) => {
        if (!m) return { ...q };
        const [x, y] = applyPoint(m, q.x, q.y);
        return { ...q, x, y };
      }) }));
      const xs = strokes.flatMap((st) => st.pts.map((q) => q.x)), ys = strokes.flatMap((st) => st.pts.map((q) => q.y));
      return { type: layer.type, strokes, centre: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } };
    },
    /** Pointer-style pick: select the line(s) touching a small area around `p`. True when something was selected. */
    pickAt(p: Pt, reach: number): boolean {
      selected = null;
      xf.clear();
      pick([{ x: p.x - reach, y: p.y - reach }, { x: p.x + reach, y: p.y - reach }, { x: p.x + reach, y: p.y + reach }, { x: p.x - reach, y: p.y + reach }], p, true);
      return !!selected;
    },
    /** Take hold of the box under `p` without starting a new selection. */
    tryGrab(p: Pt, e: PointerEvent): boolean {
      const s = current();
      if (!s || !xf.down(toSource(s.place, p), e, view(s))) return false;
      studio.drawing = true;
      return true;
    },
    hasSelection: () => !!current(),
    /** Shift-tap: add the line(s) under `p` to the selection (same layer). True when something was added. */
    addAt(p: Pt, reach: number): boolean {
      const s = current();
      if (!s) return false;
      const layer = findLayer(page, s.id)?.layer;
      if (!layer) return false;
      const at = toSource(s.place, p);
      const area = [{ x: at.x - reach, y: at.y - reach }, { x: at.x + reach, y: at.y - reach }, { x: at.x + reach, y: at.y + reach }, { x: at.x - reach, y: at.y + reach }];
      const indices = new Set(s.indices);
      layer.strokes.forEach((stroke, i) => { if (strokeTouchesOutline(stroke, area)) indices.add(i); });
      if (indices.size === s.indices.size) return false;
      selected = { ...s, indices };
      xf.start(boxFromBounds(boundsOf(s.source, indices)));
      ctx.chrome();
      ctx.request();
      return true;
    },
    /** Arrow-key step, in page inches; applied at once like any other gesture here. */
    nudge(dx: number, dy: number): boolean {
      const s = current();
      if (!s || xf.dragging() || !xf.nudge(dx, dy)) return false;
      const next = shaped(s);
      if (next) apply('Nudge selected lines', next);
      return true;
    },
    pending: () => false,
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    resetMarquee: marquee.clear,
    isMarquee: marquee.active,
    clear,
    cancel(clear = false) {
      const active = marquee.active() || xf.dragging();
      if (active) stop();
      if (clear && !active) { selected = null; xf.clear(); }
      ctx.chrome();
      ctx.request();
    },
    dispose() { if (marquee.active() || xf.dragging()) stop(); },
    live(): Record<string, HTMLCanvasElement> {
      const s = current();
      const next = liveStrokes;
      if (!s || !next) return {};
      if (!preview) {
        preview = document.createElement('canvas');
        preview.width = art.width;
        preview.height = art.height;
      }
      if (next !== rendered) {
        renderVectorLayer({ ...findLayer(page, s.id)!.layer, strokes: next }, preview, book.dpi);
        rendered = next;
      }
      return { [s.id]: preview };
    },
    controls() {
      const s = current();
      const change = (label: string) => {
        const next = s && current() === s ? shaped(s) : null;
        if (s && next) apply(label, next);
      };
      return [...marquee.controls(),
        ...xf.controls({ commit: change, reset: false, extent: () => (s && !s.place ? { w: page.widthIn, h: page.heightIn } : null) }),
        h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => {
          if (!s || current() !== s) return;
          const shift = Math.min(0.2, 14 / ctx.scale());
          const shifted = transform(s, [1, 0, 0, 1, shift, shift]);
          const copies = shifted.filter((_, i) => s.indices.has(i));
          apply('Duplicate selected lines', [...s.source, ...copies]);
          if (selected) {
            selected.indices = new Set(copies.map((_, i) => s.source.length + i));
            xf.start(boxFromBounds(boundsOf(selected.source, selected.indices)));
          }
          ctx.request();
        } }, 'Duplicate'),
        h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => { selected = null; xf.clear(); ctx.chrome(); ctx.request(); } }, 'Deselect'),
        h('span', { class: 'hint' }, s ? `${s.indices.size} selected on ${findLayer(page, s.id)!.layer.name} · Drag inside to move, a handle to resize, the knob to turn · two fingers pinch and twist` : 'Draw around vector ink. For paint and fills, use Transform.')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      const s = current();
      if (s) withPlacement(g, s.place, scale, (sc) => xf.overlay(g, sc, view(s)));
      g.restore();
    },
  };
}
