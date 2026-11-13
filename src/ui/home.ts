import type { Studio } from '../app/studio';
import { STAGES } from '../doc/model';
import { askText, h, pickFile, toast } from './dom';
import { displayButton } from './popover';
import { kindById, specFor } from '../geom/printkinds';
import { DEFAULT_LAYOUT } from '../geom/carve';

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
  const grid = h('div', { class: 'books' },
    h('button', { class: 'card new', type: 'button', onclick: newBook }, h('div', { class: 'sheet' }, '+'), h('h3', {}, 'New book'), h('small', {}, 'One page, ready to script')),
    h('button', { class: 'card new', type: 'button', onclick: newScroll }, h('div', { class: 'sheet' }, '↧'), h('h3', {}, 'New vertical comic'), h('small', {}, 'Phone-width episode')),
    books.map((b) =>
      h('button', { class: 'card', type: 'button', onclick: () => go(`#book/${b.id}`) },
        h('div', { class: 'sheet' }, cover(b.cover)),
        h('h3', {}, b.title),
        h('small', {}, `${b.pages} page${b.pages === 1 ? '' : 's'} · ${b.lastStage} · ${new Date(b.modified).toLocaleDateString()}`),
        h('div', { class: 'dots', 'aria-hidden': 'true' }, STAGES.map((s) => h('i', { class: STAGES.indexOf(s) <= STAGES.indexOf(b.lastStage) ? 'done' : '' }))))),
  );

  root.replaceChildren(
    h('div', { class: 'screen' },
      h('header', { class: 'bar' },
        h('span', { class: 'brand' }, 'inkflo', h('i')),
        h('span', { class: 'spacer' }),
        studio.persistent ? null : h('span', { class: 'meta' }, 'Not saving: this browser has no local storage'),
        displayButton(),
        h('button', { class: 'btn', type: 'button', onclick: importBook }, 'Import .inkflo'),
        h('button', { class: 'btn primary', type: 'button', onclick: newBook }, 'New book')),
      h('main', { class: 'body' },
        h('div', { class: 'rowlabel' }, 'Your books'),
        books.length ? null : h('p', { class: 'empty' }, 'Script a page, carve its panels, draw, letter, then export page images, a comic archive, or a motion comic that opens in 2Dope. Everything stays on this device.'),
        grid)),
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
