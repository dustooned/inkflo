import type { Studio } from '../app/studio';
import type { BookAsset, Pt } from '../doc/model';
import { ALL, assetsIn, binOf, binsOf, deleteBin, moveToBin, renameBin, reorderBin, uniqueBin, UNSORTED, withBin } from '../geom/bins';
import { IMAGE_ACCEPT, prepareAsset } from '../io/bookassets';
import { loadMarks } from '../render/marks';
import { openBookAssets } from './bookassets';
import { askText, confirmDialog, h, toast } from './dom';
import { closePopover, popover } from './popover';
import { askToReduce } from './reducechoice';

/**
 * Asset bins in the Draw sidebar: the book's images sorted into named bins, placed by a tap or
 * by dragging onto the page. Mouse and pen drag at once; a finger holds for a moment first so the
 * bin still scrolls. Files dropped on the bins (or straight onto the page) are added to the open
 * bin. Every change is one undo step.
 */
export interface BinsHost {
  studio: Studio;
  /** Place on the page; `at` is a page point, or null for the selected panel / page. */
  place(asset: BookAsset, at: Pt | null, reference?: boolean): Promise<boolean>;
  /** Where assets can be dropped, and how to turn a pointer into a page point. */
  stage: HTMLElement;
  toPage(e: { clientX: number; clientY: number }): Pt;
}

const PREF = 'inkflo:bin';
const HOLD_MS = 280;

export function assetBins(host: BinsHost) {
  const { studio, stage } = host;
  let current: string = (() => { try { return localStorage.getItem(PREF) ?? ALL; } catch { return ALL; } })();
  let search = '';
  let painted = '';
  const urls = new Map<string, string>();
  const book = () => studio.book!;

  const chips = h('div', { class: 'bin-chips', role: 'tablist', 'aria-label': 'Asset bins' });
  const grid = h('div', { class: 'bin-grid', role: 'list', 'aria-label': 'Assets in this bin' });
  const status = h('p', { class: 'note bin-status', role: 'status' });
  const find = h('input', { type: 'search', placeholder: 'Find', 'aria-label': 'Find assets by name', class: 'bin-find' });
  find.addEventListener('input', () => { search = find.value; paint(true); });
  const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, multiple: true, hidden: true, 'aria-label': 'Add images to this bin' });
  fileInput.addEventListener('change', () => { const files = [...fileInput.files ?? []]; fileInput.value = ''; void addFiles(files); });
  const el = h('div', { class: 'asset-bins' },
    h('div', { class: 'insp-head bin-head' }, h('div', { class: 'ins-title' }, 'Bins'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', type: 'button', title: 'Add images to this bin', onclick: () => fileInput.click() }, '+ Add'),
      h('button', { class: 'btn', type: 'button', title: 'Asset packs, copying from other books, downloads', onclick: () => openBookAssets(studio) }, 'Manage'),
      fileInput),
    chips, find, grid, status);

  // ---- changes (one undo step each)
  function setBins(label: string, next: { bins?: string[]; assets?: BookAsset[] }): void {
    const b = book();
    const before = { bins: b.bins, assets: b.assets };
    const after = { bins: next.bins ?? b.bins, assets: next.assets ?? b.assets };
    const apply = (s: typeof before) => { if (s.bins?.length) b.bins = s.bins; else delete b.bins; b.assets = s.assets; };
    studio.run({ label, do: () => apply(after), undo: () => apply(before) });
    paint(true);
  }
  const open = (bin: string) => { current = bin; try { localStorage.setItem(PREF, bin); } catch { /* private mode */ } paint(true); };

  async function newBin(): Promise<void> {
    const name = await askText('New bin', 'Name', uniqueBin(binsOf(book()), 'Bin'), 'Create');
    if (!name?.trim()) return;
    const made = uniqueBin(binsOf(book()), name);
    setBins('New bin', { bins: [...binsOf(book()).filter((b) => b !== UNSORTED), made] });
    open(made);
  }

  async function addFiles(files: File[], at?: Pt): Promise<void> {
    const images = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    if (!images.length) { toast('Drop PNG, JPEG or WebP images.'); return; }
    status.textContent = `Adding ${images.length} image${images.length === 1 ? '' : 's'}…`;
    const bin = current === ALL ? UNSORTED : current;
    const assets: BookAsset[] = [], bytes = new Map<string, Uint8Array>();
    let skipped = 0;
    for (const f of images) {
      try { const r = await prepareAsset(f, askToReduce); assets.push(withBin(r.asset, bin)); bytes.set(r.asset.key, r.bytes); }
      catch { skipped++; }
    }
    try {
      const added = await studio.addAssets(assets, bytes);
      status.textContent = `Added ${added} to ${bin}.${skipped ? ` ${skipped} couldn’t be read.` : ''}${added < assets.length ? ' Some were already in this book.' : ''}`;
      paint(true);
      // dropped on the page: place what was dropped, side by side
      if (at) for (const [i, a] of assets.entries()) {
        const stored = book().assets?.find((x) => x.key === a.key);
        if (stored) await host.place(stored, { x: at.x + i * 0.3, y: at.y + i * 0.3 });
      }
    } catch (e) { status.textContent = e instanceof Error ? e.message : 'Could not add those images.'; }
  }

  // ---- menus
  function binMenu(anchor: HTMLElement, bin: string): void {
    const list = binsOf(book()).filter((b) => b !== UNSORTED);
    const i = list.indexOf(bin);
    const item = (label: string, run: () => void, disabled = false) => h('button', { class: 'item', type: 'button', disabled, onclick: () => { closePopover(); run(); } }, label);
    popover(anchor, h('div', { class: 'menu' },
      item('Rename…', async () => {
        const name = await askText('Rename bin', 'Name', bin, 'Rename');
        if (!name?.trim() || name === bin) return;
        const at = binsOf(book()).indexOf(bin);
        const r = renameBin(book(), bin, name);
        setBins('Rename bin', r);
        open(r.bins[at] ?? ALL);
      }),
      item('Move left', () => setBins('Move bin', { bins: reorderBin(list, bin, i - 1) }), i <= 0),
      item('Move right', () => setBins('Move bin', { bins: reorderBin(list, bin, i + 1) }), i < 0 || i >= list.length - 1),
      item('Delete bin…', async () => {
        const n = assetsIn(book().assets, bin).length;
        if (n && !(await confirmDialog('Delete bin?', `The ${n} image${n === 1 ? '' : 's'} in “${bin}” move to Unsorted. Nothing is deleted from the book.`, 'Delete bin'))) return;
        setBins('Delete bin', deleteBin(book(), bin));
        open(ALL);
      })), 'below', `${bin} bin`);
  }

  function assetMenu(anchor: HTMLElement, asset: BookAsset): void {
    const item = (label: string, run: () => void, extra: Record<string, string> = {}) => h('button', { class: 'item', type: 'button', ...extra, onclick: () => { closePopover(); run(); } }, label);
    const moveTo = binsOf(book()).concat(binsOf(book()).includes(UNSORTED) ? [] : [UNSORTED]).filter((b) => b !== binOf(asset));
    popover(anchor, h('div', { class: 'menu' },
      item('Place in the middle', () => void host.place(asset, null)),
      item('Place as reference', () => void host.place(asset, null, true)),
      ...moveTo.map((b) => item('Move to ' + b, () => setBins('Move to bin', { assets: moveToBin(book().assets ?? [], [asset.key], b) }))),
      item('New bin with this…', async () => {
        const name = await askText('New bin', 'Name', uniqueBin(binsOf(book()), 'Bin'), 'Create');
        if (!name?.trim()) return;
        const made = uniqueBin(binsOf(book()), name);
        setBins('New bin', { bins: [...binsOf(book()).filter((b) => b !== UNSORTED), made], assets: moveToBin(book().assets ?? [], [asset.key], made) });
        open(made);
      }),
      item('Rename…', async () => {
        const name = (await askText('Rename image', 'Name', asset.name, 'Rename'))?.trim().slice(0, 120);
        if (!name || name === asset.name) return;
        setBins('Rename asset', { assets: (book().assets ?? []).map((a) => a.key === asset.key ? { ...a, name } : a) });
      }),
      item(book().artistMark === asset.key ? 'Artist mark ✓' : 'Use as Artist mark', () => {
        const b = book(), before = b.artistMark;
        if (before === asset.key) return;
        studio.run({ label: 'Set Artist mark', do: () => { b.artistMark = asset.key; }, undo: () => { if (before) b.artistMark = before; else delete b.artistMark; } });
        void loadMarks([asset.key], (k) => studio.store.getAsset(k));
        paint(true);
      }),
      item('Remove from book', () => { try { studio.removeAsset(asset.key); paint(true); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } })),
    'left', asset.name);
  }

  // ---- drag: one pointer at a time; a ghost follows it; drop on the page or a bin chip
  let drag: { asset: BookAsset; tile: HTMLElement; id: number; x: number; y: number; type: string; live: boolean; timer: number; ghost: HTMLElement | null; held: boolean } | null = null;
  const targetAt = (x: number, y: number): { bin: string } | { page: true } | null => {
    const under = document.elementFromPoint(x, y);
    const chip = under?.closest<HTMLElement>('.bin-chip[data-bin]');
    if (chip && chip.dataset.bin !== undefined) return { bin: chip.dataset.bin };
    if (under && stage.contains(under)) return { page: true };
    return null;
  };
  const mark = (x: number, y: number) => {
    const t = targetAt(x, y);
    chips.querySelectorAll('.bin-chip').forEach((c) => c.classList.toggle('drop', !!t && 'bin' in t && (c as HTMLElement).dataset.bin === t.bin));
    stage.classList.toggle('bin-drop', !!t && 'page' in t);
  };
  function begin(): void {
    if (!drag) return;
    drag.live = true;
    const img = drag.tile.querySelector('img');
    drag.ghost = h('div', { class: 'bin-ghost', 'aria-hidden': 'true' }, img ? h('img', { src: img.src, alt: '' }) : drag.asset.name);
    document.body.append(drag.ghost);
    drag.tile.classList.add('dragging');
    moveGhost(drag.x, drag.y);
  }
  const moveGhost = (x: number, y: number) => { if (drag?.ghost) drag.ghost.style.transform = `translate(${x - 36}px, ${y - 36}px)`; mark(x, y); };
  function finish(e: PointerEvent | null): void {
    const d = drag;
    drag = null;
    if (!d) return;
    clearTimeout(d.timer);
    d.ghost?.remove();
    d.tile.classList.remove('dragging', 'holding', 'held');
    stage.classList.remove('bin-drop');
    chips.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop'));
    if (!e) return;
    if (!d.live) {
      // a finger held then lifted without moving: the menu; a quick tap: place
      if (d.held) assetMenu(d.tile, d.asset);
      else void host.place(d.asset, null);
      return;
    }
    const t = targetAt(e.clientX, e.clientY);
    if (!t) return;
    if ('bin' in t) {
      const to = t.bin === ALL ? null : t.bin;
      if (to && to !== binOf(d.asset)) { setBins('Move to bin', { assets: moveToBin(book().assets ?? [], [d.asset.key], to) }); status.textContent = `Moved ${d.asset.name} to ${to}.`; }
      return;
    }
    void host.place(d.asset, host.toPage(e));
  }
  // a finger: stop the bin scrolling once the drag has started
  const noScroll = (e: TouchEvent) => { if (drag?.live) e.preventDefault(); };
  document.addEventListener('touchmove', noScroll, { passive: false });
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.live) {
      if (drag.type === 'touch') {
        if (far <= 10) return;
        // moved before the hold finished: the finger is scrolling the bin, not dragging
        if (!drag.held) { clearTimeout(drag.timer); drag.tile.classList.remove('holding'); drag = null; return; }
        begin();
      } else if (far > 6) begin();
      if (!drag?.live) return;
    }
    moveGhost(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) finish(e.type === 'pointercancel' ? null : e); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function tile(asset: BookAsset): HTMLElement {
    const img = h('img', { alt: '', draggable: false });
    const url = urls.get(asset.key);
    if (url) img.src = url;
    else void studio.store.getAsset(asset.key).then((data) => {
      if (!data) return;
      const u = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/png' }));
      urls.set(asset.key, u);
      img.src = u;
    });
    const t = h('button', { class: 'bin-tile', type: 'button', role: 'listitem', title: `${asset.name} · ${asset.width} × ${asset.height} px\nTap to place · drag onto the page or a bin`, 'aria-label': `${asset.name}. Place on the page` },
      img, h('span', {}, asset.name));
    t.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      drag = { asset, tile: t, id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, live: false, timer: 0, ghost: null, held: false };
      if (e.pointerType === 'touch') {
        t.classList.add('holding');
        drag.timer = window.setTimeout(() => { if (drag?.tile === t) { drag.held = true; t.classList.add('held'); navigator.vibrate?.(8); } }, HOLD_MS);
      } else e.preventDefault(); // no text selection while dragging with a mouse
    });
    // keyboard: Enter / Space place it; the context key opens the menu
    t.addEventListener('click', (e) => { if (e.detail === 0) void host.place(asset, null); });
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); finish(null); assetMenu(t, asset); });
    t.addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); assetMenu(t, asset); } });
    return t;
  }

  function chip(bin: string, label: string, count: number): HTMLElement {
    const on = bin === current;
    const c = h('button', { class: 'bin-chip' + (on ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(on), 'data-bin': bin, title: on && bin !== ALL && bin !== UNSORTED ? 'Tap again to rename, reorder or delete' : `Open ${label} · drop an image here to move it` },
      label, h('small', {}, String(count)));
    c.addEventListener('click', () => { if (on && bin !== ALL && bin !== UNSORTED) binMenu(c, bin); else open(bin); });
    c.addEventListener('contextmenu', (e) => { if (bin !== ALL && bin !== UNSORTED) { e.preventDefault(); binMenu(c, bin); } });
    return c;
  }

  function paint(force = false): void {
    const b = studio.book;
    if (!b) return;
    const key = JSON.stringify([b.assets, b.bins, current, search, b.artistMark]);
    if (!force && key === painted) return;
    painted = key;
    const bins = binsOf(b);
    if (current !== ALL && !bins.includes(current)) current = ALL;
    const all = b.assets ?? [];
    chips.replaceChildren(chip(ALL, 'All', all.length), ...bins.map((x) => chip(x, x, assetsIn(all, x).length)),
      h('button', { class: 'bin-chip add', type: 'button', title: 'New bin', 'aria-label': 'New bin', onclick: () => void newBin() }, '+'));
    find.hidden = all.length < 9;
    const shown = assetsIn(all, current, search);
    grid.replaceChildren(...shown.map(tile));
    if (!shown.length) grid.append(h('p', { class: 'note bin-empty' }, search ? 'No images match.' : all.length ? 'Drag images onto this bin’s name to sort them here.' : 'Drop images here, or tap + Add. Then drag them onto the page.'));
    for (const [k, u] of urls) if (!all.some((a) => a.key === k)) { URL.revokeObjectURL(u); urls.delete(k); }
  }

  // ---- files from the computer: onto the bins, or straight onto the page
  const hasFiles = (e: DragEvent) => [...e.dataTransfer?.types ?? []].includes('Files');
  const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; (e.currentTarget as HTMLElement).classList.add('file-over'); };
  const leave = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('file-over');
  const dropOnBins = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); leave(e); void addFiles([...e.dataTransfer!.files]); };
  const dropOnPage = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); leave(e); void addFiles([...e.dataTransfer!.files], host.toPage(e)); };
  el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', dropOnBins);
  stage.addEventListener('dragover', over); stage.addEventListener('dragleave', leave); stage.addEventListener('drop', dropOnPage);

  paint(true);
  return {
    el,
    /** Repaint if the book's assets or bins changed (undo, another dialog). */
    refresh: () => paint(),
    dispose(): void {
      finish(null);
      document.removeEventListener('touchmove', noScroll);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('dragover', over); stage.removeEventListener('dragleave', leave); stage.removeEventListener('drop', dropOnPage);
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
