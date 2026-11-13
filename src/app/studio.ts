import { scalePanelTransforms } from '../geom/pagetemplates';
import { newBook, newId, newPage, pagePixels, sheetOf, type Book, type BookAsset, type Page, type PrintSpec, type Stage } from '../doc/model';
import { assetsOf, parseBookFile, readBookAssets, stringifyBookFile } from '../doc/schema';
import { newPageArt, referencedKeys, Residency, type PageArt } from '../draw/residency';
import { History, type Command } from '../engine/core/history';
import { readZip, writeZip } from '../engine/io/zip';
import { Autosaver, type SaveState } from '../io/autosave';
import { captureBook } from '../io/capture';
import { browserPlaneOps, encodePng } from '../io/canvasops';
import { loadBookFile } from '../io/load';
import { metaFromFile, openStore, requestPersistence, type BookMeta, type Store } from '../io/persist';
import { renderThumb } from '../render/page';
import { readUserBrushes, setBookBrushes, setUserBrushes, snapshotId, type BrushEntry } from '../draw/brushes';
import { gridCuts } from '../geom/composition';
import { derivePanels, layoutOf } from '../geom/carve';
import { reconcileDialogue } from '../geom/lettering';

/**
 * The app's one piece of state: the library, the open book, its page art, ONE undo stack per
 * book (rule 2) and autosave. Every document change goes through `run()` as a command.
 */

export type Listener = () => void;

export class Studio {
  book: Book | null = null;
  art = new Map<string, PageArt>();
  readonly history = new History(300);
  readonly residency: Residency;
  saver!: Autosaver;
  persistent = false;
  /** True while the pen is down (autosave waits). */
  drawing = false;
  private listeners = new Set<Listener>();
  private warnings: string[] = [];
  private assetHistory = new Set<string>();

  private constructor(readonly store: Store) {
    this.residency = new Residency(browserPlaneOps, (k) => this.store.getAsset(k));
    this.residency.onWarning = (m) => this.warn(m);
    this.residency.onReady = () => this.emit();
    this.saver = new Autosaver(store, () => captureBook(this.book!, this.art, browserPlaneOps), {
      busy: () => this.drawing,
      cover: () => this.cover(),
      keep: () => new Set([...referencedKeys(this.art.values()), ...this.assetHistory, ...this.book?.assets?.map(({ key }) => key) ?? []]),
    });
    this.saver.onStatus = () => this.emit();
    this.history.onChange = () => this.emit();
  }

  static async open(): Promise<Studio> {
    const { store, persistent } = await openStore();
    const s = new Studio(store);
    s.persistent = persistent;
    setUserBrushes(readUserBrushes(await store.getSetting('brushes.user.v1')));
    void requestPersistence();
    window.addEventListener('pagehide', () => void s.saver.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void s.saver.flush();
    });
    return s;
  }

  // ---- events

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  warn(message: string): void {
    this.warnings.push(message);
    window.dispatchEvent(new CustomEvent('inkflo:toast', { detail: message }));
  }

  get saveState(): SaveState {
    return this.saver.state;
  }

  // ---- library

  listBooks(): Promise<BookMeta[]> {
    return this.store.listBooks();
  }

  async createBook(title: string, author: string, setup?: (book: Book) => void): Promise<Book> {
    await this.close();
    const book = newBook(title || 'Untitled book', author);
    setup?.(book);
    this.attach(book, new Map());
    this.saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: '', book, art: {} }), false);
    await this.store.putSetting('lastBook', book.id);
    return book;
  }

  async openBook(id: string): Promise<Book> {
    if (this.book?.id === id) return this.book;
    await this.close();
    const head = await this.store.getHead(id);
    if (!head) throw new Error('That book is not in this library.');
    const { book, art } = loadBookFile(parseBookFile(head.json));
    this.attach(book, art);
    const meta = (await this.store.getBook(id)) ?? metaFromFile(parseBookFile(head.json));
    meta.opened = Date.now();
    void this.store.putBookMeta(meta);
    this.saver.open(meta, true);
    await this.store.putSetting('lastBook', id);
    return book;
  }

  async close(): Promise<void> {
    if (!this.book) return;
    await this.saver.flush();
    await this.saver.idle();
    this.book = null;
    this.art = new Map();
    this.residency.setPages(this.art);
    this.history.clear();
  }

  async deleteBook(id: string): Promise<void> {
    if (this.book?.id === id) {
      this.book = null;
      this.art = new Map();
      this.residency.setPages(this.art);
      this.history.clear();
      this.saver.meta = null;
    }
    await this.saver.then(() => this.store.deleteBook(id));
    this.emit();
  }

  async renameBook(title: string, author: string): Promise<void> {
    const b = this.requireBook();
    const before = { title: b.title, author: b.author };
    this.run({
      label: 'Rename book',
      do: () => Object.assign(b, { title, author }),
      undo: () => Object.assign(b, before),
    });
  }

  private attach(book: Book, art: Map<string, PageArt>): void {
    this.assetHistory.clear();
    this.book = book;
    setBookBrushes(book.brushes);
    this.art = art;
    for (const page of book.pages) this.ensureArt(page);
    this.residency.setPages(this.art);
    this.history.clear();
  }

  private requireBook(): Book {
    if (!this.book) throw new Error('No book is open.');
    return this.book;
  }

  /** Every page has art (blank until drawn), sized from the book's dpi. */
  ensureArt(page: Page): PageArt {
    let a = this.art.get(page.id);
    if (!a) {
      const { width, height } = pagePixels(page, this.requireBook().dpi);
      a = newPageArt(page.id, `Page ${this.pageNumber(page)}`, width, height);
      this.art.set(page.id, a);
    }
    return a;
  }

  page(id: string): Page | null {
    return this.book?.pages.find((p) => p.id === id) ?? null;
  }

  pageNumber(page: Page): number {
    return (this.book?.pages.indexOf(page) ?? -1) + 1;
  }

  // ---- commands

  /** Run a command, record it, and mark the book for autosave. */
  run(cmd: Command, applied = false): void {
    this.history.push(this.wrap(cmd), applied);
    this.saver.markDirty();
  }

  private wrap(cmd: Command): Command {
    const touch = () => {
      if (this.book) this.book.updatedAt = Date.now();
    };
    return {
      label: cmd.label,
      do: () => {
        cmd.do();
        touch();
      },
      undo: () => {
        cmd.undo();
        touch();
      },
    };
  }

  /** Called after undo or redo: views rebuild panels that show document values. */
  readonly afterUndo = new Set<() => void>();

  undo(): void {
    if (!this.history.undo()) return;
    this.saver.markDirty();
    for (const fn of [...this.afterUndo]) fn();
  }

  redo(): void {
    if (!this.history.redo()) return;
    this.saver.markDirty();
    for (const fn of [...this.afterUndo]) fn();
  }

  /**
   * Change some fields of a page as one command. The fields are deep-copied before and after,
   * so undo restores them exactly.
   */
  editPage<K extends keyof Page>(page: Page, label: string, keys: K[], mutate: (p: Page) => void): void {
    const sync = this.book && keys.some((k) => k === 'cuts') && (page.autoLetter || page.balloons.some((l) => l.generated));
    const fields: (keyof Page)[] = sync ? [...new Set<keyof Page>([...keys, 'beats', 'balloons'])] : keys;
    const snap = () => Object.fromEntries(fields.map((k) => [k, structuredClone(page[k])]));
    const before = snap();
    mutate(page);
    if (sync) reconcileDialogue(this.book!, page, derivePanels(page));
    const after = snap();
    page.updatedAt = Date.now();
    this.run(
      {
        label,
        do: () => Object.assign(page, structuredClone(after)),
        undo: () => Object.assign(page, structuredClone(before)),
      },
      true,
    );
  }

  /** Set a page's stage state (todo / wip / done) without an undo step of its own. */
  markStage(page: Page, stage: Stage, state: 0 | 1 | 2): void {
    if (page.state[stage] >= state) return;
    page.state[stage] = state;
    this.saver.markDirty();
  }

  setLast(page: Page, stage: Stage): void {
    const b = this.requireBook();
    if (b.lastPageId === page.id && b.lastStage === stage) return;
    b.lastPageId = page.id;
    b.lastStage = stage;
    this.saver.markDirty();
  }

  addPage(after?: Page, setup?: (page: Page) => void): Page {
    const b = this.requireBook();
    const page = newPage();
    const size = after ?? b.pages.at(-1);
    if (size) {
      page.widthIn = size.widthIn;
      page.heightIn = size.heightIn;
      if (b.print?.binding === 'web') {
        const { panelCorners: _corners, panelTransforms: _transforms, ...sectionStyle } = layoutOf(size);
        page.layout = sectionStyle;
      }
    }
    if (b.fixedGrid) {
      page.cuts = gridCuts(page, b.fixedGrid);
      page.layout = { ...layoutOf(page), gutter: b.fixedGrid.gutter };
    }
    setup?.(page);
    const at = after ? b.pages.indexOf(after) + 1 : b.pages.length;
    this.ensureArt(page);
    this.run({
      label: 'New page',
      do: () => b.pages.splice(at, 0, page),
      undo: () => b.pages.splice(b.pages.indexOf(page), 1),
    });
    return page;
  }

  deletePage(page: Page): void {
    const b = this.requireBook();
    if (b.pages.length <= 1) return;
    const at = b.pages.indexOf(page);
    this.run({
      label: 'Delete page',
      do: () => b.pages.splice(b.pages.indexOf(page), 1),
      undo: () => b.pages.splice(at, 0, page),
    });
  }

  movePage(page: Page, to: number): void {
    const b = this.requireBook();
    const from = b.pages.indexOf(page);
    if (from < 0 || to === from || to < 0 || to >= b.pages.length) return;
    const move = (a: number, z: number) => {
      const [p] = b.pages.splice(a, 1);
      b.pages.splice(z, 0, p!);
    };
    this.run({ label: 'Move page', do: () => move(from, to), undo: () => move(to, from) });
  }

  // ---- print

  /** True when no page has any drawn art yet (strokes, fills or stored bitmaps). */
  get blankArt(): boolean {
    const b = this.requireBook();
    return b.pages.every((p) => p.groups.every((g) => g.layers.every((l) => !l.image && !l.screenTone && !l.strokes.length && !l.fills.length && !l.pixelTransforms?.length))) &&
      [...this.art.values()].every((a) => Object.values(a.planes).every((c) => !c));
  }

  /**
   * Set how the book prints, as one undo step. With a trim (`size`), pages take that size while
   * nothing is drawn: cuts, balloons and group anchors are scaled to the new page, and the blank
   * bitmaps are re-made at the new size.
   */
  setPrint(spec: PrintSpec, size?: { w: number; h: number }): void {
    const b = this.requireBook();
    const before = b.print ? { ...b.print } : undefined;
    const after = { ...spec };
    const resize = size && this.blankArt && b.pages.some((p) => Math.abs(p.widthIn - size.w) > 1e-4 || Math.abs(p.heightIn - size.h) > 1e-4);
    const oldPages = resize ? structuredClone(b.pages.map((p) => ({ id: p.id, w: p.widthIn, h: p.heightIn, cuts: p.cuts, balloons: p.balloons, layout: p.layout, anchors: p.groups.map((g) => g.anchor) }))) : [];
    const scalePages = (to: (id: string) => { w: number; h: number }) => {
      for (const p of b.pages) {
        const t = to(p.id);
        const sx = t.w / p.widthIn;
        const sy = t.h / p.heightIn;
        const sc = (q: { x: number; y: number }) => ({ x: q.x * sx, y: q.y * sy });
        p.cuts = p.cuts.map((c) => ({ ...c, pts: c.pts.map(sc), ...(c.extended ? { extended: c.extended.map(sc) } : {}), ...(c.handles ? { handles: [sc(c.handles[0]), sc(c.handles[1])] } : {}) }));
        p.balloons = p.balloons.map((l) => ({ ...l, cap: { ...l.cap, x: l.cap.x * sx, y: l.cap.y * sy, tails: l.cap.tails.map((t2) => ({ ...t2, x: t2.x * sx, y: t2.y * sy })) } }));
        for (const g of p.groups) if (g.anchor) g.anchor = sc(g.anchor);
        if (p.layout?.panelTransforms) p.layout.panelTransforms = scalePanelTransforms(p.layout.panelTransforms, sx, sy);
        p.widthIn = t.w;
        p.heightIn = t.h;
        const { width, height } = pagePixels(p, b.dpi);
        const old = this.art.get(p.id);
        this.art.set(p.id, newPageArt(p.id, old?.label ?? `Page ${this.pageNumber(p)}`, width, height));
      }
      this.residency.setPages(this.art);
    };
    this.run({
      label: resize ? 'Print kind and page size' : 'Print settings',
      do: () => {
        b.print = { ...after };
        if (resize) scalePages(() => ({ w: size!.w, h: size!.h }));
      },
      undo: () => {
        if (before) b.print = { ...before };
        else delete b.print;
        if (resize) {
          const was = new Map(oldPages.map((o) => [o.id, o]));
          scalePages((id) => ({ w: was.get(id)!.w, h: was.get(id)!.h }));
          // exact restore of the scaled geometry (no rounding drift)
          for (const p of b.pages) {
            const o = was.get(p.id)!;
            p.layout = structuredClone(o.layout);
            p.cuts = structuredClone(o.cuts);
            p.balloons = structuredClone(o.balloons);
            p.groups.forEach((g, i) => {
              const a = o.anchors[i];
              if (a) g.anchor = { ...a };
            });
          }
        }
      },
    });
  }

  // ---- brushes

  /** Save the device's own brushes (not book data; no undo). */
  async saveUserBrushes(list: BrushEntry[]): Promise<void> {
    await this.store.putSetting('brushes.user.v1', list);
    setUserBrushes(list);
    this.emit();
  }

  /**
   * The id strokes should store for a brush: its book snapshot, added the first time it draws.
   * Adding a snapshot is not an undo step (it changes nothing visible).
   */
  brushId(e: BrushEntry): string {
    const b = this.requireBook();
    const id = snapshotId(e);
    if (!b.brushes?.[id]) {
      b.brushes = { ...b.brushes, [id]: structuredClone(e.settings) };
      setBookBrushes(b.brushes);
      this.saver.markDirty();
    }
    return id;
  }

  // ---- pixels

  /** Bring a page's art into memory and keep it there while it is open on a desk. */
  async focus(page: Page): Promise<PageArt> {
    const a = this.ensureArt(page);
    this.residency.use([a]);
    await this.residency.ensure(a);
    return a;
  }

  /** A gallery cover: the first laid-out page, else page 1. */
  private async cover(): Promise<Uint8Array | null> {
    const b = this.book;
    if (!b) return null;
    const page = b.pages.find((p) => p.cuts.length) ?? b.pages[0];
    if (!page) return null;
    const a = this.art.get(page.id) ?? null;
    const c = renderThumb(page, a && !a.parked ? a : null, 200, undefined, sheetOf(b));
    return encodePng(c);
  }

  // ---- files

  async addAssets(items: BookAsset[], bytes = new Map<string, Uint8Array>()): Promise<number> {
    const book = this.requireBook();
    const files = readBookAssets(items);
    for (const { key } of files) this.assetHistory.add(key);
    await this.store.putAssets(bytes);
    if (this.book !== book) throw new Error('The open book changed.');
    const before = book.assets;
    const existing = new Set(before?.map(({ key }) => key));
    const added = files.filter(({ key }) => !existing.has(key));
    if (!added.length) return 0;
    const after = readBookAssets([...(before ?? []), ...added]);
    this.run({ label: 'Add book assets', do: () => { book.assets = after; }, undo: () => { book.assets = before; } });
    return added.length;
  }

  removeAsset(key: string): void {
    const book = this.requireBook();
    const before = book.assets;
    if (!before?.some((asset) => asset.key === key)) return;
    this.assetHistory.add(key);
    const after = before.filter((asset) => asset.key !== key);
    this.run({ label: 'Remove book asset', do: () => { book.assets = after; }, undo: () => { book.assets = before; } });
  }

  /** A self-contained `.inkflo` (zip of book.json + assets). */
  async exportInkflo(): Promise<Blob> {
    const b = this.requireBook();
    const settled = await captureBook(b, this.art, browserPlaneOps, { mode: 'archive', source: (k) => this.store.getAsset(k) }).settle();
    const files: { name: string; data: Uint8Array }[] = [{ name: "book.json", data: new TextEncoder().encode(stringifyBookFile(settled.file)) }];
    for (const [name, data] of settled.assets) files.push({ name, data });
    // archive mode only carries newly encoded bytes; add stored assets the file points at
    for (const k of assetsOf(settled.file)) {
      if (settled.assets.has(k)) continue;
      const bytes = await this.store.getAsset(k);
      if (!bytes) throw new Error(`The book is missing ${k}.`);
      files.push({ name: k, data: bytes });
    }
    return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
  }

  /** Import an `.inkflo` into the library. A book whose id is taken becomes a copy. */
  async importInkflo(bytes: Uint8Array, asStarter = false): Promise<BookMeta> {
    const entries = await readZip(bytes);
    const json = entries.get('book.json');
    if (!json) throw new Error('This file has no book.json; it is not an inkflo book.');
    const file = parseBookFile(new TextDecoder().decode(json));
    if (asStarter) {
      const now = Date.now();
      file.book.id = newId('bk');
      file.book.createdAt = file.book.updatedAt = now;
      file.book.lastPageId = file.book.pages[0]!.id;
      file.book.lastStage = 'script';
    } else if (await this.store.getBook(file.book.id)) {
      file.book.id = `bk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      file.book.title = `${file.book.title} (copy)`;
    }
    const assets = new Map<string, Uint8Array>();
    for (const k of assetsOf(file)) {
      const data = entries.get(k);
      if (!data) throw new Error(`The file is missing ${k}.`);
      assets.set(k, data);
    }
    const meta = metaFromFile(file, { modified: Date.now() });
    await this.store.saveHead(meta, { id: file.book.id, json: stringifyBookFile(file), savedAt: Date.now() }, assets, [...assets.keys()]);
    return meta;
  }
}
