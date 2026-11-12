// Adapted from 2Dope src/core/residency.ts @ 707f793. The algorithm is unchanged (LRU parking
// under a byte budget, wanted set, nested pins, background thumbnails). What changed: a page holds
// one bitmap per layer (keyed by layer id) instead of a drawing's line/fill pair, each layer has
// its own revision and saved key (so a save re-encodes only the layers that changed), and each
// page carries its own pixel size.

/**
 * Keeps memory flat however long the book is.
 *
 * A 6.625×10.187 in page at 300 dpi is 1988×3056 px, about 24 MB of canvas memory per layer.
 * Only the pages that matter now keep live canvases: the open page, pages being exported, and
 * whatever was used most recently within a memory budget. The rest are **parked**: their pixels
 * are compressed to PNG (or point at the asset autosave already stored) and their canvases shrink
 * to 0×0, which hands the memory back to the browser.
 *
 * A parked page comes back with `ensure()` before anything reads or writes its pixels. Canvas
 * objects are kept (only resized), so undo commands that captured them stay valid.
 */

/** Where a parked layer's pixels are: a stored asset key, or PNG bytes held until stored. */
export interface PlaneRef {
  key: string | null;
  bytes: Uint8Array | null;
}

export interface Parked {
  /** Layer revisions when parked. */
  revs: Record<string, number>;
  planes: Record<string, PlaneRef | null>;
}

/** Where a layer's pixels were last stored, valid while its revision matches. */
export interface Saved {
  rev: number;
  key: string | null;
}

/** The live pixels of one page. Owned by the app, keyed by page id; not part of the book document. */
export interface PageArt {
  /** The page id. */
  id: string;
  /** Shown in warnings ("Page 3"). */
  label: string;
  width: number;
  height: number;
  /** Layer bitmaps by layer id. A layer has no canvas until something is drawn on it. */
  planes: Record<string, HTMLCanvasElement | null>;
  /** Imported source bitmaps keep their own dimensions when parked and loaded. */
  planeSizes: Record<string, { width: number; height: number }>;
  /** Per-layer revision, bumped on every pixel change. */
  revs: Record<string, number>;
  /** Page revision (any layer changed): thumbnails and covers. */
  rev: number;
  parked: Parked | null;
  saved: Record<string, Saved>;
  thumb: HTMLCanvasElement | null;
  thumbRev: number;
}

/** A page with nothing drawn yet. */
export function newPageArt(id: string, label: string, width: number, height: number): PageArt {
  return { id, label, width, height, planes: {}, planeSizes: {}, revs: {}, rev: 0, parked: null, saved: {}, thumb: null, thumbRev: -1 };
}

/** A page whose layers are stored as assets and not decoded yet (how a book opens). */
export function storedPageArt(id: string, label: string, width: number, height: number, keys: Record<string, string | null>): PageArt {
  const art = newPageArt(id, label, width, height);
  const planes: Record<string, PlaneRef | null> = {};
  const revs: Record<string, number> = {};
  for (const [layer, key] of Object.entries(keys)) {
    planes[layer] = key ? { key, bytes: null } : null;
    revs[layer] = 0;
    art.revs[layer] = 0;
    art.saved[layer] = { rev: 0, key };
  }
  art.parked = { revs, planes };
  return art;
}

/** Mark a layer's pixels as changed. */
export function touchLayer(art: PageArt, layerId: string): void {
  art.revs[layerId] = (art.revs[layerId] ?? 0) + 1;
  art.rev += 1;
}

/** The canvas operations residency needs (injected so the logic can be tested without a browser). */
export interface PlaneOps {
  isBlank(c: HTMLCanvasElement): boolean;
  /** PNG bytes; the pixels are snapshotted when called. */
  encode(c: HTMLCanvasElement): Promise<Uint8Array>;
  decodeInto(c: HTMLCanvasElement, bytes: Uint8Array): Promise<void>;
  /** Resize (which also clears) a canvas. 0×0 frees its memory. */
  resize(c: HTMLCanvasElement, w: number, h: number): void;
  newCanvas(w: number, h: number): HTMLCanvasElement;
  /** Draw a small preview of a resident page, reusing `into` when given. */
  thumb(art: PageArt, into: HTMLCanvasElement | null): HTMLCanvasElement;
  /** Run soon, after the current work (lets the UI breathe between heavy steps). */
  defer(fn: () => void): void;
}

export type AssetSource = (key: string) => Promise<Uint8Array | null>;

const MB = 1024 * 1024;

/** A memory budget for live page canvases that suits the device (BRUSH-AND-INK §7: 300 MB). */
export function defaultBudget(): number {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { deviceMemory?: number });
  const ios = !!nav && (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));
  if (ios) return 300 * MB;
  const mem = nav?.deviceMemory;
  if (mem !== undefined && mem <= 4) return 300 * MB;
  return 900 * MB;
}

/** Bytes of canvas memory a resident page holds. */
export function residentBytes(art: PageArt): number {
  if (art.parked) return 0;
  let n = 0;
  for (const c of Object.values(art.planes)) if (c) n += c.width * c.height * 4;
  return n;
}

/** The canvas of a layer, created at the page's size on first use. Only for resident pages. */
export function planeCanvas(art: PageArt, layerId: string, ops: Pick<PlaneOps, 'newCanvas'>): HTMLCanvasElement {
  if (art.parked) throw new Error(`${art.label} is parked; call Residency.ensure() first.`);
  let c = art.planes[layerId];
  if (!c) {
    c = ops.newCanvas(art.width, art.height);
    art.planes[layerId] = c;
    art.revs[layerId] ??= 0;
  }
  return c;
}

/**
 * Record where autosave stored a page's layers. A parked page holding PNG bytes in memory swaps
 * them for the stored keys, so its memory drops to almost nothing.
 */
export function recordSaved(art: PageArt, saved: Record<string, Saved>): void {
  for (const [layer, s] of Object.entries(saved)) {
    art.saved[layer] = { ...s };
    const p = art.parked;
    if (p && p.revs[layer] === s.rev && p.planes[layer] && s.key) p.planes[layer] = { key: s.key, bytes: null };
  }
}

/** Asset keys the pages in memory still point at (autosave's clean-up must keep these). */
export function referencedKeys(pages: Iterable<PageArt>): Set<string> {
  const keys = new Set<string>();
  for (const a of pages) {
    for (const s of Object.values(a.saved)) if (s.key) keys.add(s.key);
    if (a.parked) for (const r of Object.values(a.parked.planes)) if (r?.key) keys.add(r.key);
  }
  return keys;
}

export class Residency {
  /** A parked page came back (render it, refresh thumbnails). */
  onReady: (art: PageArt) => void = () => {};
  /** A thumbnail was (re)drawn. */
  onThumb: (art: PageArt) => void = () => {};
  /** Something could not be read; the layer was left blank. */
  onWarning: (message: string) => void = () => {};

  private pages: Map<string, PageArt> | null = null;
  private wanted = new Set<PageArt>();
  /** Most recently used last. */
  private readonly recent = new Map<PageArt, true>();
  private readonly loading = new Map<PageArt, Promise<void>>();
  private readonly parking = new Set<PageArt>();
  private readonly pins = new Map<PageArt, number>();
  private readonly thumbQueue: PageArt[] = [];
  private pumpScheduled = false;
  private pumping = false;
  private thumbing = false;

  constructor(
    private readonly ops: PlaneOps,
    private readonly source: AssetSource,
    public budget: number = defaultBudget(),
  ) {}

  /**
   * Start managing a (new) book's pages. Forgets everything about the previous one. The map is
   * live: pages added or removed later are seen on the next pass.
   */
  setPages(pages: Map<string, PageArt>): void {
    const old = this.pages;
    if (old && old !== pages) {
      // The old book is closed (and saved): hand its canvas memory back now, not at the next GC.
      for (const a of old.values()) for (const c of Object.values(a.planes)) if (c) this.ops.resize(c, 0, 0);
    }
    this.pages = pages;
    this.pins.clear();
    this.wanted = new Set();
    this.recent.clear();
    this.thumbQueue.length = 0;
    for (const a of pages.values()) if (a.thumbRev !== a.rev) this.thumbQueue.push(a);
    this.schedule();
  }

  isReady(art: PageArt): boolean {
    return art.parked === null;
  }

  /** The pages that must stay live now, most important first. Parked ones among them start loading. */
  use(pages: PageArt[]): void {
    this.wanted = new Set(pages);
    for (let i = pages.length - 1; i >= 0; i--) this.touch(pages[i]!);
    for (const a of pages) if (a.parked) void this.ensure(a);
    this.schedule();
  }

  /** Bring a page back and keep it live until `unpin` (export, scripted work). Pins nest. */
  async pin(art: PageArt): Promise<void> {
    this.pins.set(art, (this.pins.get(art) ?? 0) + 1);
    await this.ensure(art);
  }

  unpin(art: PageArt): void {
    const n = (this.pins.get(art) ?? 0) - 1;
    if (n > 0) this.pins.set(art, n);
    else this.pins.delete(art);
    this.schedule();
  }

  /** Mark a page as just used (it will be parked last). */
  touch(art: PageArt): void {
    this.recent.delete(art);
    this.recent.set(art, true);
  }

  /** Bring a page's pixels back. Resolves at once if they are already live. */
  ensure(art: PageArt): Promise<void> {
    if (!art.parked) return Promise.resolve();
    const busy = this.loading.get(art);
    if (busy) return busy;
    const job = this.load(art).finally(() => this.loading.delete(art));
    this.loading.set(art, job);
    return job;
  }

  /** Total canvas memory held by live pages. */
  liveBytes(): number {
    let n = 0;
    if (this.pages) for (const a of this.pages.values()) n += residentBytes(a);
    return n;
  }

  /** Park pages until the live set fits the budget (runs in the background). */
  schedule(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    this.ops.defer(() => {
      this.pumpScheduled = false;
      void this.pump();
      void this.drainThumbs();
    });
  }

  /** Wait until background parking is done (tests). */
  async settle(): Promise<void> {
    for (let i = 0; i < 1000; i++) {
      if (!this.pumping && !this.thumbing && !this.pumpScheduled && !this.loading.size && !this.parking.size) return;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** Redraw a live page's thumbnail if it changed (call after edits settle). */
  updateThumb(art: PageArt): void {
    this.refreshThumb(art);
  }

  // -------------------------------------------------------------------------------------------

  private async load(art: PageArt): Promise<void> {
    const p = art.parked;
    if (!p || !this.pages) return;
    const read = async (ref: PlaneRef | null, layer: string): Promise<Uint8Array | null> => {
      if (!ref) return null;
      try {
        const bytes = ref.bytes ?? (ref.key ? await this.source(ref.key) : null);
        if (!bytes) this.onWarning(`${art.label}: a layer image is missing, so it was left blank (${layer}).`);
        return bytes;
      } catch {
        this.onWarning(`${art.label}: a layer image could not be read, so it was left blank (${layer}).`);
        return null;
      }
    };
    const layers = Object.keys(p.planes);
    const bytes = await Promise.all(layers.map((l) => read(p.planes[l] ?? null, l)));
    if (art.parked !== p) return; // someone else finished first
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      // a layer that had a canvas or stored pixels gets its canvas back; a blank one stays null
      if (!p.planes[layer] && !art.planes[layer]) continue;
      const { width, height } = art.planeSizes[layer] ?? art;
      const c = (art.planes[layer] ??= this.ops.newCanvas(width, height));
      this.ops.resize(c, width, height);
      const b = bytes[i];
      if (b) await this.decode(art, c, b, layer);
    }
    // canvases of layers drawn after parking was decided (none normally) come back blank
    for (const [layer, c] of Object.entries(art.planes)) {
      const { width, height } = art.planeSizes[layer] ?? art;
      if (c && !(layer in p.planes)) this.ops.resize(c, width, height);
    }
    art.parked = null;
    // What we just decoded is exactly what is stored, so the next save can skip it.
    for (const layer of layers) {
      const ref = p.planes[layer];
      if (!ref || ref.key) art.saved[layer] = { rev: p.revs[layer] ?? 0, key: ref?.key ?? null };
    }
    this.refreshThumb(art);
    this.onReady(art);
    this.schedule();
  }

  private async decode(art: PageArt, c: HTMLCanvasElement, bytes: Uint8Array, layer: string): Promise<void> {
    try {
      await this.ops.decodeInto(c, bytes);
    } catch {
      this.onWarning(`${art.label}: a layer image could not be read, so it was left blank (${layer}).`);
    }
  }

  private refreshThumb(art: PageArt): void {
    if (art.parked || art.thumbRev === art.rev) return;
    art.thumb = this.ops.thumb(art, art.thumb);
    art.thumbRev = art.rev;
    this.onThumb(art);
  }

  private canPark(art: PageArt): boolean {
    return !art.parked && !this.wanted.has(art) && !this.pins.has(art) && !this.loading.has(art) && !this.parking.has(art);
  }

  private async pump(): Promise<void> {
    const pages = this.pages;
    if (this.pumping || !pages) return;
    this.pumping = true;
    try {
      const live = new Set(pages.values());
      for (const a of this.recent.keys()) if (!live.has(a)) this.recent.delete(a);
      // A page that changed while it was being compressed is skipped this round.
      const skipped = new Set<PageArt>();
      while (this.liveBytes() > this.budget) {
        // Least recently used first; pages never touched this session count as oldest.
        const order = [...pages.values()].filter((a) => !this.recent.has(a)).concat([...this.recent.keys()]);
        const victim = order.find((a) => !skipped.has(a) && this.canPark(a));
        if (!victim) break;
        const ok = await this.park(victim);
        if (this.pages !== pages) return;
        if (!ok) skipped.add(victim);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Compress a page and free its canvases. False if it changed or became needed meanwhile. */
  private async park(art: PageArt): Promise<boolean> {
    this.parking.add(art);
    try {
      const rev = art.rev;
      this.refreshThumb(art);
      const layers = Object.keys(art.planes);
      const revs: Record<string, number> = {};
      const plane = async (layer: string): Promise<PlaneRef | null> => {
        const c = art.planes[layer];
        const r = art.revs[layer] ?? 0;
        revs[layer] = r;
        if (!c) return null;
        const saved = art.saved[layer];
        if (saved && saved.rev === r) return saved.key ? { key: saved.key, bytes: null } : null;
        if (this.ops.isBlank(c)) return null;
        return { key: null, bytes: await this.ops.encode(c) };
      };
      const refs = await Promise.all(layers.map(plane));
      this.parking.delete(art);
      if (art.rev !== rev || !this.canPark(art)) return false;
      const planes: Record<string, PlaneRef | null> = {};
      layers.forEach((l, i) => (planes[l] = refs[i]!));
      art.parked = { revs, planes };
      for (const c of Object.values(art.planes)) if (c) this.ops.resize(c, 0, 0);
      return true;
    } finally {
      this.parking.delete(art);
    }
  }

  /** Give every page a thumbnail, one at a time, parking again afterwards. */
  private async drainThumbs(): Promise<void> {
    if (this.thumbing) return;
    this.thumbing = true;
    try {
      while (this.thumbQueue.length) {
        const a = this.thumbQueue.shift()!;
        const pages = this.pages;
        if (!pages || pages.get(a.id) !== a || a.thumbRev === a.rev) continue;
        if (a.parked) await this.ensure(a);
        else this.refreshThumb(a);
        if (this.pages !== pages) return;
        if (this.liveBytes() > this.budget) await this.pump();
      }
    } finally {
      this.thumbing = false;
    }
  }
}
