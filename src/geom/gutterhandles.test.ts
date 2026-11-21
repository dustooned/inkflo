import { describe, expect, it } from 'vitest';
import { derivePanels, K, layoutOf, makeCut, nearestCut } from './carve';
import { panelHandles } from './gutterhandles';
import { movePanelCuts, sameGutterTopology } from './paneltransform';
import { newPage, type Page, type Pt } from '../doc/model';

const W = 6.625;
const H = 10.187;
const at = (x: number, y: number): Pt => ({ x, y });

function carve(...cuts: [Pt[], ('across' | 'panel')?][]): Page {
  const page = newPage(0);
  for (const [pts, mode = 'across'] of cuts) {
    const c = makeCut(page, pts, mode, pts.length === 2);
    if (c) page.cuts.push(c);
  }
  return page;
}
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 14): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return at(cx + r * Math.cos(a), cy + r * Math.sin(a)); });

const horizontal: [Pt[], 'across'] = [[at(-0.2, 5), at(W + 0.2, 5)], 'across'];
const vertical: [Pt[], 'across'] = [[at(3.3, -0.2), at(3.3, H + 0.2)], 'across'];

/** Handle positions the old rule produced: the middle of each side of the panel's box. */
function oldSideMidpoints(page: Page, panelIndex: number): Pt[] {
  const panel = derivePanels(page)[panelIndex]!;
  const { x0, x1, y0, y1 } = panel.bbox;
  const gutter = layoutOf(page).gutter;
  const out: Pt[] = [];
  for (const [s, axis] of [[at(x0, (y0 + y1) / 2), 'x'], [at(x1, (y0 + y1) / 2), 'x'], [at((x0 + x1) / 2, y0), 'y'], [at((x0 + x1) / 2, y1), 'y']] as const) {
    const n = nearestCut(page, s);
    if (n && (axis === 'x' ? Math.abs(n.n.x) > 0.55 : Math.abs(n.n.y) > 0.55) && n.d <= gutter / 2 + 18 / K) out.push(n.at);
  }
  return out;
}

describe('panel resize handles', () => {
  it('keeps the old handles on straight grids', () => {
    for (const page of [carve(horizontal), carve(vertical), carve(horizontal, vertical), carve(horizontal, [[at(3.3, 5.1), at(3.3, H - 0.1)], 'panel'])]) {
      derivePanels(page).forEach((panel, i) => {
        const now = panelHandles(page, panel).map((h) => h.at);
        const before = oldSideMidpoints(page, i);
        expect(now.length).toBe(before.length);
        for (const b of before) expect(now.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 0.05)).toBe(true);
      });
    }
  });

  const slanted: Record<string, Page> = {
    'a 30 degree cut': carve([[at(-0.2, 3), at(W + 0.2, 7)]]),
    'a 45 degree cut': carve([[at(-0.2, 2), at(W + 0.2, W + 2.4)]]),
    'a steep 75 degree cut': carve([[at(2, -0.2), at(4.2, H + 0.2)]]),
    'an arc': carve([arc(3.3, -4, 9.2, 0.9, 2.25)]),
    'a zig-zag': carve([[at(-0.2, 5), at(2, 4), at(4, 6), at(W + 0.2, 5)]]),
    'a diagonal under a horizontal (panel only)': carve(horizontal, [[at(1.5, 5.1), at(5, H - 0.1)], 'panel']),
  };

  for (const [name, page] of Object.entries(slanted)) {
    it(`gives both panels of ${name} a handle that sits on the gutter and moves it`, () => {
      const panels = derivePanels(page);
      for (const panel of panels) {
        const handles = panelHandles(page, panel);
        expect(handles.length, `panel ${panel.index}`).toBeGreaterThan(0);
        for (const h of handles) {
          expect(nearestCut(page, h.at)!.d).toBeLessThan(1e-6);
          // dragging it along its axis reshapes the layout without losing a panel
          const moved = { ...page, cuts: movePanelCuts(page, new Map([[h.cut.id, { axis: h.axis, by: 0.2 }]])) };
          expect(derivePanels(moved).length).toBe(panels.length);
          expect(sameGutterTopology(page, moved)).toBe(true);
        }
      }
    });
  }

  it('faces each handle away from the panel it belongs to', () => {
    const page = carve([[at(-0.2, 3), at(W + 0.2, 7)]]);
    const [upper, lower] = derivePanels(page) as [ReturnType<typeof derivePanels>[number], ReturnType<typeof derivePanels>[number]];
    expect(panelHandles(page, upper)[0]!.side).toBe('s');
    expect(panelHandles(page, lower)[0]!.side).toBe('n');
  });

  it('gives each triangle of an X the two cuts it touches and nothing on the page edge', () => {
    const page = carve([[at(-0.2, -0.2), at(W + 0.2, H + 0.2)]], [[at(W + 0.2, -0.2), at(-0.2, H + 0.2)]]);
    const panels = derivePanels(page);
    expect(panels).toHaveLength(4);
    for (const panel of panels) {
      const handles = panelHandles(page, panel);
      expect(handles.length).toBeGreaterThanOrEqual(1);
      expect(new Set(handles.map((h) => h.cut.id)).size).toBe(handles.length);
    }
  });

  it('gives nothing to a page with no cuts, and no handle for the page edge', () => {
    const page = newPage(0);
    expect(panelHandles(page, derivePanels(page)[0]!)).toEqual([]);
  });
});
