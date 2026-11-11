import type { ModularGrid } from '../doc/model';
import { layoutOf } from '../geom/carve';
import { gridCuts } from '../geom/composition';
import type { DeskCtx } from './desk';
import { confirmDialog, h } from './dom';

export function openGrid(ctx: DeskCtx, current: ModularGrid): void {
  const { page, book, studio } = ctx;
  const input = (name: string, values: number[]) => h('input', { 'aria-label': name, value: values.join(', '), required: true });
  const columns = input('Column weights', current.columns);
  const rows = input('Row weights', current.rows);
  const gutter = h('input', { type: 'number', min: 0, max: 0.6, step: 'any', value: current.gutter, required: true, 'aria-label': 'Gutter inches' });
  const error = h('p', { class: 'warnline', role: 'status', hidden: true });
  const field = (label: string, control: HTMLElement) => h('label', { class: 'field' }, label, control);
  const action = (label: string, onclick: () => void) => h('button', { class: 'btn', type: 'button', onclick }, label);
  const close = () => { d.close(); ctx.chrome(); ctx.request(); };

  function read(): ModularGrid | undefined {
    const parse = (s: string) => s.trim().split(/\s*,\s*|\s+/).map(Number);
    const c = parse(columns.value);
    const r = parse(rows.value);
    const valid = (values: number[]) => values.length <= 12 && values.every((n) => n >= 0.01 && n <= 100);
    const gap = gutter.valueAsNumber;
    if (!valid(c) || !valid(r) || !Number.isFinite(gap) || gap < 0 || gap > 0.6) {
      error.hidden = false;
      error.textContent = 'Enter 1–12 weights per axis, from 0.01 to 100, and a gutter from 0 to 0.6 inches.';
      return;
    }
    error.hidden = true;
    return { columns: c, rows: r, gutter: gap };
  }

  async function carve(): Promise<void> {
    const grid = read();
    if (!grid) return;
    if (page.cuts.length && !(await confirmDialog('Replace this page’s cuts?', 'This applies the grid to every cell on this page. You can undo the change.', 'Replace cuts'))) return;
    studio.editPage(page, 'Apply modular grid', ['cuts', 'layout', 'grid'], (p) => {
      p.cuts = gridCuts(p, grid);
      p.layout = { ...layoutOf(p), gutter: grid.gutter };
      p.grid = grid;
    });
    close();
  }

  function setFixed(): void {
    const grid = read();
    if (!grid) return;
    const before = book.fixedGrid;
    const uncut = book.pages.filter((p) => !p.cuts.length && !p.grid && !p.balloons.length &&
      !p.groups.some((g) => g.layers.length) && !studio.art.get(p.id)?.parked);
    const layouts = uncut.map((p) => ({ p, before: p.layout, cuts: gridCuts(p, grid), layout: { ...layoutOf(p), gutter: grid.gutter } }));
    studio.run({
      label: 'Set book grid',
      do: () => {
        book.fixedGrid = grid;
        for (const item of layouts) Object.assign(item.p, { cuts: structuredClone(item.cuts), layout: { ...item.layout } });
      },
      undo: () => {
        book.fixedGrid = before;
        for (const item of layouts) Object.assign(item.p, { cuts: [], layout: item.before });
      },
    });
    close();
  }

  const d = h('dialog', { 'aria-label': 'Modular grid' },
    h('header', {}, h('h2', {}, 'Modular grid')),
    h('div', { class: 'content stack' },
      field('Column weights', columns), field('Row weights', rows), field('Gutter (inches)', gutter),
      h('p', { class: 'note' }, 'Use relative sizes. For example, 1, 2, 1 makes the centre twice as wide as the edges. Save guides and cut only the cell edges you need with the Knife.'),
      error,
      action('Save page guides', () => {
        const grid = read();
        if (!grid) return;
        studio.editPage(page, 'Set page grid guides', ['grid'], (p) => (p.grid = grid));
        close();
      }),
      action('Carve every cell on this page', () => void carve()),
      action('Set as book grid', setFixed),
      h('p', { class: 'note' }, 'The book grid carves new pages and empty pages without a custom grid. Edit individual cuts to vary the rhythm.'),
      page.grid ? action('Clear page guides', () => {
        studio.editPage(page, 'Clear page grid', ['grid'], (pg) => { delete pg.grid; });
        close();
      }) : null,
      book.fixedGrid ? action('Turn off book grid', () => {
        const before = book.fixedGrid;
        studio.run({ label: 'Turn off book grid', do: () => { delete book.fixedGrid; }, undo: () => (book.fixedGrid = before) });
        close();
      }) : null),
    h('footer', {}, action('Close', () => d.close())));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}
