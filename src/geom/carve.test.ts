import { describe, expect, it } from 'vitest';
import { area, canEvenOut, cutsForCount, derivePanels, evenOut, gutterPaths, makeCut, nearestCut, panelAt, planKnifeCut, presetCuts, shiftCut, sourcePanelAt } from './carve';
import { gutterMask, inGutter } from './gutters';
import { newPage, type Page, type Pt } from '../doc/model';

const W = 6.625;
const H = 10.187;
const PAGE_AREA = W * H;

function page(): Page {
  return newPage(0);
}

const total = (p: Page) => derivePanels(p).reduce((s, q) => s + Math.abs(area(q.pts)), 0);

/** No two non-adjacent edges of a polygon cross. */
function simple(poly: Pt[]): boolean {
  const n = poly.length;
  const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (cross(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return false;
  }
  return true;
}

function cut(p: Page, pts: Pt[], mode: 'across' | 'panel' = 'across', straight = false) {
  const c = makeCut(p, pts, mode, straight);
  if (c) p.cuts.push(c);
  return c;
}

describe('carving', () => {
  it('keeps panel ownership at the source while hit testing overlap in stack order', () => {
    const p = page();
    p.cuts = presetCuts(p, 'rows2');
    p.layout = { ...p.layout!, panelTransforms: [
      { at: { x: .5, y: .25 }, matrix: [1.1, 0, 0, 1, 0, H / 2], order: 2 },
      { at: { x: .5, y: .75 }, matrix: [1, 0, 0, 1, 0, 0], order: -1 },
    ] };
    const [top, bottom] = derivePanels(p);
    const overlap = { x: W / 2, y: H * .75 };
    expect(top?.bbox.x1).toBeGreaterThan(W);
    expect(panelAt([top!, bottom!], overlap)).toBe(top);
    expect(sourcePanelAt([top!, bottom!], overlap)).toBe(bottom);
    expect(panelAt([top!, bottom!], { x: W / 2, y: H * .25 })).toBeNull();
  });

  it('requires both ends of a page swipe to be beyond the trim and uses the actual gesture', () => {
    const p = page();
    expect(planKnifeCut(p, [{ x: 1, y: 4 }, { x: W + 1, y: 4 }], 'across')).toBeNull();
    expect(planKnifeCut(p, [{ x: -1, y: 4 }, { x: W - 1, y: 4 }], 'across')).toBeNull();
    const plan = planKnifeCut(p, [{ x: -0.25, y: 4 }, { x: W + 0.25, y: 4 }], 'across');
    expect(plan?.cut.bounded).toBe(true);
    p.cuts.push({ id: 'swipe', ...plan!.cut });
    expect(derivePanels(p)).toHaveLength(2);
    expect(gutterPaths(p)[0]!.points.at(-1)!.x).toBeCloseTo(W);
  });

  it('one panel freezes only the first complete span entered from outside', () => {
    const p = page();
    p.cuts = presetCuts(p, 'rows2');
    const plan = planKnifeCut(p, [{ x: 3, y: -1 }, { x: 3, y: H + 1 }], 'panel');
    expect(plan?.paths[0]?.at(-1)?.y).toBeCloseTo(H / 2);
    p.cuts.push({ id: 'one', ...plan!.cut });
    expect(derivePanels(p)).toHaveLength(3);
  });
  it('stacks every webtoon beat in one column', () => {
    const p = { ...newPage(), widthIn: 8, heightIn: 32 };
    p.cuts = cutsForCount(p, 4, true);
    expect(p.cuts).toHaveLength(3);
    expect(derivePanels(p).map(({ bbox }) => bbox.x1 - bbox.x0)).toEqual([8, 8, 8, 8]);
  });

  it('keeps a cubic edge shared by two panels', () => {
    const p = { ...newPage(), widthIn: 8, heightIn: 32 };
    const [cut] = cutsForCount(p, 2, true);
    p.cuts = [{ ...cut!, handles: [{ x: 8 / 3, y: 13 }, { x: 16 / 3, y: 13 }] }];
    expect(derivePanels(p)).toHaveLength(2);
    expect(gutterPaths(p)[0]!.points.some((q) => q.y < 15)).toBe(true);
  });
  it('an uncut page is one panel, the whole trim', () => {
    const ps = derivePanels(page());
    expect(ps).toHaveLength(1);
    expect(Math.abs(area(ps[0]!.pts))).toBeCloseTo(PAGE_AREA, 3);
  });

  it('a straight line splits the rectangle in two, areas sum to the page', () => {
    const p = page();
    expect(cut(p, [{ x: 0.5, y: 5 }, { x: 6, y: 5 }])).not.toBeNull();
    const ps = derivePanels(p);
    expect(ps).toHaveLength(2);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
    // a short stroke inside the page still cuts trim to trim
    expect(ps[0]!.bbox.x0).toBeCloseTo(0, 3);
    expect(ps[0]!.bbox.x1).toBeCloseTo(W, 3);
    for (const q of ps) expect(simple(q.pts)).toBe(true);
  });

  it('a curved stroke splits into two simple polygons', () => {
    const p = page();
    const curve: Pt[] = [];
    for (let i = 0; i <= 20; i++) curve.push({ x: 0.2 + (i / 20) * 6.2, y: 4 + Math.sin((i / 20) * Math.PI) * 1.5 });
    cut(p, curve);
    const ps = derivePanels(p);
    expect(ps).toHaveLength(2);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
    for (const q of ps) expect(simple(q.pts)).toBe(true);
  });

  it('two crossing cuts make four panels in reading order', () => {
    const p = page();
    cut(p, [{ x: 0, y: H / 2 }, { x: W, y: H / 2 }]);
    cut(p, [{ x: W / 2, y: 0 }, { x: W / 2, y: H }]);
    const ps = derivePanels(p);
    expect(ps).toHaveLength(4);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
    // top-left, top-right, bottom-left, bottom-right
    expect(ps[0]!.centroid.x).toBeLessThan(W / 2);
    expect(ps[0]!.centroid.y).toBeLessThan(H / 2);
    expect(ps[1]!.centroid.x).toBeGreaterThan(W / 2);
    expect(ps[2]!.centroid.y).toBeGreaterThan(H / 2);
  });

  it('a panel-mode cut splits only the panel it crosses', () => {
    const p = page();
    cut(p, [{ x: 0, y: H / 2 }, { x: W, y: H / 2 }]);
    const c = cut(p, [{ x: W / 2, y: 1 }, { x: W / 2, y: 4 }], 'panel');
    expect(c?.extended).toBeDefined();
    const ps = derivePanels(p);
    expect(ps).toHaveLength(3); // top split in two, bottom untouched
    const bottom = ps.filter((q) => q.centroid.y > H / 2);
    expect(bottom).toHaveLength(1);
    expect(bottom[0]!.bbox.x1 - bottom[0]!.bbox.x0).toBeCloseTo(W, 2);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
  });

  it('stops Panel only at the first gutter even when the pointer enters another panel', () => {
    const p = page();
    cut(p, [{ x: 0, y: 4 }, { x: W, y: 4 }]);
    const knife = cut(p, [{ x: 3, y: 1 }, { x: 3, y: 8 }], 'panel', true)!;
    expect(knife.extended!.at(-1)!.y).toBeCloseTo(4);
    expect(derivePanels(p)).toHaveLength(3);
    expect(inGutter(p, { x: 3, y: 2 })).toBe(true);
    expect(inGutter(p, { x: 3, y: 6 })).toBe(false);
  });

  it('hides old gutter tails and unused cuts in the renderer, hit tests, and fill mask', () => {
    const p = page();
    cut(p, [{ x: 0, y: 4 }, { x: W, y: 4 }]);
    const tail = [{ x: 2, y: 0 }, { x: 2.2, y: 3 }, { x: 2.4, y: 7 }];
    const orphan = [{ x: 4, y: 6 }, { x: 4, y: 8 }];
    p.cuts.push({ id: 'old-tail', mode: 'panel', pts: tail, extended: tail }, { id: 'old-orphan', mode: 'panel', pts: orphan, extended: orphan });
    const paths = gutterPaths(p);
    expect(paths).toHaveLength(2);
    expect(paths.find(({ cut }) => cut.id === 'old-tail')!.points.at(-1)!.y).toBeCloseTo(4);
    expect(nearestCut(p, { x: 4, y: 7 })!.d).toBeGreaterThan(2);
    const dpi = 20;
    const width = Math.ceil(W * dpi);
    const mask = gutterMask(p, dpi, width, Math.ceil(H * dpi));
    expect(mask[2 * dpi * width + 2.15 * dpi]).toBe(1);
    expect(mask[6 * dpi * width + 2.35 * dpi]).toBe(0);
    expect(mask[7 * dpi * width + 4 * dpi]).toBe(0);
    expect(derivePanels(p)).toHaveLength(3);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 3);
    expect(canEvenOut(p)).toBe(false);
    expect(evenOut(p)).toBe(p.cuts);
  });

  it('splits separate interior spans without connecting them outside the panel', () => {
    const p = page();
    p.layout = { gutter: 0.2, border: 0.03, curve: 0 };
    expect(cut(p, [{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: -1, y: 2 },
      { x: -1, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 0, y: 5 }])).not.toBeNull();
    expect(gutterPaths(p)).toHaveLength(2);
    const panels = derivePanels(p);
    expect(panels).toHaveLength(3);
    for (const panel of panels) expect(simple(panel.pts)).toBe(true);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 3);
    expect(inGutter(p, { x: 0.05, y: 3 })).toBe(false);
  });

  it('the same stroke in across mode splits both panels', () => {
    const p = page();
    cut(p, [{ x: 0, y: H / 2 }, { x: W, y: H / 2 }]);
    cut(p, [{ x: W / 2, y: 1 }, { x: W / 2, y: 4 }], 'across');
    expect(derivePanels(p)).toHaveLength(4);
  });

  it('a stroke that splits nothing is refused', () => {
    const p = page();
    expect(makeCut(p, [{ x: 1, y: 1 }, { x: 1.05, y: 1.02 }], 'across')).toBeNull(); // too small
    cut(p, [{ x: 0, y: 5 }, { x: W, y: 5 }]);
    expect(makeCut(p, [{ x: 0, y: 5 }, { x: W, y: 5 }], 'across')).toBeNull(); // on top of an existing cut
  });

  it('moving a cut re-derives every panel on it, the page stays tiled', () => {
    const p = page();
    cut(p, [{ x: 0, y: H / 2 }, { x: W, y: H / 2 }]);
    cut(p, [{ x: W / 2, y: 0 }, { x: W / 2, y: H }]);
    p.cuts[0] = shiftCut(p.cuts[0]!, 'y', 1);
    const ps = derivePanels(p);
    expect(ps).toHaveLength(4);
    expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
    expect(ps[0]!.bbox.y1).toBeCloseTo(H / 2 + 1, 2);
    expect(ps[1]!.bbox.y1).toBeCloseTo(H / 2 + 1, 2);
  });

  it('presets seed the classic grids', () => {
    for (const [preset, n] of [['splash', 1], ['rows2', 2], ['tier3', 3], ['grid4', 4], ['grid6', 6], ['grid9', 9]] as const) {
      const p = page();
      p.cuts = presetCuts(p, preset);
      expect(derivePanels(p)).toHaveLength(n);
      expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
    }
  });

  it('beats become panels: n beats give n panels (Script → Layout, M1 done-when)', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const p = page();
      p.cuts = cutsForCount(p, n);
      expect(derivePanels(p)).toHaveLength(n);
      expect(total(p)).toBeCloseTo(PAGE_AREA, 2);
    }
  });

  it('even out spaces cuts evenly', () => {
    const p = page();
    cut(p, [{ x: 0, y: 1 }, { x: W, y: 1 }]);
    cut(p, [{ x: 0, y: 2 }, { x: W, y: 2 }]);
    p.cuts = evenOut(p);
    const tops = derivePanels(p).map((q) => q.bbox.y1 - q.bbox.y0);
    for (const t of tops) expect(t).toBeCloseTo(H / 3, 1);
  });

  it('hit tests find the panel under a point and the nearest cut', () => {
    const p = page();
    cut(p, [{ x: 0, y: H / 2 }, { x: W, y: H / 2 }]);
    const ps = derivePanels(p);
    expect(panelAt(ps, { x: 1, y: 1 })?.index).toBe(0);
    expect(panelAt(ps, { x: 1, y: H - 1 })?.index).toBe(1);
    const near = nearestCut(p, { x: 2, y: H / 2 + 0.1 });
    expect(near?.d).toBeCloseTo(0.1, 3);
    expect(Math.abs(near!.n.y)).toBeCloseTo(1, 3);
  });
});
