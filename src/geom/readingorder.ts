import type { Beat, Page, PageLayout, Pt } from '../doc/model';
import { derivePanels, layoutOf, pointInPoly, type Panel } from './carve';
import { anchorFor } from './groups';

/**
 * Setting the reading order by hand. Script beats belong to panels by reading position
 * (`beats[i]` is panel i), so when the order changes the beats move with their panels: each
 * panel keeps its own beat. Everything else on a page is anchored by points and needs nothing.
 */

const sourceOf = (p: Panel) => p.source ?? p;
const rel = (page: Page, q: Pt): Pt => ({ x: q.x / page.widthIn, y: q.y / page.heightIn });

/** The stored order for these panels, first read first (points inside the unmoved panels). */
export function orderPoints(page: Page, panels: Panel[]): Pt[] {
  return panels.map((p) => rel(page, anchorFor(sourceOf(p) as Panel)));
}

/** Beats rearranged so each stays with its panel under `nextLayout`. Extra beats stay at the end. */
export function beatsFollowing(page: Page, nextLayout: PageLayout): Beat[] {
  const before = derivePanels(page);
  const after = derivePanels({ ...page, layout: nextLayout });
  const used = new Set<number>();
  const out: Beat[] = [];
  for (const q of after) {
    const at = anchorFor(sourceOf(q) as Panel);
    const old = before.find((o) => !used.has(o.index) && pointInPoly(at, sourceOf(o).pts));
    if (!old) continue;
    used.add(old.index);
    const beat = page.beats[old.index];
    if (beat) out.push(beat);
  }
  // beats whose panel wasn't matched, and beats past the last panel, keep their order after
  page.beats.forEach((b, i) => { if (!used.has(i) || i >= before.length) if (!out.includes(b)) out.push(b); });
  return out;
}

/** The layout with this order (or with no hand-set order when `points` is null). */
export function layoutWithOrder(page: Page, points: Pt[] | null): PageLayout {
  const L = { ...layoutOf(page) };
  if (points?.length) L.order = points.map((p) => ({ ...p }));
  else delete L.order;
  return L;
}
