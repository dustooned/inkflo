import { newId, type BookAsset, type PageMark, type Pt } from '../doc/model';
import { printOf } from '../geom/printkinds';
import { IMAGE_ACCEPT, prepareAsset } from '../io/bookassets';
import { loadMarks, markImage, markSize } from '../render/marks';
import type { DeskCtx } from './desk';
import { h } from './dom';

/**
 * The Artist mark tool (Draw): choose the book's mark (a signature, monogram or symbol), place
 * it on the page, then move, resize, snap it to a corner, hide or delete it. Every change is one
 * undo step; the mark image is stored once in the book's assets and placements refer to it.
 */
export function markTool(ctx: DeskCtx) {
  const { page, studio, book } = ctx;
  let selectedId: string | null = null;
  let drag: { kind: 'move' | 'resize'; id: string; start: Pt; before: PageMark[] | undefined } | null = null;
  const marks = () => page.marks ?? [];
  const selected = () => marks().find((m) => m.id === selectedId) ?? null;
  const getAsset = (k: string) => studio.store.getAsset(k);
  const asset = (key: string | undefined): BookAsset | undefined => (book.assets ?? []).find((a) => a.key === key);

  function box(m: PageMark): { x0: number; y0: number; x1: number; y1: number } {
    const size = markSize(m) ?? { w: m.width, h: m.width };
    return { x0: m.x - size.w / 2, y0: m.y - size.h / 2, x1: m.x + size.w / 2, y1: m.y + size.h / 2 };
  }

  function commit(label: string, before: PageMark[] | undefined): void {
    const after = structuredClone(page.marks);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    page.marks = structuredClone(before);
    if (!page.marks) delete page.marks;
    studio.editPage(page, label, ['marks'], (p) => {
      if (after?.length) p.marks = after;
      else delete p.marks;
    });
    ctx.chrome();
    ctx.request();
  }
  const edit = (label: string, change: (list: PageMark[]) => void) => {
    const before = structuredClone(page.marks);
    page.marks = structuredClone(page.marks) ?? [];
    change(page.marks);
    commit(label, before);
  };

  async function chooseMark(key: string): Promise<void> {
    const before = book.artistMark;
    if (before === key) return;
    studio.run({ label: 'Set Artist mark', do: () => { book.artistMark = key; }, undo: () => { if (before) book.artistMark = before; else delete book.artistMark; } });
    await loadMarks([key], getAsset);
    ctx.chrome();
  }

  /** The mark at a corner inside the safe area (bottom right unless told otherwise). */
  function cornerOf(m: Pick<PageMark, 'key' | 'width'>, where: 'tl' | 'tr' | 'bl' | 'br'): Pt {
    const size = markSize({ ...m, id: '', x: 0, y: 0 }) ?? { w: m.width, h: m.width };
    const safe = Math.max(0.1, printOf(book).safe);
    const x = where.endsWith('l') ? safe + size.w / 2 : page.widthIn - safe - size.w / 2;
    const y = where.startsWith('t') ? safe + size.h / 2 : page.heightIn - safe - size.h / 2;
    return { x, y };
  }

  async function place(at?: Pt): Promise<void> {
    const key = book.artistMark;
    if (!key) return;
    await loadMarks([key], getAsset);
    const width = Math.min(1, Math.max(0.35, page.widthIn * 0.12, page.heightIn * 0.08));
    const spot = at ?? cornerOf({ key, width }, 'br');
    const mark: PageMark = { id: newId('mk'), key, x: spot.x, y: spot.y, width };
    edit('Place Artist mark', (list) => list.push(mark));
    selectedId = mark.id;
    ctx.chrome();
  }

  function inspector(el: HTMLElement): void {
    const current = asset(book.artistMark);
    const assets = book.assets ?? [];
    const thumb = (a: BookAsset) => {
      const img = h('img', { alt: '', class: 'mark-thumb' });
      void studio.store.getAsset(a.key).then((bytes) => { if (bytes) img.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })); });
      return img;
    };
    const importInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, 'aria-label': 'Import an Artist mark image' });
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const { asset: a, bytes } = await prepareAsset(file);
        await studio.addAssets([a], new Map([[a.key, bytes]]));
        await chooseMark(a.key);
        ctx.hint('Artist mark set. Place it on the page.', { timeout: 3000 });
      } catch (error) { ctx.hint(error instanceof Error ? error.message : String(error), { tone: 'warn' }); }
    });
    const m = selected();
    const dpiNote = (() => {
      if (!current) return null;
      const width = m?.width ?? Math.min(1, Math.max(0.35, page.widthIn * 0.12));
      const dpi = Math.round(current.width / width);
      const low = dpi < book.dpi;
      return h('p', { class: low ? 'warnline' : 'note', style: 'margin:0' },
        `${current.width} × ${current.height} px · ${dpi} dpi at ${width.toFixed(2)}″ wide` + (low ? ` (below this book's ${book.dpi} dpi; may print soft)` : ''));
    })();
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'insp-head' }, h('div', { class: 'ins-title' }, 'Artist mark')),
      h('div', { class: 'sec stack' },
        current
          ? h('div', { class: 'mark-current' }, thumb(current), h('div', {}, h('b', {}, current.name), h('small', {}, 'Your mark for this book')))
          : h('p', { class: 'note', style: 'margin:0' }, 'Your signature, monogram or symbol, stored once and placed on any page. A transparent PNG or WebP works best.'),
        assets.length ? h('details', { class: 'mark-pick', open: !current },
          h('summary', {}, current ? 'Choose another image' : 'Choose from this book’s images'),
          h('div', { class: 'mark-grid' }, assets.map((a) => h('button', { type: 'button', class: 'mark-option', 'aria-pressed': String(a.key === book.artistMark), title: a.name, onclick: () => void chooseMark(a.key) }, thumb(a), h('small', {}, a.name))))) : null,
        h('label', { class: 'field' }, 'Import a mark image', importInput),
        dpiNote,
        h('button', { class: 'btn primary', type: 'button', disabled: !current, onclick: () => void place() }, 'Place Artist mark')),
      m ? h('div', { class: 'sec stack' },
        h('h4', {}, 'This placement'),
        (() => {
          const w = h('input', { type: 'number', min: 0.1, max: page.widthIn, step: 0.05, value: Number(m.width.toFixed(2)), 'aria-label': 'Mark width in inches' });
          w.addEventListener('change', () => { const v = w.valueAsNumber; if (v > 0) edit('Resize Artist mark', (list) => { const x = list.find((y) => y.id === m.id); if (x) x.width = v; }); });
          return h('label', { class: 'field' }, 'Width (in)', w);
        })(),
        h('div', { class: 'mark-corners', role: 'group', 'aria-label': 'Move to a corner' },
          ([['tl', '↖ Top left'], ['tr', '↗ Top right'], ['bl', '↙ Bottom left'], ['br', '↘ Bottom right']] as const).map(([where, label]) =>
            h('button', { class: 'btn', type: 'button', onclick: () => edit('Move Artist mark', (list) => { const x = list.find((y) => y.id === m.id); if (x) Object.assign(x, cornerOf(x, where)); }) }, label))),
        h('div', { class: 'type-toggles' },
          h('button', { class: 'btn', type: 'button', 'aria-pressed': String(!!m.hidden), onclick: () => edit(m.hidden ? 'Show Artist mark' : 'Hide Artist mark', (list) => { const x = list.find((y) => y.id === m.id); if (x) { if (x.hidden) delete x.hidden; else x.hidden = true; } }) }, m.hidden ? 'Show' : 'Hide'),
          h('button', { class: 'btn danger', type: 'button', onclick: () => { edit('Delete Artist mark', (list) => list.splice(list.findIndex((y) => y.id === m.id), 1)); selectedId = null; ctx.chrome(); } }, 'Delete')),
        h('p', { class: 'note', style: 'margin:0' }, m.hidden ? 'Hidden: kept here but left out of the page and every export.' : 'Drag it on the page; drag its corner to resize.')) : null,
    ];
    el.append(...parts.filter((x): x is HTMLElement => !!x));
  }

  return {
    inspector, place,
    hasMark: () => !!book.artistMark,
    down(p: Pt): void {
      const sel = selected();
      if (sel) {
        const b = box(sel);
        if (Math.hypot(p.x - b.x1, p.y - b.y1) < 12 / ctx.scale()) { drag = { kind: 'resize', id: sel.id, start: p, before: structuredClone(page.marks) }; return; }
      }
      const hit = [...marks()].reverse().find((m) => { const b = box(m); return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1; });
      selectedId = hit?.id ?? null;
      if (hit) drag = { kind: 'move', id: hit.id, start: p, before: structuredClone(page.marks) };
      ctx.chrome();
      ctx.request();
    },
    move(p: Pt): void {
      const m = drag && marks().find((x) => x.id === drag!.id);
      const b = drag?.before?.find((x) => x.id === drag!.id);
      if (!drag || !m || !b) return;
      if (drag.kind === 'move') { m.x = b.x + p.x - drag.start.x; m.y = b.y + p.y - drag.start.y; }
      else {
        // resize from the corner, keeping the opposite corner put
        const size = markSize(b) ?? { w: b.width, h: b.width };
        const left = b.x - size.w / 2, top = b.y - size.h / 2;
        const width = Math.max(0.1, p.x - left);
        m.width = width;
        m.x = left + width / 2;
        m.y = top + width * (size.h / size.w) / 2;
      }
      ctx.request();
    },
    up(cancel: boolean): void {
      const d = drag;
      drag = null;
      if (!d) return;
      if (cancel) { page.marks = d.before; if (!page.marks) delete page.marks; ctx.request(); return; }
      commit(d.kind === 'move' ? 'Move Artist mark' : 'Resize Artist mark', d.before);
    },
    overlay(g: CanvasRenderingContext2D, s: number): void {
      g.save();
      for (const m of marks()) {
        const b = box(m);
        const on = m.id === selectedId;
        g.setLineDash(m.hidden ? [3, 4] : on ? [] : [5, 4]);
        g.lineWidth = on ? 1.5 : 1;
        g.strokeStyle = m.hidden ? 'rgba(128,128,128,.8)' : on ? '#2f7fd8' : 'rgba(47,127,216,.6)';
        g.strokeRect(b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
        if (m.hidden) {
          g.globalAlpha = 0.3;
          const img = markImage(m.key);
          if (img) g.drawImage(img, b.x0 * s, b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
          g.globalAlpha = 1;
        }
        if (on) {
          g.setLineDash([]);
          g.fillStyle = '#fff';
          g.fillRect(b.x1 * s - 5, b.y1 * s - 5, 10, 10);
          g.strokeRect(b.x1 * s - 5, b.y1 * s - 5, 10, 10);
        }
      }
      g.restore();
    },
  };
}
