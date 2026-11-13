import { findLayer, groupOf, newGroup, newLayer, TYPE_RANK, type Layer, type LayerGroup, type LayerType, type Page, type Pt } from '../doc/model';
import { panelAt, pointInPoly, type Panel } from './carve';
import { inGutter } from './gutters';

/**
 * Panel groups follow the layout (EXPLORE-DESK-UI §2). A group stores an anchor point, never an
 * outline (rule 1): it belongs to the panel that holds its anchor. Pure, so it is unit-tested.
 */

/** Which panel each panel group belongs to (null: its anchor fell outside every panel). */
export function panelForGroup(panels: Panel[], group: LayerGroup): Panel | null {
  return group.anchor ? panels.find((p) => pointInPoly(group.anchor!, (p.source ?? p).pts)) ?? null : null;
}

export function groupPanels(page: Page, panels: Panel[]): Map<string, Panel | null> {
  const out = new Map<string, Panel | null>();
  for (const g of page.groups) if (g.kind === 'panel') out.set(g.id, panelForGroup(panels, g));
  return out;
}

/** The (first) panel group of a panel. */
export function groupForPanel(page: Page, panels: Panel[], panel: Panel): LayerGroup | null {
  return page.groups.find((g) => g.kind === 'panel' && panelForGroup(panels, g) === panel) ?? null;
}

/** A point well inside a panel (its centroid, or a point nudged inside for odd shapes). */
export function anchorFor(panel: Panel): Pt {
  if (pointInPoly(panel.centroid, panel.pts)) return { ...panel.centroid };
  const b = panel.bbox;
  for (let i = 1; i < 10; i++) {
    for (let j = 1; j < 10; j++) {
      const p = { x: b.x0 + ((b.x1 - b.x0) * i) / 10, y: b.y0 + ((b.y1 - b.y0) * j) / 10 };
      if (pointInPoly(p, panel.pts)) return p;
    }
  }
  return { ...panel.centroid };
}

/**
 * Make sure every panel has a group and the page has Background and Over-panels groups.
 * Empty panel groups that duplicate another group's panel, or whose panel is gone, are removed.
 * Groups that hold art are never removed: after an uncut, two groups can share a panel.
 * Panel groups are kept in reading order. Returns true when the page changed.
 */
export function syncGroups(page: Page, panels: Panel[]): boolean {
  const before = JSON.stringify(page.groups.map((g) => [g.id, g.kind]));
  groupOf(page, 'over');
  groupOf(page, 'gutter');
  groupOf(page, 'background');
  const claimed = new Set<Panel>();
  const keep: LayerGroup[] = [];
  for (const g of page.groups.filter((x) => x.kind === 'panel')) {
    const p = panelForGroup(panels, g);
    const empty = g.layers.every((l) => !l.image && !l.screenTone && !l.strokes.length && !l.fills.length);
    if (empty && (!p || claimed.has(p))) continue;
    if (p) claimed.add(p);
    keep.push(g);
  }
  for (const p of panels) if (!claimed.has(p)) keep.push(newGroup('panel', anchorFor(p.source ?? p)));
  const index = (g: LayerGroup) => panelForGroup(panels, g)?.index ?? 999;
  keep.sort((a, b) => index(a) - index(b));
  page.groups = [page.groups.find((g) => g.kind === 'over')!, page.groups.find((g) => g.kind === 'gutter')!, ...keep, page.groups.find((g) => g.kind === 'background')!];
  return JSON.stringify(page.groups.map((g) => [g.id, g.kind])) !== before;
}

/**
 * The group a stroke at `p` goes to: the Gutters group when it starts in a gutter band, else the
 * panel group under it, else Background.
 */
export function groupAt(page: Page, panels: Panel[], p: Pt): LayerGroup {
  const panel = panelAt(panels, p);
  if (!panel?.transform && panels.length > 1 && inGutter(page, p)) return groupOf(page, 'gutter');
  return (panel && groupForPanel(page, panels, panel)) || groupOf(page, 'background');
}

/** The topmost layer of a type in a group, or null. */
/** The group's first layer of a type: raster by default, or its vector layer. */
export function layerOfType(group: LayerGroup, type: LayerType, vector = false): Layer | null {
  return group.layers.find((l) => !l.image && !l.screenTone && l.type === type && !!l.vector === vector) ?? null;
}

/** Where a new layer of this type sits in the stack: above lower-ranked types. */
export function insertIndex(group: LayerGroup, type: LayerType): number {
  const i = group.layers.findIndex((l) => TYPE_RANK[l.type] < TYPE_RANK[type]);
  return i < 0 ? group.layers.length : i;
}

/** A display name for a group: its own name, its panel number and beat, or its kind. */
export function groupLabel(page: Page, panels: Panel[], g: LayerGroup): string {
  if (g.name) return g.name;
  if (g.kind === 'over') return 'Over panels';
  if (g.kind === 'background') return 'Background';
  if (g.kind === 'gutter') return 'Gutters';
  const p = panelForGroup(panels, g);
  if (!p) return 'Panel (off page)';
  const beat = page.beats[p.index]?.desc.trim();
  return beat ? `${p.index + 1} · ${beat.length > 22 ? `${beat.slice(0, 22)}…` : beat}` : `Panel ${p.index + 1}`;
}

/** The layers fills read their walls from: every visible fill-reference layer of the group and Background. */
export function fillRefLayers(page: Page, group: LayerGroup): Layer[] {
  const bg = groupOf(page, 'background');
  const groups = group === bg ? [bg] : [group, bg];
  return groups.flatMap((g) => g.layers.filter((l) => l.fillRef && l.visible));
}

export { findLayer, newLayer };
