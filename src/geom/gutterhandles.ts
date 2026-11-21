import type { Cut, Page, Pt } from '../doc/model';
import { gutterPaths, type Panel } from './carve';

/**
 * Resize handles for one panel: a handle on every gutter the panel actually shares, wherever that
 * gutter runs. A panel bounded by an angled, curved or zig-zag cut has no side whose bounding-box
 * midpoint sits on the cut, so handles are found on the shared edge itself. Pure.
 */

export type HandleSide = 'n' | 's' | 'e' | 'w';

export interface PanelHandle {
  side: HandleSide;
  axis: 'x' | 'y';
  /** On the gutter (inches). */
  at: Pt;
  cut: Cut;
}

/** How far a gutter point may sit from the panel's outline and still count as shared (inches). */
const EDGE_TOL = 0.01;
/** Shared edge shorter than this gets no handle (a corner touch, not a gutter), inches. */
const MIN_RUN = 0.25;

/** The part of segment a-b (as 0..1 along it) that runs along the polygon edge c-d, if any. */
function overlapOnEdge(a: Pt, b: Pt, c: Pt, d: Pt): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return null;
  const len = Math.sqrt(l2);
  const off = (p: Pt) => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  if (off(c) > EDGE_TOL || off(d) > EDGE_TOL) return null;
  const along = (p: Pt) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  const t0 = Math.max(0, Math.min(along(c), along(d)));
  const t1 = Math.min(1, Math.max(along(c), along(d)));
  return t1 - t0 > 1e-6 ? [t0, t1] : null;
}

/** The pieces of segment a-b that lie on the polygon's outline, in order along a-b. */
function sharedPieces(a: Pt, b: Pt, outline: readonly Pt[]): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < outline.length; i++) {
    const o = overlapOnEdge(a, b, outline[i]!, outline[(i + 1) % outline.length]!);
    if (o) spans.push(o);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function panelHandles(page: Page, panel: Pick<Panel, 'pts' | 'centroid'>): PanelHandle[] {
  const found: (PanelHandle & { length: number })[] = [];
  for (const { cut, points } of gutterPaths(page)) {
    // consecutive stretches of this gutter that lie on the panel's outline
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    const close = () => { if (run.length > 1) runs.push(run); run = []; };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      for (const [t0, t1] of sharedPieces(a, b, panel.pts)) {
        const from = lerp(a, b, t0);
        const to = lerp(a, b, t1);
        const last = run[run.length - 1];
        if (last && Math.hypot(from.x - last.x, from.y - last.y) > EDGE_TOL) close();
        if (!run.length) run.push(from);
        run.push(to);
      }
      // a segment that is not fully shared ends the run
      const pieces = sharedPieces(a, b, panel.pts);
      if (!pieces.length || pieces[pieces.length - 1]![1] < 1 - 1e-6) close();
    }
    close();
    let best: { run: Pt[]; length: number } | null = null;
    for (const r of runs) {
      let length = 0;
      for (let i = 1; i < r.length; i++) length += Math.hypot(r[i]!.x - r[i - 1]!.x, r[i]!.y - r[i - 1]!.y);
      if (length >= MIN_RUN && (!best || length > best.length)) best = { run: r, length };
    }
    if (!best) continue;
    // the point halfway along the shared edge, and the way that edge faces
    let left = best.length / 2;
    for (let i = 1; i < best.run.length; i++) {
      const a = best.run[i - 1]!;
      const b = best.run[i]!;
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (left > seg && i < best.run.length - 1) { left -= seg; continue; }
      const t = seg ? Math.min(1, left / seg) : 0;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const nx = -(b.y - a.y) / (seg || 1);
      const ny = (b.x - a.x) / (seg || 1);
      const axis = Math.abs(nx) >= Math.abs(ny) ? 'x' : 'y';
      const side: HandleSide = axis === 'x' ? (at.x < panel.centroid.x ? 'w' : 'e') : (at.y < panel.centroid.y ? 'n' : 's');
      found.push({ side, axis, at, cut, length: best.length });
      break;
    }
  }
  // one handle per cut and side: the longer shared edge wins
  const out: (PanelHandle & { length: number })[] = [];
  for (const h of found) {
    const same = out.findIndex((o) => o.cut.id === h.cut.id && o.side === h.side);
    if (same < 0) out.push(h);
    else if (h.length > out[same]!.length) out[same] = h;
  }
  return out.map(({ length: _length, ...handle }) => handle);
}
