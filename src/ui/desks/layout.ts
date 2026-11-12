import type { Cut, CutMode, PageLayout, Pt } from '../../doc/model';
import { DEFAULT_LAYOUT, K, evenOut, layoutOf, makeCut, nearestCut, presetCuts, shiftCut, type Panel, type Preset } from '../../geom/carve';
import { panelPath } from '../../render/page';
import { variantOf, type DeskCtx, type DeskMode } from '../desk';
import { confirmDialog, h, seg, slider } from '../dom';
import { centreCrossing, DEFAULT_GRID, downbeatPanel, revealIssues, snapGridCut, staggerCentre } from '../../geom/composition';
import { drawModularGrid } from '../composition';
import { openGrid } from '../grid';
import { openPageTemplates } from '../pagetemplates';
import { applyPageTemplate } from '../../geom/pagetemplates';

type Side = 'n' | 's' | 'e' | 'w';
interface Handle {
  side: Side;
  at: Pt;
  cut: Cut;
  axis: 'x' | 'y';
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'splash', label: 'Splash' },
  { id: 'rows2', label: '2 rows' },
  { id: 'tier3', label: '3 tiers' },
  { id: 'grid4', label: '4' },
  { id: 'grid6', label: '6' },
  { id: 'grid9', label: '9' },
];

/** Layout: carve panels with a knife; drag a panel's edge to move the cut under it. */
export function layoutDesk(ctx: DeskCtx): DeskMode {
  const { studio, book, page } = ctx;
  let showGrid = true;
  let trail: Pt[] | null = null;
  let straight = false;
  let sel: number | null = null;
  let hoverCut: Cut | null = null;
  let drag: { handle: Handle; start: Pt; before: Cut[]; moved: boolean } | null = null;
  let layoutBefore: PageLayout | null = null;

  const selected = (): Panel | null => (sel === null ? null : ctx.panels()[sel] ?? null);
  const panelIndexAt = (p: Pt) => {
    const ps = ctx.panels();
    for (let i = ps.length - 1; i >= 0; i--) {
      const poly = ps[i]!.pts;
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const A = poly[a]!;
        const B = poly[b]!;
        if (A.y > p.y !== B.y > p.y && p.x < ((B.x - A.x) * (p.y - A.y)) / (B.y - A.y) + A.x) inside = !inside;
      }
      if (inside) return i;
    }
    return null;
  };

  function handles(): Handle[] {
    const p = selected();
    if (!p) return [];
    const { x0, x1, y0, y1 } = p.bbox;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const sides: { side: Side; at: Pt; axis: 'x' | 'y' }[] = [
      { side: 'w', at: { x: x0, y: my }, axis: 'x' },
      { side: 'e', at: { x: x1, y: my }, axis: 'x' },
      { side: 'n', at: { x: mx, y: y0 }, axis: 'y' },
      { side: 's', at: { x: mx, y: y1 }, axis: 'y' },
    ];
    const out: Handle[] = [];
    const gutter = layoutOf(page).gutter;
    for (const s of sides) {
      const c = nearestCut(page, s.at);
      if (!c) continue;
      const aligned = s.axis === 'x' ? Math.abs(c.n.x) > 0.55 : Math.abs(c.n.y) > 0.55;
      if (aligned && c.d <= gutter / 2 + 18 / K) out.push({ ...s, cut: c.cut });
    }
    return out;
  }

  const handleAt = (p: Pt): Handle | null => {
    const r = 10 / ctx.scale();
    return handles().find((hd) => Math.abs(hd.at.x - p.x) <= r && Math.abs(hd.at.y - p.y) <= r) ?? null;
  };

  function setLayout(patch: Partial<PageLayout>, commit: boolean): void {
    layoutBefore ??= structuredClone(page.layout ?? DEFAULT_LAYOUT);
    page.layout = { ...layoutOf(page), ...patch };
    ctx.request();
    if (!commit) return;
    const was = layoutBefore;
    const now = structuredClone(page.layout);
    layoutBefore = null;
    studio.run({ label: 'Panel style', do: () => (page.layout = structuredClone(now)), undo: () => (page.layout = structuredClone(was)) }, true);
  }

  const cutMode = (): CutMode => (variantOf(mode, 'knife') === 'across' ? 'across' : 'panel');
  const templates = () => openPageTemplates(page, (template) => {
    studio.editPage(page, 'Apply ' + template.name, ['cuts', 'layout', 'grid', 'downbeat'], (p) => applyPageTemplate(p, template));
    sel = null;
    ctx.chrome();
    ctx.request();
  }, true);
  function markDownbeat(panel: Panel, clear = false): void {
    studio.editPage(page, clear ? 'Clear downbeat' : 'Mark downbeat', ['downbeat'], (pg) => {
      if (clear) delete pg.downbeat;
      else pg.downbeat = { x: panel.centroid.x / pg.widthIn, y: panel.centroid.y / pg.heightIn };
    });
    ctx.chrome();
  }

  const mode: DeskMode = {
    id: 'layout',
    tools: [
      { id: 'knife', label: 'Knife', glyph: '⟋', key: 'k', group: 'cut', variants: [
        { id: 'panel', label: 'Panel only', glyph: '⟋' },
        { id: 'across', label: 'To edges', glyph: '⟷' },
      ] },
      { id: 'erase', label: 'Uncut', glyph: '⌫', key: 'e', group: 'cut' },
      { id: 'resize', label: 'Resize', glyph: '⇔', key: 'r', group: 'edit' },
    ],
    tool: 'knife',
    cursor: () => (mode.tool === 'knife' ? 'cross' : mode.tool === 'resize' ? 'move' : ''),
    ctx(bar) {
      const L = layoutOf(page);
      if (mode.tool === 'knife') bar.append(seg<CutMode>([{ id: 'panel', label: 'Panel only' }, { id: 'across', label: 'To edges' }], cutMode(), (v) => ctx.setVariant('knife', v), 'Cut mode'));
      bar.append(
        h('button', { class: 'btn', type: 'button', onclick: templates }, 'Page templates'),
        slider('Gutter', 0, 0.6, 0.01, L.gutter, (v) => `${v.toFixed(2)}″`, (v) => setLayout({ gutter: v }, false), (v) => setLayout({ gutter: v }, true)),
        slider('Border', 0, 0.12, 0.005, L.border, (v) => `${(v * 72).toFixed(1)}pt`, (v) => setLayout({ border: v }, false), (v) => setLayout({ border: v }, true)),
        slider('Curve', 0, 5, 1, L.curve, (v) => String(v), (v) => setLayout({ curve: v }, false), (v) => setLayout({ curve: v }, true)),
        h('button', { class: 'btn', type: 'button', disabled: page.cuts.length < 2, onclick: () => studio.editPage(page, 'Even out', ['cuts'], (p) => (p.cuts = evenOut(p))) }, 'Even out'),
        h('span', { class: 'hint' }, mode.tool === 'knife' ? 'Drag across the page to cut · Shift for straight' : mode.tool === 'resize' ? 'Select a panel, drag a handle to move the cut' : 'Click a gutter to remove that cut'),
      );
    },
    inspector(el) {
      const ps = ctx.panels();
      const p = selected();
      const downbeat = downbeatPanel(page, ps);
      const crossing = centreCrossing(page);
      const staggered = crossing ? staggerCentre(page) : undefined;
      el.append(
        h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Layout'), h('div', { class: 'ins-title' }, `${ps.length} panel${ps.length === 1 ? '' : 's'}`)),
        h('div', { class: 'sec' }, h('h4', {}, 'Presets'),
          h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
            PRESETS.map((pr) => h('button', { class: 'btn', type: 'button', onclick: async () => {
              if (page.cuts.length && !(await confirmDialog('Replace the layout?', 'The preset replaces this page’s cuts. Undo brings them back.', 'Replace'))) return;
              studio.editPage(page, `Preset: ${pr.label}`, ['cuts'], (pg) => (pg.cuts = presetCuts(pg, pr.id)));
              sel = null;
              ctx.chrome();
            } }, pr.label)))),
      );
      const grid = page.grid ?? book.fixedGrid;
      const show = h('input', { type: 'checkbox', checked: showGrid, disabled: !grid });
      show.addEventListener('change', () => { showGrid = show.checked; ctx.request(); });
      el.append(h('div', { class: 'sec' }, h('h4', {}, 'Modular grid'),
        h('label', { class: 'mini' }, show, 'Show guides and snap Knife'),
        grid ? h('p', { class: 'note' }, grid.columns.length + ' columns × ' + grid.rows.length + ' rows' + (book.fixedGrid ? ' · book grid enabled' : '')) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => openGrid(ctx, grid ?? DEFAULT_GRID) }, 'Grid settings')));
      if (p) {
        const beat = page.beats[p.index];
        el.append(
          h('div', { class: 'sec' }, h('h4', {}, `Panel ${p.index + 1}`),
            h('div', { class: 'rows' }, 'Size', h('b', {}, `${(p.bbox.x1 - p.bbox.x0).toFixed(2)} × ${(p.bbox.y1 - p.bbox.y0).toFixed(2)} in`)),
            h('div', { class: 'rows' }, 'Reading order', h('b', {}, String(p.index + 1))),
            h('button', { class: 'btn', type: 'button', onclick: () => markDownbeat(p, p === downbeat) }, p === downbeat ? 'Clear downbeat' : 'Mark downbeat'),
            beat ? h('p', { class: 'note' }, h('strong', {}, 'Beat: '), beat.desc || '(no description)') : h('p', { class: 'note' }, 'No beat for this panel yet.')),
        );
      }
      el.append(
        h('div', { class: 'sec' }, h('h4', {}, 'Page'),
          h('div', { class: 'rows' }, 'Cuts', h('b', {}, String(page.cuts.length))),
          h('div', { class: 'rows' }, 'Beats', h('b', {}, String(page.beats.length))),
          downbeat ? h('div', { class: 'rows' }, 'Downbeat', h('b', {}, 'Panel ' + (downbeat.index + 1))) : null,
          !downbeat && ps.length > 1 ? h('button', { class: 'btn', type: 'button', onclick: () => markDownbeat(ps.at(-1)!) }, 'Mark last panel as downbeat') : null,
          crossing ? h('p', { class: 'note' }, 'A gutter crossing sits at the centre. Stagger the cuts to move attention away from the crossing.') : null,
          staggered ? h('button', { class: 'btn', type: 'button', onclick: () => {
            studio.editPage(page, 'Stagger centre crossing', ['cuts'], (pg) => (pg.cuts = staggered));
            ctx.chrome();
          } }, 'Stagger centre') : null,
          ...revealIssues(book, page, ps).map(({ text }) => h('p', { class: 'warnline' }, text)),
          page.beats.length && ps.length !== page.beats.length ? h('p', { class: 'note' }, h('strong', {}, 'Count differs: '), `${page.beats.length} beats, ${ps.length} panels.`) : null,
          h('p', { class: 'note' }, 'Panels are what the cuts leave. Panel-only cuts stop at the panel they start in; To-edges cuts run trim to trim.')),
      );
    },
    down(p, e) {
      if (mode.tool === 'knife') {
        trail = [p];
        straight = e.shiftKey;
        sel = panelIndexAt(p);
        return;
      }
      if (mode.tool === 'resize') {
        const hd = handleAt(p);
        if (hd) {
          drag = { handle: hd, start: p, before: structuredClone(page.cuts), moved: false };
          return;
        }
        sel = panelIndexAt(p);
        ctx.chrome();
        return;
      }
      if (mode.tool === 'erase') {
        const c = nearestCut(page, p);
        if (c && c.d <= layoutOf(page).gutter / 2 + 8 / ctx.scale()) {
          studio.editPage(page, 'Remove cut', ['cuts'], (pg) => (pg.cuts = pg.cuts.filter((x) => x.id !== c.cut.id)));
          sel = null;
          ctx.chrome();
        }
      }
    },
    move(p, e) {
      if (trail) {
        straight = e.shiftKey;
        if (straight) trail = [trail[0]!, p];
        else if (Math.hypot(p.x - trail[trail.length - 1]!.x, p.y - trail[trail.length - 1]!.y) > 2.2 / ctx.scale()) trail.push(p);
        return;
      }
      if (drag) {
        const d = drag.handle.axis === 'x' ? p.x - drag.start.x : p.y - drag.start.y;
        if (!drag.moved && Math.abs(d) * ctx.scale() < 3) return;
        drag.moved = true;
        const orig = drag.before.find((c) => c.id === drag!.handle.cut.id)!;
        page.cuts = drag.before.map((c) => (c.id === orig.id ? shiftCut(orig, drag!.handle.axis, d) : c));
      }
    },
    hover(p) {
      hoverCut = null;
      if (p && mode.tool === 'erase') {
        const c = nearestCut(page, p);
        if (c && c.d <= layoutOf(page).gutter / 2 + 8 / ctx.scale()) hoverCut = c.cut;
      }
    },
    up() {
      if (trail) {
        const grid = page.grid ?? book.fixedGrid;
        const stroke = showGrid && grid ? snapGridCut(page, grid, trail, 10 / ctx.scale()) : trail;
        const snapped = stroke !== trail;
        trail = null;
        const cut = makeCut(page, stroke, cutMode(), straight);
        sel = null; // reading-order indices shift when panels split
        if (cut) {
          const useGridGutter = snapped && grid && !page.cuts.length;
          studio.editPage(page, cutMode() === 'panel' ? 'Cut panel' : 'Cut across', useGridGutter ? ['cuts', 'layout'] : ['cuts'], (pg) => {
            if (useGridGutter) pg.layout = { ...layoutOf(pg), gutter: grid.gutter };
            pg.cuts.push(cut);
          });
          studio.markStage(page, 'layout', 1);
          ctx.chrome();
        }
        return;
      }
      if (drag) {
        const was = drag.before;
        const moved = drag.moved;
        drag = null;
        if (!moved) return;
        const now = structuredClone(page.cuts);
        page.cuts = was;
        studio.editPage(page, 'Move cut', ['cuts'], (pg) => (pg.cuts = now));
        ctx.chrome();
      }
    },
    overlay(g, s) {
      const ps = ctx.panels();
      const grid = page.grid ?? book.fixedGrid;
      if (showGrid && grid) drawModularGrid(g, page, grid, s);
      const downbeat = downbeatPanel(page, ps);
      // panel numbers
      g.save();
      g.font = `600 ${Math.max(9, 0.11 * s)}px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(25,26,31,.32)';
      for (const p of ps) {
        g.fillStyle = p === downbeat ? '#8F4723' : 'rgba(25,26,31,.42)';
        g.fillText((p === downbeat ? '◆ ' : '') + String(p.index + 1).padStart(2, '0'), p.centroid.x * s, (p.bbox.y0 + 0.22) * s);
      }
      const p = selected();
      if (p) {
        g.fillStyle = 'rgba(47,111,126,.10)';
        g.fill(panelPath(p.pts, s));
        g.strokeStyle = '#2F6F7E';
        g.lineWidth = 2;
        g.setLineDash([7, 5]);
        g.stroke(panelPath(p.pts, s));
        g.setLineDash([]);
      }
      if (mode.tool === 'resize') {
        for (const hd of handles()) {
          g.fillStyle = '#FFFDF7';
          g.strokeStyle = '#2F6F7E';
          g.lineWidth = 2;
          g.beginPath();
          g.roundRect(hd.at.x * s - 6, hd.at.y * s - 6, 12, 12, 2);
          g.fill();
          g.stroke();
        }
      }
      if (hoverCut) {
        g.strokeStyle = '#B8432F';
        g.lineWidth = 3;
        g.setLineDash([6, 5]);
        g.beginPath();
        hoverCut.pts.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
        g.stroke();
        g.setLineDash([]);
      }
      if (trail && trail.length > 1) {
        g.strokeStyle = '#B8432F';
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        g.setLineDash([8, 7]);
        g.beginPath();
        const preview = showGrid && grid ? snapGridCut(page, grid, trail, 10 / s) : trail;
        preview.forEach((q, i) => (i ? g.lineTo(q.x * s, q.y * s) : g.moveTo(q.x * s, q.y * s)));
        g.stroke();
      }
      g.restore();
    },
    key(e) {
      if (e.key === 'Escape') {
        trail = null;
        sel = null;
        ctx.chrome();
        ctx.request();
        return true;
      }
      return false;
    },
  };
  return mode;
}
