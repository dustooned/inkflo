import { openManual } from './manual';

/** Who made inkflo (the manual's About section says more). The college's name links to its Digital Media Arts program. */
export const ABOUT_CREDIT = 'Designed, programmed and developed by Professor T';
export const LBCC_URL = 'https://www.lbcc.edu/digitalmedia';
import type { Studio } from '../app/studio';
import { STAGES } from '../doc/model';
import { h, pickFile, toast } from './dom';
import { displayButton } from './popover';
import { openOfflineDialog } from './offlinedialog';
import { DEFAULT_PRINT, kindById, specFor } from '../geom/printkinds';
import { sizePicker } from './sizepicker';
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
  /** New book: a title and a page size, from a preset or typed in. Opens ready to script. */
  const newBook = () => {
    const title = h('input', { value: 'Untitled book', 'aria-label': 'Title', maxlength: 120 });
    const create = h('button', { class: 'btn primary', type: 'submit' }, 'Create book');
    const first = kindById('us-comic')!;
    const sizeBox = sizePicker({ w: first.w, h: first.h, dpi: first.dpi, onChange: (v) => { create.disabled = !!v.problem; } });
    const form = h('form', { method: 'dialog' },
      h('header', {}, h('h2', {}, 'New book')),
      h('div', { class: 'content' }, h('label', { class: 'field' }, 'Title', title), h('h4', {}, 'Page size'), sizeBox.el,
        h('p', { class: 'note' }, 'Pick a preset or type your own. You can change bleed, safe area and binding in Print, and the size too until you start drawing.')),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'), create));
    const d = h('dialog', { 'aria-label': 'New book' }, form);
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = sizeBox.value();
      if (v.problem) return;
      d.close();
      const kind = v.kind ? kindById(v.kind) : null;
      const book = await studio.createBook(title.value.trim() || 'Untitled book', '', (b) => {
        b.print = kind ? specFor(kind) : { ...DEFAULT_PRINT, kind: 'custom', binding: 'none', bleed: 0.125, safe: 0.25, rtl: false };
        b.dpi = kind?.dpi ?? 300;
        b.pages[0]!.widthIn = v.w;
        b.pages[0]!.heightIn = v.h;
      });
      go(`#book/${book.id}`);
    });
    document.body.append(d);
    d.showModal();
    title.select();
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

  /** New vertical comic: a title and a page size (starts as the 8 x 32 in Webtoon page, 800 px wide), with a short guide. */
  const newScroll = () => {
    const title = h('input', { value: 'Untitled episode', 'aria-label': 'Title', maxlength: 120 });
    const kind = kindById('webtoon')!;
    const create = h('button', { class: 'btn primary', type: 'submit' }, 'Create episode');
    const sizeBox = sizePicker({ w: kind.w, h: kind.h, dpi: kind.dpi, onChange: (v) => { create.disabled = !!v.problem; } });
    const form = h('form', { method: 'dialog' },
      h('header', {}, h('h2', {}, 'New vertical comic')),
      h('div', { class: 'content' }, h('label', { class: 'field' }, 'Title', title), h('h4', {}, 'Page size'), sizeBox.el,
        h('details', { class: 'note' },
          h('summary', {}, 'How do these numbers work?'),
          h('ul', {},
            h('li', {}, 'inkflo draws vertical pages at 100 pixels per inch, so 8 in wide is 800 px wide: a common width for web comics.'),
            h('li', {}, 'A page is one long chunk of your episode. Add more pages as you go; they stack into one scroll.'),
            h('li', {}, 'When you are done, Export → Vertical scroll lets you pick the final width, image format and file size for the site you publish on.'))),
        h('p', { class: 'note' }, 'Not sure? Keep the defaults. You can change the size in Print until you start drawing.')),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'), create));
    const d = h('dialog', { 'aria-label': 'New vertical comic' }, form);
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = sizeBox.value();
      if (v.problem) return;
      d.close();
      const book = await studio.createBook(title.value.trim() || 'Untitled episode', '', (b) => {
        b.print = { ...specFor(kind), kind: v.kind ?? 'custom' };
        b.dpi = kind.dpi;
        b.pages[0]!.widthIn = v.w;
        b.pages[0]!.heightIn = v.h;
        b.pages[0]!.layout = { ...DEFAULT_LAYOUT, gutter: 0.6, border: 0, gutterPaper: '#ffffff' };
      });
      go(`#desk/${book.id}/${book.pages[0]!.id}/script`);
    });
    document.body.append(d);
    d.showModal();
    title.select();
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
        h('button', { class: 'btn', type: 'button', onclick: openOfflineDialog }, 'Offline'),
        h('button', { class: 'btn', type: 'button', onclick: () => openManual() }, 'Manual'),
        h('button', { class: 'btn', type: 'button', onclick: importBook }, 'Import .inkflo'),
        h('button', { class: 'btn primary', type: 'button', onclick: newBook }, 'New book')),
      h('main', { class: 'body' },
        h('div', { class: 'rowlabel' }, 'Start something'),
        starts,
        h('div', { class: 'rowlabel books-head' }, h('span', {}, 'Your books'), search),
        books.length ? null : h('p', { class: 'empty' }, 'Script a page, carve its panels, draw, letter, then export page images, a comic archive, or a motion comic that opens in 2Dope. Everything stays on this device.'),
        grid, none),
      h('footer', { class: 'home-credit' },
        h('span', { class: 'credit-line' },
          h('button', { class: 'credit', type: 'button', title: 'About inkflo', onclick: () => openManual('about') }, ABOUT_CREDIT),
          ' at ',
          h('a', { class: 'credit', href: LBCC_URL, target: '_blank', rel: 'noopener noreferrer', title: 'Digital Media Arts at Long Beach City College (opens in a new tab)' }, 'Long Beach City College')))),
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
