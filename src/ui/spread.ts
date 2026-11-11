import type { Studio } from '../app/studio';
import type { Page, Stage } from '../doc/model';
import { printOf, readerSpreads } from '../geom/printkinds';
import { renderSeparation } from '../io/printexport';
import { drawComposition } from './composition';
import { h } from './dom';
import { prefs } from './prefs';

export function spreadButton(studio: Studio, page: Page | undefined, stage: Stage, go: (hash: string) => void, compact = false): HTMLButtonElement {
  return h('button', { class: compact ? 'icon' : 'btn', type: 'button', title: 'Spread preview', 'aria-label': 'Spread preview', onclick: () => openSpread(studio, page, stage, go) }, compact ? '◫' : 'Spread');
}

function openSpread(studio: Studio, page: Page | undefined, stage: Stage, go: (hash: string) => void): void {
  const book = studio.book;
  if (!book) return;
  const rtl = printOf(book).rtl;
  const spreads = readerSpreads(book.pages.length, rtl);
  const active = page ?? book.pages.find((p) => p.id === book.lastPageId);
  let index = Math.max(0, spreads.findIndex((pair) => pair.includes(active ? book.pages.indexOf(active) : 0)));
  let revision = 0;
  const heading = h('h2', {}, 'Spread preview');
  const viewport = h('div', { class: 'spread-view', 'aria-busy': 'true' });
  const status = h('span', { class: 'note', role: 'status' });
  const back = h('button', { class: 'btn', type: 'button', onclick: () => turn(-1) }, 'Previous');
  const next = h('button', { class: 'btn', type: 'button', onclick: () => turn(1) }, 'Next');
  const guide = h('input', { type: 'checkbox', disabled: prefs().guide === 'off' });
  guide.addEventListener('change', () => void draw());
  const d = h('dialog', { class: 'spread-dialog', 'aria-label': 'Spread preview' },
    h('header', {}, heading),
    h('div', { class: 'content' }, viewport),
    h('footer', {}, back, next, h('label', { class: 'mini' }, guide, 'Show composition guides'), status,
      h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close')));
  function turn(delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= spreads.length) return;
    index = to;
    void draw();
  }
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      turn((e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1));
    }
  });
  d.addEventListener('close', () => { revision++; d.remove(); });
  document.body.append(d);
  d.showModal();
  const draw = async (): Promise<void> => {
    const id = ++revision;
    const pair = spreads[index]!;
    back.disabled = index === 0;
    next.disabled = index + 1 === spreads.length;
    status.textContent = 'Spread ' + (index + 1) + ' of ' + spreads.length;
    viewport.setAttribute('aria-busy', 'true');
    try {
      const slots = await Promise.all(pair.map(async (n) => {
        if (n === null) return null;
        const p = book.pages[n]!;
        const art = studio.ensureArt(p);
        try {
          await studio.residency.pin(art);
          return { p, n, canvas: await renderSeparation(p, art, 96, book, 'all') };
        } finally {
          studio.residency.unpin(art);
        }
      }));
      if (id !== revision) return;
      const canvas = h('canvas', { role: 'img', 'aria-label': pair.filter((n) => n !== null).map((n) => 'Page ' + (n + 1)).join(' and ') });
      const visible = slots.filter((slot) => slot !== null);
      canvas.width = visible.reduce((sum, slot) => sum + slot.canvas.width, 0);
      canvas.height = Math.max(...visible.map((slot) => slot.canvas.height));
      const g = canvas.getContext('2d')!;
      let x = 0;
      for (const slot of visible) {
        g.drawImage(slot.canvas, x, 0);
        x += slot.canvas.width;
      }
      if (guide.checked) drawComposition(g, prefs().guide, canvas.width / 96, canvas.height / 96, 96);
      const links = visible.map(({ p, n }) => h('button', { class: 'btn', type: 'button', onclick: () => {
        d.close();
        go('#desk/' + book.id + '/' + p.id + '/' + stage);
      } }, 'Open page ' + (n + 1)));
      viewport.replaceChildren(canvas, h('div', { class: 'spread-links' }, links));
    } catch (e) {
      if (id === revision) viewport.replaceChildren(h('p', { role: 'alert' }, e instanceof Error ? e.message : String(e)));
    } finally {
      if (id === revision) viewport.setAttribute('aria-busy', 'false');
    }
  };
  void draw();
}
