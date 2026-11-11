import { preflightPage } from '../../geom/preflight';
import { BINDING_LABEL, checkCount, kindById, PRINT_KINDS, printOf, specFor, spineWidth, type BlankPlace, type Binding, type KindGroup } from '../../geom/printkinds';
import { renderPagePng } from '../../io/exports';
import { sheetOf } from '../../doc/model';
import { letterBox } from '../../render/caption';
import type { DeskCtx, DeskMode } from '../desk';
import { openExport } from '../exportdialog';
import { confirmDialog, download, h, seg, slug, toast } from '../dom';

const inch = (v: number) => `${Math.round(v * 1000) / 1000}″`;
const mmOf = (v: number) => `${Math.round(v * 25.4 * 10) / 10} mm`;
const size = (w: number, h: number) => `${inch(w)} × ${inch(h)}`;

/** Print: the sheet, not the page. Print kind, trim/bleed/safe guides, page count and preflight. */
export function printDesk(ctx: DeskCtx): DeskMode {
  const { studio, page, book, art } = ctx;
  let guides: 'all' | 'none' = 'all';

  async function pickKind(id: string): Promise<void> {
    const kind = kindById(id);
    if (!kind) return;
    const spec = { ...specFor(kind, printOf(book).blanks) };
    const sameSize = book.pages.every((p) => Math.abs(p.widthIn - kind.w) < 1e-3 && Math.abs(p.heightIn - kind.h) < 1e-3);
    if (sameSize) {
      studio.setPrint(spec);
    } else if (studio.blankArt) {
      if (!(await confirmDialog(`Make the pages ${size(kind.w, kind.h)}?`, `${kind.label} pages are ${size(kind.w, kind.h)}. Nothing is drawn yet, so panels and balloons simply scale to the new page. Undo puts it back.`, 'Resize pages'))) return;
      studio.setPrint(spec, { w: kind.w, h: kind.h });
      // the desk holds the old page bitmaps: open it again on the new ones
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      toast(`Pages are now ${size(kind.w, kind.h)}.`);
      return;
    } else {
      const ok = await confirmDialog('Keep the page size?', `${kind.label} pages are ${size(kind.w, kind.h)}, but this book's pages are ${size(page.widthIn, page.heightIn)} and already have art. Resizing drawn pages isn't built yet, so the bleed, safe area and binding change and the page size stays. Print shops and exports scale to fit.`, 'Use the other settings');
      if (!ok) return;
      studio.setPrint(spec);
    }
    ctx.chrome();
    ctx.request();
  }

  const mode: DeskMode = {
    id: 'print',
    tools: [],
    tool: '',
    types: () => ({ pencil: false, reference: false }),
    ctx(bar) {
      const spec = printOf(book);
      const groups = new Map<KindGroup, typeof PRINT_KINDS>();
      for (const k of PRINT_KINDS) groups.set(k.group, [...(groups.get(k.group) ?? []), k]);
      const sel = h('select', { 'aria-label': 'Print kind' },
        [...groups.entries()].map(([g, ks]) => h('optgroup', { label: g }, ks.map((k) => h('option', { value: k.id, selected: k.id === spec.kind }, `${k.label} · ${size(k.w, k.h)}`)))),
        h('option', { value: 'custom', selected: !kindById(spec.kind) }, 'Custom'));
      sel.addEventListener('change', () => void pickKind(sel.value));
      bar.append(
        h('label', { class: 'mini' }, 'Print kind', sel),
        seg([{ id: 'all', label: 'Trim · bleed · safe' }, { id: 'none', label: 'Clean' }], guides, (v) => { guides = v; ctx.chrome(); ctx.request(); }, 'Guides'),
        h('span', { class: 'hint' }, `${size(page.widthIn, page.heightIn)} trim · ${inch(spec.bleed)} bleed · ${inch(spec.safe)} safe · ${BINDING_LABEL[spec.binding]}${spec.rtl ? ' · right to left' : ''}`),
      );
    },
    inspector(el) {
      const spec = printOf(book);
      const kind = kindById(spec.kind);
      const checks = preflightPage(book, page, ctx.panels(), (l) => letterBox(l, sheetOf(book), page.widthIn, page.heightIn));
      const warns = checks.filter((c) => c.level === 'warn').length;
      const count = checkCount(book.pages.length, spec.binding === 'web' ? 'none' : spec.binding);
      const set = (patch: Partial<typeof spec>) => {
        studio.setPrint({ ...spec, ...patch, kind: patch.kind ?? (patch.bleed !== undefined || patch.safe !== undefined || patch.binding ? 'custom' : spec.kind) });
        ctx.chrome();
        ctx.request();
      };
      const num = (label: string, v: number, onSet: (x: number) => void, max: number) => {
        const i = h('input', { type: 'number', min: 0, max, step: 0.025, value: v, 'aria-label': label, style: 'width:76px' });
        i.addEventListener('change', () => {
          const x = Number(i.value);
          if (Number.isFinite(x) && x >= 0 && x <= max) onSet(x);
        });
        return h('label', { class: 'field' }, label, h('span', {}, i, ` in (${mmOf(v)})`));
      };
      const binding = h('select', { 'aria-label': 'Binding' }, (Object.keys(BINDING_LABEL) as Binding[]).map((b) => h('option', { value: b, selected: b === spec.binding }, BINDING_LABEL[b])));
      binding.addEventListener('change', () => set({ binding: binding.value as Binding }));
      const blanks = h('select', { 'aria-label': 'Blank pages go' },
        ([['end', 'At the end'], ['beforeBack', 'Before the back cover'], ['afterCover', 'After the front cover']] as [BlankPlace, string][]).map(([v, l]) => h('option', { value: v, selected: v === spec.blanks }, l)));
      blanks.addEventListener('change', () => set({ blanks: blanks.value as BlankPlace }));
      const rtl = h('input', { type: 'checkbox', checked: spec.rtl });
      rtl.addEventListener('change', () => set({ rtl: rtl.checked }));
      el.append(
        h('div', { class: 'insp-head' }, h('div', { class: 'kick' }, 'Print'), h('div', { class: 'ins-title' }, warns ? `${warns} thing${warns === 1 ? '' : 's'} to fix` : 'Ready to print')),
        h('div', { class: 'sec stack' }, h('h4', {}, kind ? kind.label : 'Custom print'),
          kind ? h('p', { class: 'note' }, `${size(kind.w, kind.h)}. ${kind.note} Suggested ${kind.dpi} dpi (this book: ${book.dpi}). Sizes are common values: always confirm with your printer.`) : null,
          num('Bleed', spec.bleed, (x) => set({ bleed: x }), 1),
          num('Safe area', spec.safe, (x) => set({ safe: x }), 2),
          h('label', { class: 'field' }, 'Binding', binding),
          h('label', { class: 'field' }, 'Blank pages go', blanks),
          h('label', { class: 'mini' }, rtl, 'Reads right to left (manga)')),
        h('div', { class: 'sec' }, h('h4', {}, 'Page count'),
          h('ul', { class: 'check' },
            h('li', { class: count.blanks ? 'warn' : '' }, count.blanks ? count.message : `${book.pages.length} pages: fits ${spec.binding === 'saddle' ? 'a booklet (multiple of 4)' : spec.binding === 'perfect' || spec.binding === 'hardcover' ? 'a bound book (even)' : 'loose pages'}.`),
            spec.binding === 'perfect' || spec.binding === 'hardcover' ? h('li', { class: 'info' }, `Spine about ${inch(spineWidth(count.total))} on standard 50 lb paper (ask your printer for theirs).`) : null)),
        h('div', { class: 'sec' }, h('h4', {}, 'Preflight'), h('ul', { class: 'check' }, checks.map((c) => h('li', { class: c.level === 'ok' ? '' : c.level }, c.text)))),
        h('div', { class: 'sec stack' }, h('h4', {}, 'Print and export'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => openExport(studio, 'print') }, 'Print it…'),
          h('button', { class: 'btn', type: 'button', onclick: () => openExport(studio, 'files') }, 'Export files…'),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            const bytes = await renderPagePng(page, art, book.dpi, sheetOf(book));
            download(new Blob([bytes as BlobPart], { type: 'image/png' }), `${slug(book.title)}-p${studio.pageNumber(page)}.png`);
            toast('Page PNG saved to your downloads.');
          } }, `Just this page (PNG, ${book.dpi} dpi)`)),
      );
    },
    overlay(g, s) {
      if (guides === 'none') return;
      const spec = printOf(book);
      const W = page.widthIn * s;
      const H = page.heightIn * s;
      const B = spec.bleed * s;
      const S = spec.safe * s;
      g.save();
      g.setLineDash([5, 4]);
      g.lineWidth = 1;
      if (B > 0) {
        g.strokeStyle = 'rgba(184,67,47,.8)';
        g.strokeRect(-B, -B, W + B * 2, H + B * 2);
      }
      g.strokeStyle = 'rgba(62,107,58,.9)';
      g.strokeRect(S, S, W - S * 2, H - S * 2);
      g.setLineDash([]);
      // crop marks
      g.strokeStyle = '#191A1F';
      const m = 0.18 * s;
      const off = B + 0.04 * s;
      for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
        const dx = x === 0 ? -1 : 1;
        const dy = y === 0 ? -1 : 1;
        g.beginPath();
        g.moveTo(x + dx * off, y);
        g.lineTo(x + dx * (off + m), y);
        g.moveTo(x, y + dy * off);
        g.lineTo(x, y + dy * (off + m));
        g.stroke();
      }
      g.restore();
    },
  };
  return mode;
}
