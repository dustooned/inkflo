// Adapted from 2Dope src/io/projectio.ts (captureProject) @ 707f793. Same two-phase contract:
// read everything that must match this moment synchronously, finish encoding later. Rebound from
// Project/drawings to Book/page layer bitmaps; each layer is re-encoded only when it changed.

import { allLayers, type Book } from '../doc/model';
import { FORMAT, SCHEMA, type BookFile, type PageArtKeys } from '../doc/schema';
import { recordSaved, type AssetSource, type PageArt, type PlaneOps, type PlaneRef, type Saved } from '../draw/residency';
import { hashBytes } from '../engine/io/hash';

export const APP_VERSION = 'inkflo 0.0.2';

export interface Settled {
  file: BookFile;
  /** Newly encoded assets (key -> PNG bytes). Unchanged layers reuse their stored assets. */
  assets: Map<string, Uint8Array>;
  /** Call after the assets were stored, so later saves (and parking) can skip these layers. */
  commit(): void;
}

export interface Capture {
  settle(): Promise<Settled>;
}

export interface CaptureOptions {
  /**
   * `library`: reuse assets already stored on this device (autosave, versions).
   * `archive`: every asset's bytes are included (an `.inkflo` that stands on its own).
   */
  mode: 'library' | 'archive';
  /** Reads stored assets (archive mode needs the bytes of parked and saved layers). */
  source?: AssetSource;
}

/** null = blank, string = already stored, promise/thunk = bytes still to store. */
type PlaneJob = string | null | Promise<Uint8Array | null> | (() => Promise<Uint8Array | null>);

export const assetKey = (bytes: Uint8Array) => `assets/${hashBytes(bytes)}.png`;

/**
 * Capture the book NOW and finish encoding later. The document is copied and every changed
 * layer's pixels are snapshotted (`ops.encode` must copy pixels when called, as `toBlob` does)
 * before this returns, so the user can keep drawing while the encode completes. Parked pages are
 * not decoded: their stored keys or bytes are used as they are.
 */
export function captureBook(book: Book, art: Map<string, PageArt>, ops: Pick<PlaneOps, 'isBlank' | 'encode'>, opt: CaptureOptions = { mode: 'library' }): Capture {
  const doc = structuredClone(book);

  const fromKey = (key: string | null): PlaneJob => {
    if (!key) return null;
    if (opt.mode === 'library') return key;
    const src = opt.source;
    return async () => {
      const bytes = src ? await src(key) : null;
      if (!bytes) throw new Error('A page image is missing. The book was not exported.');
      return bytes;
    };
  };
  const fromRef = (ref: PlaneRef | null | undefined): PlaneJob => (!ref ? null : ref.bytes ? Promise.resolve(ref.bytes) : fromKey(ref.key));

  const jobs = doc.pages.flatMap((page) => {
    const a = art.get(page.id);
    if (!a) return [];
    const layers = allLayers(page).map((l) => l.id);
    const parked = a.parked;
    const planes: { layer: string; rev: number; job: PlaneJob }[] = [];
    for (const layer of layers) {
      if (parked) {
        if (layer in parked.planes) planes.push({ layer, rev: parked.revs[layer] ?? 0, job: fromRef(parked.planes[layer]) });
        continue;
      }
      const c = a.planes[layer];
      if (!c) continue;
      const rev = a.revs[layer] ?? 0;
      const saved = a.saved[layer];
      if (saved && saved.rev === rev) planes.push({ layer, rev, job: fromKey(saved.key) });
      else planes.push({ layer, rev, job: ops.isBlank(c) ? null : ops.encode(c) });
    }
    return [{ art: a, planes }];
  });

  return {
    async settle(): Promise<Settled> {
      const assets = new Map<string, Uint8Array>();
      const keyOf = async (job: PlaneJob): Promise<string | null> => {
        if (job === null) return null;
        if (typeof job === 'string') return job;
        const bytes = await (typeof job === 'function' ? job() : job);
        if (!bytes) return null;
        const key = assetKey(bytes);
        assets.set(key, bytes);
        return key;
      };
      const out: Record<string, PageArtKeys> = {};
      const done: { art: PageArt; saved: Record<string, Saved> }[] = [];
      for (const j of jobs) {
        const keys: PageArtKeys = {};
        const saved: Record<string, Saved> = {};
        for (const p of j.planes) {
          const key = await keyOf(p.job);
          keys[p.layer] = key;
          saved[p.layer] = { rev: p.rev, key };
        }
        if (Object.values(keys).some(Boolean)) out[j.art.id] = Object.fromEntries(Object.entries(keys).filter(([, k]) => k));
        done.push({ art: j.art, saved });
      }
      const file: BookFile = { format: FORMAT, schema: SCHEMA, savedBy: APP_VERSION, book: doc, art: out };
      return {
        file,
        assets,
        commit() {
          if (opt.mode !== 'library') return;
          for (const d of done) recordSaved(d.art, d.saved);
        },
      };
    },
  };
}
