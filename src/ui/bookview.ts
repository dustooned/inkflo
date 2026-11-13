import type { Studio } from '../app/studio';
import { sheetOf, STAGES, type Page } from '../doc/model';
import { renderThumb } from '../render/page';
import { openExport } from './exportdialog';
import { askText, confirmDialog, h } from './dom';
import { displayButton } from './popover';
import { spreadButton } from './spread';
import { applyPageTemplate } from '../geom/pagetemplates';
import { openPageTemplates } from './pagetemplates';
import { openBookAssets } from './bookassets';

const STAGE_LABEL: Record<string, string> = { script: 'Script', layout: 'Layout', draw: 'Draw', caption: 'Caption', print: 'Print' };

/** Book: the pages as a grid with stage dots; Continue opens the desk you left. */
export async function renderBook(root: HTMLElement, studio: Studio, id: string, go: (hash: string) => void): Promise<() => void> {
  const book = await studio.openBook(id);
  const deskOf = (p: Page) => `#desk/${book.id}/${p.id}/${book.lastPageId === p.id ? book.lastStage : 'script'}`;

  const grid = h('div', { class: 'books pages' });
  const thumbs = new Map<string, HTMLCanvasElement>();
  const draw = () => {
    grid.replaceChildren(
      ...book.pages.map((p, i) => {
        const c = thumbs.get(p.id) ?? document.createElement('canvas');
        thumbs.set(p.id, c);
        const a = studio.art.get(p.id) ?? null;
        renderThumb(p, a && !a.parked ? a : null, 220, c, sheetOf(book));
        return h('div', { class: 'card pagecard' },
          h('button', { class: 'sheet', type: 'button', 'aria-label': `Open page ${i + 1}`, onclick: () => go(deskOf(p)) }, c),
          h('div', { class: 'foot' },
            h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
            h('span', { class: 'acts' },
              h('button', { type: 'button', title: 'Move earlier', 'aria-label': `Move page ${i + 1} earlier`, disabled: i === 0, onclick: () => studio.movePage(p, i - 1) }, '◀'),
              h('button', { type: 'button', title: 'Move later', 'aria-label': `Move page ${i + 1} later`, disabled: i === book.pages.length - 1, onclick: () => studio.movePage(p, i + 1) }, '▶'),
              h('button', { type: 'button', title: 'Delete page', 'aria-label': `Delete page ${i + 1}`, disabled: book.pages.length < 2,
                onclick: async () => { if (await confirmDialog('Delete page?', `Page ${i + 1} and its art go away. Undo brings them back.`, 'Delete')) studio.deletePage(p); } }, '✕')),
            h('span', { class: 'dots', 'aria-label': STAGES.map((s) => `${STAGE_LABEL[s]} ${['to do', 'in progress', 'done'][p.state[s]]}`).join(', ') },
              STAGES.map((s) => h('i', { class: ['', 'wip', 'done'][p.state[s]] ?? '' })))));
      }),
      h('div', { class: 'new-page-card' },
        h('button', { class: 'card new pagecard', type: 'button', onclick: () => { const p = studio.addPage(); go(`#desk/${book.id}/${p.id}/script`); } },
          h('div', { class: 'sheet' }, '+'), h('h3', {}, 'New page')),
        h('button', { class: 'btn', type: 'button', onclick: () => openPageTemplates(book.pages.at(-1)!, (template) => {
          const p = studio.addPage(undefined, (next) => applyPageTemplate(next, template));
          go(`#desk/${book.id}/${p.id}/layout`);
        }, false) }, 'From template')),
    );
  };

  const titleEl = h('span', { class: 'title' }, book.title);
  const metaEl = h('span', { class: 'meta' });
  const save = h('span', { class: 'save', 'aria-live': 'polite' });
  const status = () => {
    titleEl.textContent = book.title;
    metaEl.textContent = `${book.pages.length} ${book.pages.length === 1 ? 'page' : 'pages'} · ${book.dpi} dpi`;
    save.dataset.state = studio.saveState;
    save.textContent = { idle: '', dirty: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: `Not saved: ${studio.saver.error ?? ''}` }[studio.saveState];
  };
  const last = book.pages.find((p) => p.id === book.lastPageId) ?? book.pages[0]!;

  root.replaceChildren(
    h('div', { class: 'screen' },
      h('header', { class: 'bar' },
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Back to library', onclick: () => go('#home') }, '←'),
        h('div', {}, titleEl, h('div', {}, metaEl)),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const t = await askText('Rename book', 'Title', book.title, 'Rename');
          if (t !== null) await studio.renameBook(t, book.author);
        } }, 'Rename'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (await confirmDialog('Delete book?', `“${book.title}” and all its pages are removed from this device. This cannot be undone. Export an .inkflo first to keep a copy.`, 'Delete book')) {
            await studio.deleteBook(book.id);
            go('#home');
          }
        } }, 'Delete'),
        h('span', { class: 'spacer' }),
        save,
        displayButton(),
        h('button', { class: 'btn', type: 'button', onclick: () => openBookAssets(studio) }, 'Assets'),
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => studio.undo() }, '↶'),
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => studio.redo() }, '↷'),
        h('button', { class: 'btn', type: 'button', onclick: () => openExport(studio) }, 'Export'),
        spreadButton(studio, undefined, 'layout', go),
        h('button', { class: 'btn primary', type: 'button', onclick: () => go(`#desk/${book.id}/${last.id}/${book.lastStage}`) }, `Continue · ${STAGE_LABEL[book.lastStage]}`)),
      h('main', { class: 'body' }, grid)),
  );
  draw();
  status();
  // bring pages in to draw real thumbnails, a few at a time
  let alive = true;
  void (async () => {
    for (const p of book.pages) {
      if (!alive) return;
      const a = studio.ensureArt(p);
      if (a.parked) {
        await studio.residency.ensure(a);
        if (alive) draw();
      }
    }
  })();
  const off = studio.on(() => {
    status();
    draw();
  });
  return () => {
    alive = false;
    off();
  };
}
