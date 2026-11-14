import { openManual } from './manual';
import type { Studio } from '../app/studio';
import { STAGES } from '../doc/model';
import { askText, h, pickFile, toast } from './dom';
import { displayButton } from './popover';
import { kindById, specFor } from '../geom/printkinds';
import { DEFAULT_LAYOUT, stripCuts } from '../geom/carve';

/** Home: the library of books on this device. */
export async function renderHome(root: HTMLElement, studio: Studio, go: (hash: string) => void): Promise<void> {
  const books = (await studio.listBooks()).sort((a, b) => b.modified - a.modified);
  const urls: string[] = [];
  const cover = (bytes: Uint8Array | null) => {
    if (!bytes) return h('span', { 'aria-hidden': 'true' }, '◰');
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    urls.push(url);
    return h('img', { src: url, alt: '' });
  };
  const newBook = async () => {
    const title = await askText('New book', 'Title', 'Untitled book', 'Create');
    if (title === null) return;
    const book = await studio.createBook(title, '');
    go(`#book/${book.id}`);
  };
  const importBook = async () => {
    const f = await pickFile('.inkflo,.zip');
    if (!f) return;
    try {
      const meta = await studio.importInkflo(new Uint8Array(await f.arrayBuffer()));
      toast(`Imported “${meta.title}”.`);
      go(`#book/${meta.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 5000);
    }
  };

  const newScroll = async () => {
    const title = await askText('New vertical comic', 'Title', 'Untitled episode', 'Create');
    if (title === null) return;
    const kind = kindById('webtoon')!;
    const book = await studio.createBook(title, '', (b) => {
      b.print = specFor(kind);
      b.dpi = kind.dpi;
      b.pages[0]!.widthIn = kind.w;
      b.pages[0]!.heightIn = kind.h;
      b.pages[0]!.layout = { ...DEFAULT_LAYOUT, gutter: 0.6, border: 0, gutterPaper: '#ffffff' };
    });
    go(`#desk/${book.id}/${book.pages[0]!.id}/script`);
  };
  /** Comic strip: three or four panels side by side, or three stacked; opens in Draw, ready to ink. */
  const newStrip = () => {
    type StripLayout = '3' | '4' | 'stacked';
    let layout: StripLayout = '3';
    const title = h('input', { value: 'Untitled strip', 'aria-label': 'Title', maxlength: 120 });
    const choice = (id: StripLayout, label: string, note: string, cells: number, stacked: boolean) =>
      h('button', { type: 'button', class: 'strip-choice', role: 'radio', 'aria-checked': String(id === layout), onclick: () => { layout = id; pick.querySelectorAll('[role=radio]').forEach((b) => b.setAttribute('aria-checked', String(b === pick.querySelector(`[data-id="${id}"]`)))); }, 'data-id': id },
        h('span', { class: 'strip-mini' + (stacked ? ' stacked' : ''), 'aria-hidden': 'true' }, Array.from({ length: cells }, () => h('i'))),
        h('b', {}, label), h('small', {}, note));
    const pick = h('div', { class: 'strip-choices', role: 'radiogroup', 'aria-label': 'Strip layout' },
      choice('3', '3 panels', '13 × 4 in daily strip', 3, false),
      choice('4', '4 panels', '13 × 4 in daily strip', 4, false),
      choice('stacked', 'Stacked strip', '4 × 12 in, phone-friendly', 3, true));
    const form = h('form', { method: 'dialog' },
      h('header', {}, h('h2', {}, 'New comic strip')),
      h('div', { class: 'content' }, h('label', { class: 'field' }, 'Title', title), pick,
        h('p', { class: 'note' }, 'Opens in Draw with the panels cut. Change the cuts in Layout and the size in Print any time.')),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Create strip')));
    const d = h('dialog', { 'aria-label': 'New comic strip' }, form);
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const stacked = layout === 'stacked';
      const kind = kindById(stacked ? 'stacked-strip' : 'daily-strip')!;
      d.close();
      const book = await studio.createBook(title.value.trim() || 'Untitled strip', '', (b) => {
        b.print = specFor(kind);
        b.dpi = kind.dpi;
        const pg = b.pages[0]!;
        pg.widthIn = kind.w;
        pg.heightIn = kind.h;
        pg.layout = { ...DEFAULT_LAYOUT, gutter: 0.18 };
        pg.cuts = stripCuts(pg, layout === '4' ? 4 : 3, stacked);
      });
      go(`#desk/${book.id}/${book.pages[0]!.id}/draw`);
    });
    document.body.append(d);
    d.showModal();
    title.select();
  };
  const starter = h('button', { class: 'card new', type: 'button', onclick: async () => {
    starter.disabled = true;
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'examples/the-last-train.inkflo');
      if (!response.ok) throw new Error('The starter could not be loaded. Try again in a moment.');
      const meta = await studio.importInkflo(new Uint8Array(await response.arrayBuffer()), true);
      const book = await studio.openBook(meta.id);
      if (starter.isConnected) go('#desk/' + book.id + '/' + book.pages[0]!.id + '/script');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 5000);
    } finally {
      starter.disabled = false;
    }
  } }, h('div', { class: 'sheet', 'aria-hidden': 'true' }, '▤'), h('h3', {}, 'Open starter comic'), h('small', {}, 'The Last Train · Two panels'));
  // new work in its own short row; the library below it (UI audit P2 19)
  const starts = h('div', { class: 'starts' },
    h('button', { class: 'card new', type: 'button', onclick: newBook }, h('div', { class: 'sheet' }, '+'), h('h3', {}, 'New book'), h('small', {}, 'One page, ready to script')),
    h('button', { class: 'card new', type: 'button', onclick: newScroll }, h('div', { class: 'sheet' }, '↧'), h('h3', {}, 'New vertical comic'), h('small', {}, 'Phone-width episode')),
    h('button', { class: 'card new', type: 'button', onclick: newStrip }, h('div', { class: 'sheet' }, h('span', { class: 'strip-mini', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))), h('h3', {}, 'Comic strip'), h('small', {}, '3 or 4 panels, or stacked')),
    starter);
  const bookCard = (b: (typeof books)[number]) =>
      h('button', { class: 'card', type: 'button', 'data-title': b.title.toLowerCase(), onclick: () => go(`#book/${b.id}`) },
        h('div', { class: 'sheet' }, cover(b.cover)),
        h('h3', {}, b.title),
        h('small', {}, `${b.pages} page${b.pages === 1 ? '' : 's'} · ${b.lastStage} · ${new Date(b.modified).toLocaleDateString()}`),
        h('div', { class: 'dots', 'aria-hidden': 'true' }, STAGES.map((s) => h('i', { class: STAGES.indexOf(s) <= STAGES.indexOf(b.lastStage) ? 'done' : '' }))));
  const grid = h('div', { class: 'books' }, books.map(bookCard));
  const none = h('p', { class: 'empty', hidden: true }, 'No book matches.');
  const search = books.length >= 12 ? h('input', { type: 'search', class: 'book-search', placeholder: `Find among ${books.length} books`, 'aria-label': 'Find a book by title' }) : null;
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const c of grid.children) { const hit = !q || (c as HTMLElement).dataset.title!.includes(q); (c as HTMLElement).hidden = !hit; if (hit) shown++; }
    none.hidden = shown > 0;
  });

  root.replaceChildren(
    h('div', { class: 'screen' },
      h('header', { class: 'bar' },
        h('span', { class: 'brand' }, 'inkflo', h('i')),
        h('span', { class: 'spacer' }),
        studio.persistent ? null : h('span', { class: 'meta' }, 'Not saving: this browser has no local storage'),
        displayButton(),
        h('button', { class: 'btn', type: 'button', onclick: () => openManual() }, 'Manual'),
        h('button', { class: 'btn', type: 'button', onclick: importBook }, 'Import .inkflo'),
        h('button', { class: 'btn primary', type: 'button', onclick: newBook }, 'New book')),
      h('main', { class: 'body' },
        h('div', { class: 'rowlabel' }, 'Start something'),
        starts,
        h('div', { class: 'rowlabel books-head' }, h('span', {}, 'Your books'), search),
        books.length ? null : h('p', { class: 'empty' }, 'Script a page, carve its panels, draw, letter, then export page images, a comic archive, or a motion comic that opens in 2Dope. Everything stays on this device.'),
        grid, none)),
  );
  // free cover URLs when the screen goes away
  const off = new MutationObserver(() => {
    if (!root.contains(grid)) {
      urls.forEach((u) => URL.revokeObjectURL(u));
      off.disconnect();
    }
  });
  off.observe(root, { childList: true });
}
