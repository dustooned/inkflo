import type { Pt } from '../doc/model';
import { ALL, binOf, binsOf, deleteBin, itemsIn, moveToBin, renameBin, reorderBin, uniqueBin, UNSORTED, type BinItem } from '../geom/bins';
import { askText, confirmDialog, h, toast } from './dom';
import { closePopover, popover } from './popover';

/**
 * One bin panel for every kind of reusable thing (images in Draw, balloons in Caption, layouts
 * in Layout). Items sit in named bins; tap one to use it, drag it onto the page to use it there,
 * or onto a bin's name to sort it. Mouse and pen drag at once; a finger holds for a moment first
 * so the bin still scrolls, and hold-and-lift opens the item's menu.
 */
export interface MenuEntry { label: string; run: () => void }

export interface BinSource<T extends BinItem> {
  /** Remembers the open bin per source. */
  id: string;
  title: string;
  /** "image", "balloon", "layout": used in messages. */
  noun: string;
  read(): { bins?: string[]; items: T[] };
  /** Store a change (one undo step where the store has undo). */
  write(label: string, next: { bins: string[]; items: T[] }): void;
  /** Fixed items in their own bin, after the user's (can't be moved, renamed or removed). */
  builtIn?: { bin: string; items: T[] };
  thumb(item: T): HTMLElement;
  /** Use the item: at a page point, or null for "here" (selection, panel, page). */
  place(item: T, at: Pt | null): unknown;
  tip: string;
  empty: string;
  /** Extra menu entries, before Move / Rename / Remove. */
  menu?(item: T, builtIn: boolean): MenuEntry[];
  /** Extra header buttons (Add, Save, Manage). */
  head?(): HTMLElement[];
  /** Files dropped on the bins (`at` undefined) or on the page. Returns a status line. */
  files?(files: File[], bin: string, at?: Pt): Promise<string>;
  /** Throw with a message to refuse. */
  remove?(item: T): void;
  /** Anything else that should repaint the panel (an Artist mark, the page size). */
  extra?(): string;
}

const HOLD_MS = 280;

export function binPanel<T extends BinItem>(src: BinSource<T>, stage: HTMLElement, toPage: (e: { clientX: number; clientY: number }) => Pt) {
  const pref = 'inkflo:bin:' + src.id;
  let current: string = (() => { try { return localStorage.getItem(pref) ?? ALL; } catch { return ALL; } })();
  let search = '';
  let painted = '';
  const builtKeys = new Set(src.builtIn?.items.map((i) => i.key));
  const isBuilt = (t: T) => builtKeys.has(t.key);

  const chips = h('div', { class: 'bin-chips', role: 'tablist', 'aria-label': `${src.title}` });
  const grid = h('div', { class: 'bin-grid', role: 'list', 'aria-label': `${src.title} in this bin` });
  const status = h('p', { class: 'note bin-status', role: 'status' });
  const find = h('input', { type: 'search', placeholder: 'Find', 'aria-label': `Find ${src.noun}s by name`, class: 'bin-find' });
  find.addEventListener('input', () => { search = find.value; paint(true); });
  const head = h('div', { class: 'insp-head bin-head' }, h('div', { class: 'ins-title' }, src.title), h('span', { style: 'flex:1' }));
  const el = h('div', { class: 'asset-bins' }, head, chips, find, grid, status);

  const state = () => src.read();
  const all = (): T[] => [...state().items, ...(src.builtIn?.items ?? [])];
  const binList = () => {
    const user = binsOf(state());
    return src.builtIn ? [...user, src.builtIn.bin] : user;
  };
  const inBin = (bin: string) => bin === src.builtIn?.bin ? src.builtIn.items : itemsIn(state().items, bin);

  function save(label: string, next: { bins?: string[]; items?: T[] }): void {
    const s = state();
    src.write(label, { bins: next.bins ?? s.bins ?? [], items: next.items ?? s.items });
    paint(true);
  }
  const open = (bin: string) => { current = bin; try { localStorage.setItem(pref, bin); } catch { /* private mode */ } paint(true); };
  const userBins = () => binsOf(state()).filter((b) => b !== UNSORTED);

  async function newBin(withKey?: string): Promise<void> {
    const name = await askText('New bin', 'Name', uniqueBin(binList(), 'Bin'), 'Create');
    if (!name?.trim()) return;
    const made = uniqueBin(binList(), name);
    save('New bin', { bins: [...userBins(), made], ...(withKey ? { items: moveToBin(state().items, [withKey], made) } : {}) });
    open(made);
  }

  // ---- menus
  const entry = (label: string, run: () => void, disabled = false) => h('button', { class: 'item', type: 'button', disabled, onclick: () => { closePopover(); run(); } }, label);
  function binMenu(anchor: HTMLElement, bin: string): void {
    const list = userBins();
    const i = list.indexOf(bin);
    popover(anchor, h('div', { class: 'menu' },
      entry('Rename…', async () => {
        const name = await askText('Rename bin', 'Name', bin, 'Rename');
        if (!name?.trim() || name === bin) return;
        const at = binsOf(state()).indexOf(bin);
        const r = renameBin(state(), bin, name);
        save('Rename bin', r);
        open(r.bins[at] ?? ALL);
      }),
      entry('Move left', () => save('Move bin', { bins: reorderBin(list, bin, i - 1) }), i <= 0),
      entry('Move right', () => save('Move bin', { bins: reorderBin(list, bin, i + 1) }), i < 0 || i >= list.length - 1),
      entry('Delete bin…', async () => {
        const n = itemsIn(state().items, bin).length;
        if (n && !(await confirmDialog('Delete bin?', `The ${n} ${src.noun}${n === 1 ? '' : 's'} in “${bin}” move to Unsorted. Nothing is deleted.`, 'Delete bin'))) return;
        save('Delete bin', deleteBin(state(), bin));
        open(ALL);
      })), 'below', `${bin} bin`);
  }

  function itemMenu(anchor: HTMLElement, item: T): void {
    const built = isBuilt(item);
    const extra = src.menu?.(item, built) ?? [];
    const moves = built ? [] : binsOf(state()).concat(binsOf(state()).includes(UNSORTED) ? [] : [UNSORTED]).filter((b) => b !== binOf(item));
    popover(anchor, h('div', { class: 'menu' },
      ...(extra.length ? extra : [{ label: 'Use', run: () => void src.place(item, null) }]).map((e) => entry(e.label, e.run)),
      ...moves.map((b) => entry('Move to ' + b, () => save('Move to bin', { items: moveToBin(state().items, [item.key], b) }))),
      ...(built ? [] : [
        entry('New bin with this…', () => void newBin(item.key)),
        entry('Rename…', async () => {
          const name = (await askText(`Rename ${src.noun}`, 'Name', item.name, 'Rename'))?.trim().slice(0, 120);
          if (!name || name === item.name) return;
          save(`Rename ${src.noun}`, { items: state().items.map((a) => a.key === item.key ? { ...a, name } : a) });
        }),
        ...(src.remove ? [entry('Remove', () => { try { src.remove!(item); paint(true); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } })] : []),
      ])), 'left', item.name);
  }

  // ---- drag: a ghost follows the pointer; drop on the page or a bin chip
  let drag: { item: T; tile: HTMLElement; id: number; x: number; y: number; type: string; live: boolean; timer: number; ghost: HTMLElement | null; held: boolean } | null = null;
  const targetAt = (x: number, y: number): { bin: string } | { page: true } | null => {
    const under = document.elementFromPoint(x, y);
    const chip = under?.closest<HTMLElement>('.bin-chip[data-bin]');
    if (chip && chips.contains(chip) && chip.dataset.bin !== undefined) return { bin: chip.dataset.bin };
    if (under && stage.contains(under)) return { page: true };
    return null;
  };
  const mark = (x: number, y: number) => {
    const t = targetAt(x, y);
    chips.querySelectorAll<HTMLElement>('.bin-chip').forEach((c) => c.classList.toggle('drop', !!t && 'bin' in t && c.dataset.bin === t.bin));
    stage.classList.toggle('bin-drop', !!t && 'page' in t);
  };
  function begin(): void {
    if (!drag) return;
    drag.live = true;
    const pic = drag.tile.querySelector('img, canvas');
    const ghost = pic instanceof HTMLImageElement ? h('img', { src: pic.src, alt: '' })
      : pic instanceof HTMLCanvasElement ? (() => { const c = document.createElement('canvas'); c.width = pic.width; c.height = pic.height; c.getContext('2d')!.drawImage(pic, 0, 0); return c; })()
        : h('span', {}, drag.item.name);
    drag.ghost = h('div', { class: 'bin-ghost', 'aria-hidden': 'true' }, ghost);
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
      if (d.held) itemMenu(d.tile, d.item);
      else void src.place(d.item, null);
      return;
    }
    const t = targetAt(e.clientX, e.clientY);
    if (!t) return;
    if ('bin' in t) {
      const to = t.bin;
      if (isBuilt(d.item)) { status.textContent = `Built-in ${src.noun}s stay in ${src.builtIn!.bin}.`; return; }
      if (to && to !== src.builtIn?.bin && to !== binOf(d.item)) { save('Move to bin', { items: moveToBin(state().items, [d.item.key], to) }); status.textContent = `Moved ${d.item.name} to ${to}.`; }
      return;
    }
    void src.place(d.item, toPage(e));
  }
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
      else return;
    }
    moveGhost(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) finish(e.type === 'pointercancel' ? null : e); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function tile(item: T): HTMLElement {
    const t = h('button', { class: 'bin-tile', type: 'button', role: 'listitem', title: `${item.name}\n${src.tip}`, 'aria-label': `${item.name}. ${src.tip}` },
      src.thumb(item), h('span', {}, item.name));
    t.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      drag = { item, tile: t, id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, live: false, timer: 0, ghost: null, held: false };
      if (e.pointerType === 'touch') {
        t.classList.add('holding');
        drag.timer = window.setTimeout(() => { if (drag?.tile === t) { drag.held = true; t.classList.add('held'); navigator.vibrate?.(8); } }, HOLD_MS);
      } else e.preventDefault();
    });
    t.addEventListener('click', (e) => { if (e.detail === 0) void src.place(item, null); });
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); finish(null); itemMenu(t, item); });
    t.addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); itemMenu(t, item); } });
    return t;
  }

  function chip(bin: string, label: string, count: number, fixed: boolean): HTMLElement {
    const on = bin === current;
    const c = h('button', { class: 'bin-chip' + (on ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(on), 'data-bin': bin, title: on && !fixed ? 'Tap again to rename, reorder or delete' : `Open ${label}${fixed ? '' : ` · drop a ${src.noun} here to move it`}` },
      label, h('small', {}, String(count)));
    c.addEventListener('click', () => { if (on && !fixed) binMenu(c, bin); else open(bin); });
    c.addEventListener('contextmenu', (e) => { if (!fixed) { e.preventDefault(); binMenu(c, bin); } });
    return c;
  }

  function paint(force = false): void {
    const s = state();
    const key = JSON.stringify([s.items, s.bins, current, search, src.extra?.()]);
    if (!force && key === painted) return;
    painted = key;
    const bins = binList();
    if (current !== ALL && !bins.includes(current)) current = ALL;
    const items = all();
    head.replaceChildren(h('div', { class: 'ins-title' }, src.title), h('span', { style: 'flex:1' }), ...(src.head?.() ?? []));
    chips.replaceChildren(chip(ALL, 'All', items.length, true),
      ...bins.map((b) => chip(b, b, inBin(b).length, b === UNSORTED || b === src.builtIn?.bin)),
      h('button', { class: 'bin-chip add', type: 'button', title: 'New bin', 'aria-label': 'New bin', onclick: () => void newBin() }, '+'));
    find.hidden = items.length < 9;
    const q = search.trim().toLowerCase();
    const shown = (current === ALL ? items : inBin(current)).filter((i) => !q || i.name.toLowerCase().includes(q));
    grid.replaceChildren(...shown.map(tile));
    if (!shown.length) grid.append(h('p', { class: 'note bin-empty' }, search ? 'Nothing matches.' : items.length ? `Drag ${src.noun}s onto this bin’s name to sort them here.` : src.empty));
  }

  // ---- files from the computer
  const hasFiles = (e: DragEvent) => !!src.files && [...e.dataTransfer?.types ?? []].includes('Files');
  const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; (e.currentTarget as HTMLElement).classList.add('file-over'); };
  const leave = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('file-over');
  const fileBin = () => current === ALL || current === src.builtIn?.bin ? UNSORTED : current;
  const takeFiles = async (files: File[], at?: Pt) => {
    status.textContent = `Adding ${files.length}…`;
    try { status.textContent = await src.files!(files, fileBin(), at); } catch (e) { status.textContent = e instanceof Error ? e.message : 'Could not add those files.'; }
    paint(true);
  };
  const dropOnBins = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); leave(e); void takeFiles([...e.dataTransfer!.files]); };
  const dropOnPage = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); leave(e); void takeFiles([...e.dataTransfer!.files], toPage(e)); };
  el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', dropOnBins);
  if (src.files) { stage.addEventListener('dragover', over); stage.addEventListener('dragleave', leave); stage.addEventListener('drop', dropOnPage); }

  paint(true);
  return {
    el,
    /** The bin new items should go into. */
    bin: fileBin,
    say: (text: string) => { status.textContent = text; },
    takeFiles,
    refresh: (force = false) => paint(force),
    dispose(): void {
      finish(null);
      document.removeEventListener('touchmove', noScroll);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('dragover', over); stage.removeEventListener('dragleave', leave); stage.removeEventListener('drop', dropOnPage);
    },
  };
}

/** A sidebar switch between a desk's own inspector and its bins, remembered per desk. */
export function sideChoice(desk: string, label: string, onChange: () => void) {
  const key = 'inkflo:side:' + desk;
  let side: 'main' | 'bins' = (() => { try { return localStorage.getItem(key) === 'bins' ? 'bins' : 'main'; } catch { return 'main'; } })();
  return {
    bins: () => side === 'bins',
    switcher(): HTMLElement {
      const wrap = h('div', { class: 'sec side-switch' });
      const b = (id: 'main' | 'bins', text: string) => h('button', { type: 'button', 'aria-pressed': String(side === id), onclick: () => {
        side = id;
        try { localStorage.setItem(key, id); } catch { /* private mode */ }
        onChange();
      } }, text);
      wrap.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Sidebar' }, b('main', label), b('bins', 'Bins')));
      return wrap;
    },
  };
}
