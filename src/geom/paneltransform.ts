import type { Cut, Page, PageLayout, Pt } from '../doc/model';
import { cutPath, gutterPaths, layoutOf, shiftCut } from './carve';

type Shift = { axis: 'x' | 'y'; by: number };
const EPSILON = 1e-4;

function near(p: Pt, a: Pt, b: Pt): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const u = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy) <= EPSILON;
}

/** Intersection nearest the original endpoint, on the continuation of its final segment. */
function retarget(endpoint: Pt, inner: Pt, boundary: Pt[]): Pt {
  const ux = inner.x - endpoint.x;
  const uy = inner.y - endpoint.y;
  let best = endpoint;
  let distance = Infinity;
  for (let i = 1; i < boundary.length; i++) {
    const a = boundary[i - 1]!;
    const b = boundary[i]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-9) continue;
    const x = a.x - endpoint.x;
    const y = a.y - endpoint.y;
    const t = (x * vy - y * vx) / det;
    const u = (x * uy - y * ux) / det;
    if (u < -EPSILON || u > 1 + EPSILON || t >= 1 || Math.abs(t) >= distance) continue;
    best = { x: endpoint.x + t * ux, y: endpoint.y + t * uy };
    distance = Math.abs(t);
  }
  return best;
}

/** Move shared cuts and keep later panel-only cuts connected at their original junctions. */
export function movePanelCuts(page: Page, shifts: ReadonlyMap<string, Shift>, layout: PageLayout = layoutOf(page), replacements = new Map<string, Cut>()): Cut[] {
  const { widthIn: w, heightIn: h } = page;
  const trim = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, { x: 0, y: 0 }];
  const boundaries: { before: Pt[]; after: Pt[] }[] = [{ before: trim, after: trim }];
  const styledPage = { ...page, layout };
  return page.cuts.map((cut) => {
    const shift = shifts.get(cut.id);
    let next = replacements.get(cut.id) ?? (shift?.by ? shiftCut(cut, shift.axis, shift.by) : cut);
    const before = cut.extended;
    const after = next.extended;
    if (cut.mode === 'panel' && before && after && after.length >= 2) {
      const extended = after.slice();
      const last = extended.length - 1;
      for (const [endpoint, step] of [[0, 1], [last, -1]] as const) {
        const p = before[endpoint]!;
        const attached = boundaries.find((path) => path.before.slice(1).some((b, i) => near(p, path.before[i]!, b)));
        if (!attached || (attached.before === attached.after && next === cut)) continue;
        // The original endpoint can coincide with the first drawn point on an already straight cut.
        for (let i = endpoint + step; i >= 0 && i <= last; i += step) {
          const inner = after[i]!;
          if (Math.hypot(inner.x - after[endpoint]!.x, inner.y - after[endpoint]!.y) <= EPSILON) continue;
          extended[endpoint] = retarget(after[endpoint]!, inner, attached.after);
          break;
        }
      }
      if (extended[0] !== after[0] || extended[last] !== after[last]) next = { ...next, extended };
    }
    const path = cutPath(cut, page);
    const sameShape = next === cut && ((cut.mode === 'panel' && cut.extended) || cut.pts.length === 2 || layoutOf(page).curve === layout.curve);
    boundaries.unshift({ before: path, after: sameShape ? path : cutPath(next, styledPage) });
    return next;
  });
}

/** Each cut should keep the same number of shared boundaries during a reshape. */
export function sameGutterTopology(before: Page, after: Page): boolean {
  const counts = new Map<string, number>();
  for (const { cut } of gutterPaths(before)) counts.set(cut.id, (counts.get(cut.id) ?? 0) + 1);
  for (const { cut } of gutterPaths(after)) counts.set(cut.id, (counts.get(cut.id) ?? 0) - 1);
  return [...counts.values()].every((n) => n === 0);
}
