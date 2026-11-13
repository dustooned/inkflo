import type { Pt } from '../doc/model';
import { buildEdges, magneticPath, type EdgeMap } from '../draw/magnetic';
import { makeCanvas } from '../io/canvasops';
import { renderPage } from '../render/page';
import type { DeskCtx } from './desk';
import { h } from './dom';
import { drawSelectionPath, selectionCorners } from './selectiongesture';

export const MARQUEE_SHAPES = [
  { id: 'rectangle', label: 'Rectangle', glyph: '⬚' },
  { id: 'ellipse', label: 'Ellipse', glyph: '◯' },
  { id: 'freehand', label: 'Freehand', glyph: '◌' },
  { id: 'polygon', label: 'Polygon', glyph: '⬠' },
  { id: 'magnetic', label: 'Magnetic', glyph: '⌁' },
] as const;
export type MarqueeShape = typeof MARQUEE_SHAPES[number]['id'];

export function marqueeShape(value: string): MarqueeShape {
  return MARQUEE_SHAPES.find(({ id }) => id === value)?.id ?? 'rectangle';
}

function outline(a: Pt, b: Pt, shape: MarqueeShape): Pt[] {
  if (shape !== 'ellipse') return selectionCorners(a, b);
  return Array.from({ length: 96 }, (_, i) => {
    const t = i * Math.PI / 48;
    return { x: (a.x + b.x + (b.x - a.x) * Math.cos(t)) / 2, y: (a.y + b.y + (b.y - a.y) * Math.sin(t)) / 2 };
  });
}

export function createMarquee(ctx: DeskCtx, finish: (poly: Pt[], from: Pt) => void) {
  let draft: { shape: MarqueeShape; path: Pt[]; tip: Pt; map?: EdgeMap } | null = null;
  let edgeCache: { key: string; map: EdgeMap } | undefined;
  const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) * ctx.scale();
  const clear = () => { if (draft) ctx.studio.drawing = false; draft = null; };
  const complete = (polygon: Pt[], from: Pt) => {
    clear();
    if (polygon.length >= 3 && polygon.some((p) => Math.abs(p.x - from.x) * ctx.scale() >= 2) &&
      polygon.some((p) => Math.abs(p.y - from.y) * ctx.scale() >= 2)) finish(polygon, from);
    ctx.chrome(); ctx.request();
  };
  const closePolygon = () => { if (draft?.shape === 'polygon' && draft.path.length >= 3) complete(draft.path, draft.path[0]!); };
  function edges(): EdgeMap {
    const { page, art } = ctx;
    const scale = Math.min(ctx.book.dpi, 1100 / Math.max(page.widthIn, page.heightIn));
    const key = JSON.stringify([scale, page.cuts, art.revs, page.groups.map((g) => [g.id, g.anchor, g.mask, g.visible, g.opacity,
      g.layers.map((l) => [l.id, l.type, l.visible, l.opacity, l.overFrame, l.image])])]);
    if (edgeCache?.key === key) return edgeCache.map;
    const canvas = makeCanvas(Math.max(1, Math.round(page.widthIn * scale)), Math.max(1, Math.round(page.heightIn * scale)));
    const g = canvas.getContext('2d')!;
    renderPage(g, page, art, { scale, frame: false, balloons: false, types: { tone: false }, panels: ctx.panels() });
    const map = buildEdges(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, scale);
    edgeCache = { key, map };
    return map;
  }
  function magnetic(map: EdgeMap, path: Pt[], end: Pt): Pt[] {
    const closed = distance(path[0]!, end) < 18;
    return magneticPath(map, closed ? [...path, end, path[0]!] : [...path, end], 16 / ctx.scale());
  }
  return {
    active: () => !!draft,
    clear,
    down(p: Pt, shape: MarqueeShape) {
      if (draft?.shape === 'polygon' && shape === 'polygon') {
        if (draft.path.length >= 3 && distance(p, draft.path[0]!) < 12) closePolygon();
        else if (draft.path.length < 2048 && distance(p, draft.path.at(-1)!) > 2) { draft.path.push(p); draft.tip = p; ctx.chrome(); }
        return;
      }
      draft = { shape, path: [p], tip: p, ...(shape === 'magnetic' ? { map: edges() } : {}) };
      if (shape !== 'polygon') ctx.studio.drawing = true;
    },
    move(p: Pt) {
      if (!draft) return;
      draft.tip = p;
      if ((draft.shape === 'freehand' || draft.shape === 'magnetic') && distance(p, draft.path.at(-1)!) > 2) {
        if (draft.path.length >= 2048) draft.path = draft.path.filter((_, i) => i % 2 === 0);
        draft.path.push(p);
      }
    },
    up(p: Pt, cancelled: boolean) {
      if (!draft) return;
      if (cancelled) { clear(); ctx.chrome(); return; }
      const { path, shape, map } = draft;
      const from = path[0]!;
      if (shape === 'polygon') return;
      if ((shape === 'freehand' || shape === 'magnetic') && path.length < 2) { clear(); return; }
      const poly = map ? magnetic(map, path, p) : shape === 'freehand' ? [...path, p] : outline(from, p, shape);
      complete(poly, from);
    },
    hover(p: Pt) { if (draft?.shape === 'polygon') draft.tip = p; },
    closePolygon,
    controls() {
      if (draft?.shape !== 'polygon') return [];
      return [h('button', { class: 'btn primary', type: 'button', disabled: draft.path.length < 3, onclick: closePolygon }, 'Close polygon'),
        h('button', { class: 'btn', type: 'button', onclick: () => { clear(); ctx.chrome(); ctx.request(); } }, 'Cancel polygon')];
    },
    overlay(g: CanvasRenderingContext2D, scale: number) {
      if (!draft) return;
      const { shape, path, tip, map } = draft;
      const from = path[0]!;
      if (shape === 'polygon') {
        g.beginPath(); g.moveTo(from.x * scale, from.y * scale);
        [...path.slice(1), tip].forEach(({ x, y }) => g.lineTo(x * scale, y * scale)); g.stroke();
        g.beginPath(); g.arc(from.x * scale, from.y * scale, 5, 0, Math.PI * 2); g.stroke();
      } else {
        const poly = map ? magnetic(map, path, tip) : shape === 'freehand' ? [...path, tip] : outline(from, tip, shape);
        drawSelectionPath(g, poly, scale);
      }
    },
  };
}
