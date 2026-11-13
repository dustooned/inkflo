import type { Cut, ModularGrid, Page, PageLayout, Pt } from '../doc/model';
import { layoutOf, newCutId } from './carve';

export interface PageTemplate {
  name: string;
  cuts: Omit<Cut, 'id'>[];
  layout: PageLayout;
  grid?: ModularGrid;
  downbeat?: Pt;
}

export function capturePageTemplate(page: Page, name: string): PageTemplate {
  const relative = (p: Pt) => ({ x: p.x / page.widthIn, y: p.y / page.heightIn });
  return {
    name,
    cuts: page.cuts.map(({ id: _id, ...c }) => ({ ...c, pts: c.pts.map(relative), ...(c.extended ? { extended: c.extended.map(relative) } : {}), ...(c.handles ? { handles: [relative(c.handles[0]), relative(c.handles[1])] } : {}) })),
    layout: { ...layoutOf(page) },
    grid: structuredClone(page.grid),
    downbeat: page.downbeat && { ...page.downbeat },
  };
}

export function applyPageTemplate(page: Page, template: PageTemplate): void {
  const absolute = (p: Pt) => ({ x: p.x * page.widthIn, y: p.y * page.heightIn });
  page.cuts = template.cuts.map((c) => ({ ...c, id: newCutId(), pts: c.pts.map(absolute), ...(c.extended ? { extended: c.extended.map(absolute) } : {}), ...(c.handles ? { handles: [absolute(c.handles[0]), absolute(c.handles[1])] } : {}) }));
  page.layout = { ...template.layout };
  page.grid = structuredClone(template.grid);
  page.downbeat = template.downbeat && { ...template.downbeat };
}
