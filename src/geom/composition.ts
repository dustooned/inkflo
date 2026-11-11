import type { Book, ModularGrid, Page, Pt } from '../doc/model';
import { cutPath, derivePanels, makeCut, newCutId, panelAt, type Panel } from './carve';
import { printOf, readerSpreads } from './printkinds';

export const GUIDES = [
  { id: 'off', label: 'Off' },
  { id: 'centre', label: 'Centre and diagonals' },
  { id: 'rabatment', label: 'Rabatment squares' },
  { id: 'full', label: 'Full construction' },
  { id: 'thirds', label: 'Thirds' },
  { id: 'golden', label: 'Golden section' },
] as const;
export type Guide = typeof GUIDES[number]['id'];
type Line = [Pt, Pt];

export function construction(kind: Guide, w: number, h: number) {
  const lines: Line[] = [];
  const circles: { x: number; y: number; r: number }[] = [];
  const line = (x: number, y: number, x2: number, y2: number) => lines.push([{ x, y }, { x: x2, y: y2 }]);
  const diagonals = (x: number, y: number, a: number, b: number) => {
    line(x, y, x + a, y + b);
    line(x, y + b, x + a, y);
  };
  if (kind === 'centre' || kind === 'full') {
    diagonals(0, 0, w, h);
    line(w / 2, 0, w / 2, h);
    line(0, h / 2, w, h / 2);
  }
  if (kind === 'rabatment' || kind === 'full') {
    const a = Math.min(w, h);
    const squares: [number, number][] = w === h ? [[0, 0]] : w > h ? [[0, 0], [w - a, 0]] : [[0, 0], [0, h - a]];
    for (const [x, y] of squares) {
      diagonals(x, y, a, a);
      if (w > h) line(x === 0 ? a : x, 0, x === 0 ? a : x, h);
      if (h > w) line(0, y === 0 ? a : y, w, y === 0 ? a : y);
      circles.push({ x: x + a / 2, y: y + a / 2, r: a / 2 });
    }
    if (kind === 'full') {
      if (w !== h) circles.push({ x: w / 2, y: h / 2, r: a / 2 });
      for (const x of [0, w]) for (const y of [0, h]) circles.push({ x, y, r: a });
    }
  }
  if (kind === 'thirds' || kind === 'golden') {
    const f = kind === 'thirds' ? 1 / 3 : (3 - Math.sqrt(5)) / 2;
    for (const t of [f, 1 - f]) {
      line(t * w, 0, t * w, h);
      line(0, t * h, w, t * h);
    }
  }
  return { lines, circles };
}

export function nearestGuide(kind: Guide, w: number, h: number, p: Pt, tolerance: number) {
  let best: { point: Pt; angle: number } | undefined;
  for (const [a, b] of construction(kind, w, h).lines) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    if (t < 0 || t > 1) continue;
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d < tolerance) {
      best = { point, angle: Math.atan2(dy, dx) * 180 / Math.PI };
      tolerance = d;
    }
  }
  return best;
}

export const DEFAULT_GRID: ModularGrid = { columns: [1, 1], rows: [1, 1, 1], gutter: 0.16 };

export function gridLines(page: Page, grid: ModularGrid) {
  const divisions = (weights: number[], size: number) => {
    const total = weights.reduce((a, b) => a + b, 0);
    let sum = 0;
    return weights.slice(0, -1).map((n) => size * (sum += n) / total);
  };
  return { x: divisions(grid.columns, page.widthIn), y: divisions(grid.rows, page.heightIn) };
}

export function gridCuts(page: Page, grid: ModularGrid): Page['cuts'] {
  const { x, y } = gridLines(page, grid);
  return [
    ...y.map((v) => [{ x: 0, y: v }, { x: page.widthIn, y: v }]),
    ...x.map((v) => [{ x: v, y: 0 }, { x: v, y: page.heightIn }]),
  ].map((pts) => ({ id: newCutId(), mode: 'across', pts }));
}

export function snapGridCut(page: Page, grid: ModularGrid, points: Pt[], tolerance: number): Pt[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || Math.hypot(last.x - first.x, last.y - first.y) < 2 * tolerance) return points;
  const axis = Math.abs(last.x - first.x) < Math.abs(last.y - first.y) ? 'x' : 'y';
  const target = gridLines(page, grid)[axis].find((v) => points.every((p) => Math.abs(p[axis] - v) <= tolerance));
  return target === undefined ? points : [{ ...first, [axis]: target }, { ...last, [axis]: target }];
}

export function downbeatPanel(page: Page, panels: Panel[]) {
  const a = page.downbeat;
  return a ? panelAt(panels, { x: a.x * page.widthIn, y: a.y * page.heightIn }) : null;
}

/** Flag two cut segments meeting close to the trim centre in different directions. */
export function centreCrossing(page: Page): boolean {
  const x = page.widthIn / 2;
  const y = page.heightIn / 2;
  const tolerance = Math.min(x, y) * 0.04;
  const near: { angle: number; id: string }[] = [];
  for (const c of page.cuts) {
    const path = cutPath(c, page);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      if (!length) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
      if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) > tolerance) continue;
      const angle = Math.atan2(dy, dx);
      if (near.some((n) => n.id !== c.id && Math.abs(Math.sin(n.angle - angle)) > 0.7)) return true;
      near.push({ angle, id: c.id });
    }
  }
  return false;
}

/** Stagger a simple four-panel cross without changing the order or number of panels. */
export function staggerCentre(page: Page): Page['cuts'] | undefined {
  if (page.cuts.length !== 2 || !centreCrossing(page)) return;
  const [a, b] = page.cuts;
  const axis = (c: Page['cuts'][number]) => c.mode !== 'across' || c.pts.length !== 2 ? '' :
    Math.abs(c.pts[0]!.y - c.pts[1]!.y) < 0.001 ? 'h' :
      Math.abs(c.pts[0]!.x - c.pts[1]!.x) < 0.001 ? 'v' : '';
  const h = axis(a!) === 'h' ? a! : b!;
  const v = h === a ? b! : a!;
  if (axis(h) !== 'h' || axis(v) !== 'v') return;
  const middle = h.pts[0]!.y;
  const x = v.pts[0]!.x;
  const offset = page.widthIn * 0.08;
  const cuts = [h];
  for (const [start, end, dx] of [[0, middle, -offset], [middle, page.heightIn, offset]] as const) {
    const y = start + (end - start) * 0.25;
    const cut = makeCut({ ...page, cuts }, [{ x: x + dx, y }, { x: x + dx, y: end - (end - start) * 0.25 }], 'panel', true);
    if (!cut) return;
    cuts.push(cut);
  }
  return derivePanels({ ...page, cuts }).length === 4 ? cuts : undefined;
}

export function revealIssues(book: Book, page: Page, panels: Panel[]): { index: number; text: string }[] {
  const pageIndex = book.pages.indexOf(page);
  const spec = printOf(book);
  const spreads = readerSpreads(book.pages.length, spec.rtl);
  const spreadIndex = spreads.findIndex((pair) => pair.includes(pageIndex));
  return page.beats.flatMap((beat, index) => {
    if (!beat.reveal) return [];
    const issue = (text: string) => [{ index, text: 'Reveal in beat ' + (index + 1) + ' ' + text }];
    const setupIndex = book.pages.findIndex((p) => p.id === beat.reveal!.pageId);
    const setupPage = book.pages[setupIndex];
    const setupBeat = setupPage?.beats.findIndex((b) => b.id === beat.reveal!.beatId) ?? -1;
    if (setupBeat < 0) return issue('has a missing setup.');
    if (setupIndex > pageIndex || (setupIndex === pageIndex && setupBeat >= index)) return issue('comes before its setup.');
    if (spec.binding === 'web') {
      const setupY = (setupPage === page ? panels : derivePanels(setupPage!))[setupBeat]?.bbox.y0 ?? 0;
      const revealY = panels[index]?.bbox.y0 ?? 0;
      const distance = book.pages.slice(setupIndex, pageIndex).reduce((sum, p) => sum + p.heightIn, 0) + revealY - setupY;
      return distance < page.widthIn * 16 / 9 ? issue('is less than an estimated phone screen after its setup.') : [];
    }
    if (spreads[spreadIndex]?.includes(setupIndex)) return issue('shares a spread with its setup. Try the next spread.');
    if (spreads[spreadIndex]?.[spec.rtl ? 1 : 0] === pageIndex) return issue('starts on the first-read side of a spread. Check the page turn in Spread preview.');
    return [];
  });
}
