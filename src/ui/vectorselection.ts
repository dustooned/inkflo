import { findLayer, type Layer, type Pt, type Stroke } from '../doc/model';
import { applyPoint, IDENTITY, matrixFor, overallScale, type XParams } from '../engine/core/selxform';
import { pointInPoly } from '../geom/carve';
import { boxHandles, resizeBox, type Bounds, type ResizeSide } from '../geom/resizebox';
import { renderVectorLayer } from '../render/vector';
import type { DeskCtx } from './desk';
import { h, toast } from './dom';

const centerOf = (b: Bounds): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const corners = (a: Pt, b: Pt): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];

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

type Grab = { kind: 'move' | 'rotate' } | { kind: 'resize'; side: ResizeSide };
type Selection = { id: string; source: Stroke[]; indices: Set<number> };

export function vectorSelection(ctx: DeskCtx, layersAt: (p: Pt) => Layer[], commit: (id: string, label: string, strokes: Stroke[]) => void) {
  const { page, art, book, studio } = ctx;
  let selected: Selection | null = null;
  let marquee: { path: Pt[]; freehand: boolean } | null = null;
  let drag: { grab: Grab; from: Pt; bounds: Bounds; next: Stroke[] | null; angle: number } | null = null;
  let preview: HTMLCanvasElement | null = null;
  let rendered: Stroke[] | null = null;

  function current(): Selection | null {
    if (!selected) return null;
    const match = findLayer(page, selected.id);
    if (!match || match.layer.strokes !== selected.source || !match.layer.visible || match.layer.locked || !match.group.visible || match.group.locked) return null;
    return selected;
  }

  function stop(): void {
    marquee = null;
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

  const rotationAt = (b: Bounds, scale: number) => ({ x: (b.x0 + b.x1) / 2, y: b.y0 - 23 / scale });
  const handles = (b: Bounds, scale: number) => boxHandles(b).filter((h) => h.x && h.y || ((b.x1 - b.x0) * scale > 34 && (b.y1 - b.y0) * scale > 34));

  return {
    down(p: Pt, e: PointerEvent, freehand: boolean) {
      const s = current();
      if (s) {
        const bounds = boundsOf(s.source, s.indices);
        const reach = (e.pointerType === 'touch' ? 13 : 8) / ctx.scale();
        const distance = (q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
        const corner = handles(bounds, ctx.scale()).sort((a, b) => distance(a.at) - distance(b.at))[0]!;
        const within = p.x >= bounds.x0 && p.x <= bounds.x1 && p.y >= bounds.y0 && p.y <= bounds.y1;
        const grab: Grab | null = distance(rotationAt(bounds, ctx.scale())) <= reach ? { kind: 'rotate' }
          : distance(corner.at) <= reach ? { kind: 'resize', side: corner } : within ? { kind: 'move' } : null;
        if (grab) {
          drag = { grab, from: p, bounds, next: null, angle: 0 };
          studio.drawing = true;
          return;
        }
      }
      selected = null;
      marquee = { path: [p, p], freehand };
      studio.drawing = true;
      ctx.chrome();
    },
    move(p: Pt, e: PointerEvent) {
      if (marquee) {
        const path = marquee.path;
        if (!marquee.freehand) path[1] = p;
        else if (Math.hypot(p.x - path.at(-1)!.x, p.y - path.at(-1)!.y) * ctx.scale() > 2) path.push(p);
        return;
      }
      const s = current();
      if (!s || !drag) return;
      const d = drag;
      const delta = { x: p.x - d.from.x, y: p.y - d.from.y };
      if (!d.next && Math.hypot(delta.x, delta.y) * ctx.scale() < 2) return;
      if (Math.hypot(delta.x, delta.y) < 1e-6) { d.next = null; d.angle = 0; return; }
      const center = centerOf(d.bounds);
      const xform = { ...IDENTITY };
      if (d.grab.kind === 'move') {
        xform.dx = e.shiftKey && Math.abs(delta.y) > Math.abs(delta.x) ? 0 : delta.x;
        xform.dy = e.shiftKey && Math.abs(delta.x) >= Math.abs(delta.y) ? 0 : delta.y;
      } else if (d.grab.kind === 'rotate') {
        const angle = (q: Pt) => Math.atan2(q.y - center.y, q.x - center.x);
        const turn = (angle(p) - angle(d.from)) * 180 / Math.PI;
        xform.rotate = e.shiftKey ? Math.round(turn / 15) * 15 : turn;
      } else if (d.grab.kind === 'resize') {
        const b = d.bounds;
        const resize = resizeBox(b, d.grab.side, delta, { x: 0.005, y: 0.005 }, e.altKey, e.shiftKey);
        Object.assign(xform, { dx: resize.shift.x, dy: resize.shift.y, sx: resize.width / (b.x1 - b.x0), sy: resize.height / (b.y1 - b.y0) });
      }
      d.angle = xform.rotate;
      d.next = transform(s, xform, center);
    },
    up(p: Pt, e: PointerEvent) {
      if (e.type === 'pointercancel') { stop(); ctx.request(); return; }
      if (drag) {
        const next = drag.next;
        const label = drag.grab.kind === 'move' ? 'Move selected lines' : drag.grab.kind === 'rotate' ? 'Rotate selected lines' : 'Resize selected lines';
        stop();
        if (next) apply(label, next);
        return;
      }
      if (!marquee) return;
      const { path, freehand } = marquee;
      const poly = freehand ? [...path, p] : corners(path[0]!, p);
      stop();
      for (const l of layersAt(path[0]!)) {
        const indices = new Set<number>();
        l.strokes.forEach((stroke, i) => { if (touches(stroke, poly)) indices.add(i); });
        if (!indices.size) continue;
        selected = { id: l.id, source: l.strokes, indices };
        break;
      }
      if (!selected) toast('No vector lines in this selection.');
      ctx.chrome();
    },
    cancel(clear = false) {
      const active = !!(marquee || drag);
      if (active) stop();
      if (clear && !active) selected = null;
      ctx.chrome();
      ctx.request();
    },
    dispose() { if (marquee || drag) stop(); },
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
        if (s && current() === s) apply(label, transform(s, { ...IDENTITY, ...patch }, centerOf(boundsOf(s.source, s.indices))));
      } }, label);
      return [action('Flip horizontal', { flipH: true }), action('Flip vertical', { flipV: true }), action('Rotate 45°', { rotate: 45 }),
        h('button', { class: 'btn', type: 'button', disabled: !s, onclick: () => { selected = null; ctx.chrome(); ctx.request(); } }, 'Deselect'),
        h('span', { class: 'hint' }, s ? `${s.indices.size} selected · Shift for precision · Alt to resize from center` : 'Draw around lines on a vector layer')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      g.save();
      g.strokeStyle = '#2F7FD8';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      if (marquee) {
        const path = marquee.freehand ? marquee.path : corners(marquee.path[0]!, marquee.path[1]!);
        g.beginPath();
        path.forEach((p, i) => i ? g.lineTo(p.x * scale, p.y * scale) : g.moveTo(p.x * scale, p.y * scale));
        g.closePath();
        g.stroke();
      }
      const s = current();
      if (s) {
        const b = boundsOf(drag?.next ?? s.source, s.indices);
        g.strokeRect(b.x0 * scale, b.y0 * scale, (b.x1 - b.x0) * scale, (b.y1 - b.y0) * scale);
        g.setLineDash([]);
        g.fillStyle = '#FFFDF7';
        const rotate = rotationAt(b, scale);
        g.beginPath(); g.moveTo(rotate.x * scale, b.y0 * scale); g.lineTo(rotate.x * scale, rotate.y * scale); g.stroke();
        for (const q of [...handles(b, scale).map((h) => h.at), rotate]) {
          g.beginPath(); g.arc(q.x * scale, q.y * scale, 4, 0, Math.PI * 2); g.fill(); g.stroke();
        }
        if (drag?.grab.kind === 'rotate') g.fillText(`${Math.round(drag.angle)}°`, rotate.x * scale + 10, rotate.y * scale);
      }
      g.restore();
    },
  };
}
