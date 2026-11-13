import { findLayer, type Layer, type Pt, type Stroke } from '../doc/model';
import { applyPoint, IDENTITY, matrixFor, overallScale, type XParams } from '../engine/core/selxform';
import { pointInPoly } from '../geom/carve';
import type { Bounds } from '../geom/resizebox';
import { renderVectorLayer } from '../render/vector';
import type { DeskCtx } from './desk';
import { h, toast } from './dom';
import { drawSelectionFrame, grabSelection, selectionCenter, selectionTransform, type SelectionGrab } from './selectiongesture';
import { createMarquee, type MarqueeShape } from './marquee';
import { toSource, withPlacement, type Placement } from './placement';

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const cross = (u: Pt, v: Pt, w: Pt) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  return Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y) &&
    cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function touches(stroke: Stroke, poly: Pt[]): boolean {
  return stroke.pts.some((p, i) => pointInPoly(p, poly) || (i > 0 && poly.some((a, j) => crosses(stroke.pts[i - 1]!, p, a, poly[(j + 1) % poly.length]!))));
}

function boundsOf(strokes: Stroke[], indices: Set<number>): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const i of indices) {
    const st = strokes[i]!;
    const pad = st.w / 2;
    for (const p of st.pts) {
      b.x0 = Math.min(b.x0, p.x - pad); b.x1 = Math.max(b.x1, p.x + pad);
      b.y0 = Math.min(b.y0, p.y - pad); b.y1 = Math.max(b.y1, p.y + pad);
    }
  }
  return b;
}

type Selection = { id: string; source: Stroke[]; indices: Set<number>; place: Placement | null };

export function vectorSelection(ctx: DeskCtx, layersAt: (p: Pt) => Layer[], commit: (id: string, label: string, strokes: Stroke[]) => void,
  placement: (id: string) => Placement | null = () => null) {
  const { page, art, book, studio } = ctx;
  let selected: Selection | null = null;
  const marquee = createMarquee(ctx, (poly, from) => {
    for (const l of layersAt(from)) {
      // strokes on a moved panel are stored where the panel was carved
      const place = placement(l.id);
      const local = poly.map((p) => toSource(place, p));
      const indices = new Set<number>();
      l.strokes.forEach((stroke, i) => { if (touches(stroke, local)) indices.add(i); });
      if (!indices.size) continue;
      selected = { id: l.id, source: l.strokes, indices, place };
      break;
    }
    if (!selected) toast('No vector lines in this selection.');
  });
  let drag: { grab: SelectionGrab; from: Pt; bounds: Bounds; next: Stroke[] | null; angle: number } | null = null;
  let preview: HTMLCanvasElement | null = null;
  let rendered: Stroke[] | null = null;

  function current(): Selection | null {
    if (!selected) return null;
    const match = findLayer(page, selected.id);
    if (!match || match.layer.strokes !== selected.source || !match.layer.visible || match.layer.locked || !match.group.visible || match.group.locked) return null;
    return selected;
  }

  function stop(): void {
    marquee.clear();
    drag = null;
    preview = null;
    rendered = null;
    studio.drawing = false;
  }

  function apply(label: string, strokes: Stroke[]): void {
    const s = current();
    if (!s) return;
    commit(s.id, label, strokes);
    const next = findLayer(page, s.id)?.layer.strokes;
    selected = next ? { ...s, source: next } : null;
    ctx.chrome();
  }

  function transform(s: Selection, p: XParams, pivot: Pt): Stroke[] {
    const m = matrixFor(p, pivot.x, pivot.y);
    return s.source.map((st, i) => !s.indices.has(i) ? st : { ...st, w: st.w * overallScale(p), pts: st.pts.map((q) => {
      const [x, y] = applyPoint(m, q.x, q.y);
      return { x, y };
    }) });
  }

  return {
    down(p: Pt, e: PointerEvent, shape: MarqueeShape) {
      if (marquee.active()) { marquee.down(p, shape); return; }
      const s = current();
      if (s) {
        const bounds = boundsOf(s.source, s.indices);
        const at = toSource(s.place, p);
        const grab = grabSelection(bounds, at, ctx.scale(), e.pointerType === 'touch');
        if (grab) {
          drag = { grab, from: at, bounds, next: null, angle: 0 };
          studio.drawing = true;
          return;
        }
      }
      selected = null;
      marquee.down(p, shape);
      ctx.chrome();
    },
    move(p: Pt, e: PointerEvent) {
      if (marquee.active()) { marquee.move(p); return; }
      const s = current();
      if (!s || !drag) return;
      const d = drag;
      p = toSource(s.place, p);
      const delta = { x: p.x - d.from.x, y: p.y - d.from.y };
      if (!d.next && Math.hypot(delta.x, delta.y) * ctx.scale() < 2) return;
      if (Math.hypot(delta.x, delta.y) < 1e-6) { d.next = null; d.angle = 0; return; }
      const xform = selectionTransform(d.grab, d.bounds, d.from, p, e);
      d.angle = xform.rotate;
      d.next = transform(s, xform, selectionCenter(d.bounds));
    },
    up(p: Pt, e: PointerEvent) {
      if (e.type === 'pointercancel') { stop(); ctx.chrome(); ctx.request(); return; }
      if (drag) {
        const next = drag.next;
        const label = drag.grab.kind === 'move' ? 'Move selected lines' : drag.grab.kind === 'rotate' ? 'Rotate selected lines' : 'Resize selected lines';
        stop();
        if (next) apply(label, next);
        return;
      }
      marquee.up(p, false);
    },
    hover: marquee.hover,
    closePolygon: marquee.closePolygon,
    resetMarquee: marquee.clear,
    isMarquee: marquee.active,
    cancel(clear = false) {
      const active = marquee.active() || !!drag;
      if (active) stop();
      if (clear && !active) selected = null;
      ctx.chrome();
      ctx.request();
    },
    dispose() { if (marquee.active() || drag) stop(); },
    live(): Record<string, HTMLCanvasElement> {
      const s = current();
      const next = drag?.next;
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
      const action = (label: string, patch: Partial<XParams>) => h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => {
        if (s && current() === s) apply(label, transform(s, { ...IDENTITY, ...patch }, selectionCenter(boundsOf(s.source, s.indices))));
      } }, label);
      return [...marquee.controls(), action('Flip horizontal', { flipH: true }), action('Flip vertical', { flipV: true }), action('Rotate 45°', { rotate: 45 }),
        h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => {
          if (!s || current() !== s) return;
          const shift = Math.min(0.2, 14 / ctx.scale());
          const shifted = transform(s, { ...IDENTITY, dx: shift, dy: shift }, selectionCenter(boundsOf(s.source, s.indices)));
          const copies = shifted.filter((_, i) => s.indices.has(i));
          apply('Duplicate selected lines', [...s.source, ...copies]);
          if (selected) selected.indices = new Set(copies.map((_, i) => s.source.length + i));
          ctx.request();
        } }, 'Duplicate'),
        h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => { selected = null; ctx.chrome(); ctx.request(); } }, 'Deselect'),
        h('span', { class: 'hint' }, s ? `${s.indices.size} selected · Shift for precision · Alt to resize from center` : 'Draw around lines on a vector layer')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      marquee.overlay(g, scale);
      const s = current();
      if (s) {
        const b = boundsOf(drag?.next ?? s.source, s.indices);
        withPlacement(g, s.place, scale, (sc, k) => drawSelectionFrame(g, b, sc, drag?.grab.kind === 'rotate' ? drag.angle : undefined, true, 4 / k));
      }
      g.restore();
    },
  };
}
