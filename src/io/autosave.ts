// Adapted from 2Dope src/io/autosave.ts @ 707f793. Same queue, debounce, capture-then-encode and
// clean-up. Changed for BUILD-HANDOFF M0: 400 ms debounce, and automatic restore points every 10
// commands instead of every 10 minutes.

import type { Capture } from './capture';
import { assetsOf, metaFromFile, unreferencedAssets, versionsToPrune, type BookMeta, type Store, type VersionRecord } from './persist';
import { newId } from '../doc/model';
import { stringifyBookFile } from '../doc/schema';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface AutosaveOptions {
  /** Wait this long after the last change before saving. */
  debounceMs: number;
  /** But never wait longer than this while changes keep coming. */
  maxWaitMs: number;
  /** An automatic restore point after this many commands since the last one. */
  versionEveryChanges: number;
  maxAutoVersions: number;
  gcEveryMs: number;
  /** After a failed save, try again this much later. */
  retryMs: number;
}

export const DEFAULTS: AutosaveOptions = {
  debounceMs: 400,
  maxWaitMs: 4000,
  versionEveryChanges: 10,
  maxAutoVersions: 10,
  gcEveryMs: 60_000,
  retryMs: 15_000,
};

/** What the autosaver needs from the app besides the capture. */
export interface AutosaveHooks {
  /** True while the user is mid-stroke: wait for it to end. */
  busy(): boolean;
  /** A small PNG cover for the Home card, or null to keep the previous one. */
  cover(): Promise<Uint8Array | null>;
  /** Asset keys still used by pages in memory (e.g. deleted but undoable). Never cleaned up. */
  keep(): Set<string>;
}

const NO_HOOKS: AutosaveHooks = { busy: () => false, cover: async () => null, keep: () => new Set() };

/**
 * Saves the open book into the library after changes, and keeps restore points.
 *
 * Crash safety: a save writes the new assets, the book card, the book and its asset list in one
 * transaction. Assets are content-addressed (immutable), so books and versions share them and
 * nothing is ever overwritten in place. All writes run one at a time on a queue.
 */
export class Autosaver {
  state: SaveState = 'idle';
  lastSavedAt: number | null = null;
  error: string | null = null;
  /** Counts every change (one per command). */
  changes = 0;
  onStatus: () => void = () => {};
  /** The open book's library card. Set with `open()`. */
  meta: BookMeta | null = null;

  private queue: Promise<void> = Promise.resolve();
  private timer: unknown = null;
  private firstDirtyAt = 0;
  private savedChanges = 0;
  private versionChanges = 0;
  private versionPending = false;
  private lastGcAt = 0;
  /** Every change since the last save is bookkeeping (last page opened): save without showing it. */
  private quiet = false;

  constructor(
    private readonly store: Store,
    private readonly capture: () => Capture,
    private readonly hooks: AutosaveHooks = NO_HOOKS,
    private readonly opt: AutosaveOptions = DEFAULTS,
    private readonly clock: Clock = realClock,
  ) {}

  /**
   * Switch to another book. Call after flushing the previous one. `saved` = the book is already
   * stored as it is now (opened from the library), so nothing needs saving yet.
   */
  open(meta: BookMeta, saved: boolean): void {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.meta = meta;
    this.savedChanges = saved ? this.changes : -1;
    this.versionChanges = this.changes;
    this.lastSavedAt = saved ? meta.modified : null;
    this.set(saved ? 'saved' : 'dirty');
    if (!saved) this.markDirty();
  }

  stop(): void {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private set(state: SaveState, error: string | null = null): void {
    this.state = state;
    this.error = error;
    this.onStatus();
  }

  /** True while a change is waiting to be written or is being written. */
  get pending(): boolean {
    return (this.timer !== null && !this.quiet) || this.state === 'dirty' || (this.state === 'saving' && !this.quiet);
  }

  /**
   * Call after every command (do, undo, redo). `quiet` is for bookkeeping that isn't the user's
   * work (which page was open last): it is saved, but the status stays "Saved" and closing the
   * tab doesn't ask to wait for it.
   */
  markDirty(quiet = false): void {
    this.quiet = quiet && (this.quiet || this.savedChanges === this.changes);
    this.changes += 1;
    this.schedule();
  }

  private schedule(): void {
    if (this.state !== 'saving' && !this.quiet) this.set('dirty');
    const now = this.clock.now();
    if (!this.timer) this.firstDirtyAt = now;
    if (this.timer) this.clock.clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.opt.debounceMs, this.firstDirtyAt + this.opt.maxWaitMs - now));
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      // mid-stroke: try again shortly rather than encoding while the pen is down
      if (this.hooks.busy()) this.schedule();
      else void this.flush();
    }, wait);
  }

  /** Save now (also used before the tab hides or another book opens). */
  flush(): Promise<void> {
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    const meta = this.meta;
    if (!meta) return this.queue;
    return this.enqueue(async () => {
      if (this.savedChanges === this.changes) return;
      const at = this.changes;
      const quiet = this.quiet;
      if (!quiet) this.set('saving');
      try {
        const settled = await this.capture().settle();
        const json = stringifyBookFile(settled.file);
        const now = this.clock.now();
        const cover = (await this.hooks.cover().catch(() => null)) ?? meta.cover;
        // the card may have been renamed or moved meanwhile: keep those fields from the live card
        const live = this.meta?.id === meta.id ? this.meta : meta;
        const card = metaFromFile(settled.file, { folder: live.folder, created: live.created, opened: live.opened, modified: now, cover });
        await this.store.saveHead(card, { id: meta.id, json, savedAt: now }, settled.assets, [...assetsOf(settled.file)]);
        settled.commit();
        if (this.meta?.id === meta.id) this.meta = card;
        this.savedChanges = at;
        this.lastSavedAt = now;
        if (this.changes === at) this.quiet = false;
        if (!(quiet && this.changes === at && this.state !== 'saving')) this.set(this.changes === at ? 'saved' : 'dirty');
        if (this.changes !== at) this.schedule();
        // Queued after this save, not awaited: awaiting a queued job from inside the queue deadlocks.
        if (at - this.versionChanges >= this.opt.versionEveryChanges && !this.versionPending) void this.saveVersion('Automatic', true);
        await this.maybeGc();
      } catch (e) {
        this.set('error', e instanceof Error ? e.message : String(e));
        // try again in a while; a full disk may have been freed
        this.timer = this.clock.setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, this.opt.retryMs);
      }
    });
  }

  /**
   * Save a restore point of the open book. The book is captured immediately (before this
   * returns), so calling it right before a destructive edit stores the state from before that edit.
   */
  saveVersion(name: string, auto: boolean): Promise<VersionRecord | null> {
    const meta = this.meta;
    if (!meta) return Promise.resolve(null);
    const cap = this.capture();
    const at = this.clock.now();
    const changesNow = this.changes;
    if (auto) this.versionPending = true;
    return new Promise((resolve) => {
      void this.enqueue(async () => {
        try {
          const settled = await cap.settle();
          const json = stringifyBookFile(settled.file);
          const rec: VersionRecord = { id: newId('v'), book: meta.id, name, auto, at, json };
          await this.store.putVersion(rec, settled.assets, [...assetsOf(settled.file)]);
          settled.commit();
          this.versionChanges = changesNow;
          for (const id of versionsToPrune(await this.store.listVersions(meta.id), this.opt.maxAutoVersions)) await this.store.deleteVersion(id);
          resolve(rec);
        } catch (e) {
          this.set('error', e instanceof Error ? e.message : String(e));
          resolve(null);
        } finally {
          if (auto) this.versionPending = false;
        }
      });
    });
  }

  /** Wait for queued writes (tests, and "save then switch"). */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Run something after every queued write (e.g. delete a book only once it stopped saving). */
  then(op: () => Promise<void>): Promise<void> {
    return this.enqueue(op);
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => {});
    return next;
  }

  private async maybeGc(): Promise<void> {
    const now = this.clock.now();
    if (now - this.lastGcAt < this.opt.gcEveryMs) return;
    this.lastGcAt = now;
    const dead = unreferencedAssets(await this.store.assetKeys(), await this.store.referencedAssets(), this.hooks.keep());
    await this.store.deleteAssets(dead);
  }
}
