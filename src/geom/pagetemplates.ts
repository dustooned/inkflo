import type { Cut, ModularGrid, Page, PageLayout, PanelTransform, Pt } from '../doc/model';
import { layoutOf, newCutId } from './carve';

export interface PageTemplate {
  name: string;
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
