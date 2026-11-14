import type { Cut, ModularGrid, Page, PageLayout, PanelTransform, Pt } from '../doc/model';
import { derivePanels, layoutOf, newCutId, panelAt, planKnifeCut, pointInPoly } from './carve';

export interface PageTemplate {
  name: string;
  /** The Layout bin it is sorted into (absent = Unsorted). */
  bin?: string;
  cuts: Omit<Cut, 'id'>[];
  layout: PageLayout;
  size?: { w: number; h: number };
  grid?: ModularGrid;
  downbeat?: Pt;
}

export function capturePageTemplate(page: Page, name: string): PageTemplate {
  const relative = (p: Pt) => ({ x: p.x / page.widthIn, y: p.y / page.heightIn });
  return {
    name,
    cuts: page.cuts.map(({ id: _id, ...c }) => ({ ...c, pts: c.pts.map(relative), ...(c.extended ? { extended: c.extended.map(relative) } : {}), ...(c.handles ? { handles: [relative(c.handles[0]), relative(c.handles[1])] } : {}) })),
    layout: structuredClone(layoutOf(page)),
    size: { w: page.widthIn, h: page.heightIn },
    grid: structuredClone(page.grid),
    downbeat: page.downbeat && { ...page.downbeat },
  };
}

export function applyPageTemplate(page: Page, template: PageTemplate): void {
  const absolute = (p: Pt) => ({ x: p.x * page.widthIn, y: p.y * page.heightIn });
  page.cuts = template.cuts.map((c) => ({ ...c, id: newCutId(), pts: c.pts.map(absolute), ...(c.extended ? { extended: c.extended.map(absolute) } : {}), ...(c.handles ? { handles: [absolute(c.handles[0]), absolute(c.handles[1])] } : {}) }));
  page.layout = structuredClone(template.layout);
  if (template.size && page.layout.panelTransforms) {
    page.layout.panelTransforms = scalePanelTransforms(page.layout.panelTransforms, page.widthIn / template.size.w, page.heightIn / template.size.h);
  }
  page.grid = structuredClone(template.grid);
  page.downbeat = template.downbeat && { ...template.downbeat };
}

/** Express page-inch transforms in the resized page's coordinates. */
export function scalePanelTransforms(placements: PanelTransform[], sx: number, sy: number): PanelTransform[] {
  return placements.map(({ at, matrix: [a, b, c, d, x, y], order }) => ({
    at, matrix: [a, b * sy / sx, c * sx / sy, d, x * sx, y * sy], order,
  }));
}

/**
 * Split one panel with a template's cuts, scaled into that panel's box (Layout bins: drop a
 * layout onto a panel). Each template line cuts every piece of the original panel it crosses,
 * so a grid dropped on a panel becomes a grid inside it. Returns the new cuts, or null when the
 * point is not in an unmoved panel or nothing would be cut.
 */
export function splitPanelCuts(page: Page, at: Pt, template: PageTemplate): Cut[] | null {
  const target = panelAt(derivePanels(page), at);
  if (!target || target.transform) return null;
  const b = target.bbox, w = b.x1 - b.x0, hgt = b.y1 - b.y0;
  const work: Page = { ...page, cuts: [...page.cuts] };
  const added: Cut[] = [];
  for (const c of template.cuts) {
    const pts = c.pts.map((p) => ({ x: b.x0 + p.x * w, y: b.y0 + p.y * hgt }));
    if (pts.length < 2) continue;
    // run each end on past the panel's edge so the knife reads it as crossing the panel
    const reach = Math.max(w, hgt);
    const out = (end: Pt, from: Pt) => { const d = Math.hypot(end.x - from.x, end.y - from.y) || 1; return { x: end.x + (end.x - from.x) / d * reach, y: end.y + (end.y - from.y) / d * reach }; };
    const stroke = [out(pts[0]!, pts[1]!), ...pts, out(pts.at(-1)!, pts.at(-2)!)];
    const pieces = derivePanels(work).filter((q) => !q.transform && pointInPoly(q.centroid, target.pts));
    for (const q of pieces) {
      const plan = planKnifeCut(work, stroke, 'panel', true, q.centroid);
      if (!plan) continue;
      const cut: Cut = { id: newCutId(), ...plan.cut };
      work.cuts.push(cut);
      added.push(cut);
    }
  }
  return added.length ? added : null;
}
