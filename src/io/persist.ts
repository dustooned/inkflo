// Adapted from 2Dope src/io/persist.ts @ 707f793. Same record layout and crash-safety rule;
// projects became books, the card describes a book, and 2Dope's single-project migration is gone
// (inkflo has no legacy data). Database name `inkflo`, version 1.

import type { Stage } from '../doc/model';
import { assetsOf, type BookFile } from '../doc/schema';

/**
 * The library on this device: many books, folders, restore points, and one shared pool of
 * content-addressed images (a page stored once is shared by every book and version that uses it).
 *
 * Records:
 * - `books`:    the card Home shows (title, folder, dates, page count, stage, small cover). Small.
 * - `heads`:    the latest autosaved book.json of each book. Loaded only when opened.
 * - `versions`: named and automatic restore points, per book.
 * - `refs`:     which assets each head/version uses, so clean-up never has to parse JSON.
 * - `assets`:   PNG bytes by content key.
 * - `folders`:  Home's folders.
 * - `meta`:     small settings (last opened book, last desk per book...).
 *
 * Crash safety: a head or version is written in ONE transaction together with its new assets and
 * its refs, so a crash leaves either the old save or the new one, never a half.
 */

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  /** Folder id, or null for the top level. */
  folder: string | null;
  created: number;
  modified: number;
  opened: number;
  pages: number;
  lastStage: Stage;
  /** Small PNG cover (drawn from the first laid-out page), or null. */
  cover: Uint8Array | null;
}

export interface FolderRecord {
  id: string;
  name: string;
  created: number;
}

export interface HeadRecord {
  id: string;
  json: string;
  savedAt: number;
}

export interface VersionRecord {
  id: string;
  /** The book this restore point belongs to. */
  book: string;
  name: string;
  /** Made automatically (every N commands, before a risky edit) rather than by the user. */
  auto: boolean;
  at: number;
  json: string;
}

export interface Store {
  listBooks(): Promise<BookMeta[]>;
  getBook(id: string): Promise<BookMeta | null>;
  /** Update a book's card only (rename, move to a folder, opened time). */
  putBookMeta(m: BookMeta): Promise<void>;
  getHead(id: string): Promise<HeadRecord | null>;
  /** Save a book: new assets, its card, its head and its refs, all-or-nothing. */
  saveHead(meta: BookMeta, head: HeadRecord, assets: Map<string, Uint8Array>, refs: string[]): Promise<void>;
  /** Delete a book with its head, versions and refs (assets are cleaned up later). */
  deleteBook(id: string): Promise<void>;

  listFolders(): Promise<FolderRecord[]>;
  putFolder(f: FolderRecord): Promise<void>;
  /** Delete a folder; its books move to the top level. */
  deleteFolder(id: string): Promise<void>;

  getSetting<T>(key: string): Promise<T | null>;
  putSetting(key: string, value: unknown): Promise<void>;

  putAssets(assets: Map<string, Uint8Array>): Promise<void>;
  getAsset(key: string): Promise<Uint8Array | null>;
  assetKeys(): Promise<string[]>;
  deleteAssets(keys: string[]): Promise<void>;
  /** Every asset key a head or version uses. */
  referencedAssets(): Promise<Set<string>>;

  putVersion(v: VersionRecord, assets: Map<string, Uint8Array>, refs: string[]): Promise<void>;
  listVersions(book: string): Promise<VersionRecord[]>;
  getVersion(id: string): Promise<VersionRecord | null>;
  deleteVersion(id: string): Promise<void>;
}

const headRef = (id: string) => `h:${id}`;
const versionRef = (id: string) => `v:${id}`;

/** A library card describing a book file. */
export function metaFromFile(file: BookFile, base: Partial<BookMeta> = {}): BookMeta {
  const b = file.book;
  const now = Date.now();
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    folder: base.folder !== undefined ? base.folder : (b.folderId ?? null),
    created: base.created ?? b.createdAt,
    modified: base.modified ?? b.updatedAt,
    opened: base.opened ?? now,
    pages: b.pages.length,
    lastStage: b.lastStage,
    cover: base.cover ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// In memory (tests, and browsers without IndexedDB)

export class MemoryStore implements Store {
  books = new Map<string, BookMeta>();
  heads = new Map<string, HeadRecord>();
  folders = new Map<string, FolderRecord>();
  settings = new Map<string, unknown>();
  assets = new Map<string, Uint8Array>();
  versions = new Map<string, VersionRecord>();
  refs = new Map<string, string[]>();

  async listBooks() {
    return [...this.books.values()];
  }
  async getBook(id: string) {
    return this.books.get(id) ?? null;
  }
  async putBookMeta(m: BookMeta) {
    this.books.set(m.id, m);
  }
  async getHead(id: string) {
    return this.heads.get(id) ?? null;
  }
  async saveHead(meta: BookMeta, head: HeadRecord, assets: Map<string, Uint8Array>, refs: string[]) {
    for (const [k, v] of assets) this.assets.set(k, v);
    this.books.set(meta.id, meta);
    this.heads.set(head.id, head);
    this.refs.set(headRef(head.id), refs);
  }
  async deleteBook(id: string) {
    this.books.delete(id);
    this.heads.delete(id);
    this.refs.delete(headRef(id));
    for (const v of [...this.versions.values()]) if (v.book === id) await this.deleteVersion(v.id);
  }
  async listFolders() {
    return [...this.folders.values()];
  }
  async putFolder(f: FolderRecord) {
    this.folders.set(f.id, f);
  }
  async deleteFolder(id: string) {
    this.folders.delete(id);
    for (const b of this.books.values()) if (b.folder === id) b.folder = null;
  }
  async getSetting<T>(key: string) {
    return (this.settings.get(key) as T | undefined) ?? null;
  }
  async putSetting(key: string, value: unknown) {
    this.settings.set(key, value);
  }
  async putAssets(a: Map<string, Uint8Array>) {
    for (const [k, v] of a) this.assets.set(k, v);
  }
  async getAsset(key: string) {
    return this.assets.get(key) ?? null;
  }
  async assetKeys() {
    return [...this.assets.keys()];
  }
  async deleteAssets(keys: string[]) {
    for (const k of keys) this.assets.delete(k);
  }
  async referencedAssets() {
    return new Set([...this.refs.values()].flat());
  }
  async putVersion(v: VersionRecord, assets: Map<string, Uint8Array>, refs: string[]) {
    for (const [k, b] of assets) this.assets.set(k, b);
    this.versions.set(v.id, v);
    this.refs.set(versionRef(v.id), refs);
  }
  async listVersions(book: string) {
    return [...this.versions.values()].filter((v) => v.book === book).sort((a, b) => b.at - a.at);
  }
  async getVersion(id: string) {
    return this.versions.get(id) ?? null;
  }
  async deleteVersion(id: string) {
    this.versions.delete(id);
    this.refs.delete(versionRef(id));
  }
}

// ---------------------------------------------------------------------------------------------
// IndexedDB

const DB_NAME = 'inkflo';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction was aborted (storage may be full)'));
  });
}

export class IdbStore implements Store {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = DB_NAME): Promise<IdbStore> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('meta');
        d.createObjectStore('assets');
        d.createObjectStore('books', { keyPath: 'id' });
        d.createObjectStore('heads', { keyPath: 'id' });
        d.createObjectStore('folders', { keyPath: 'id' });
        d.createObjectStore('refs');
        d.createObjectStore('versions', { keyPath: 'id' }).createIndex('book', 'book');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('could not open the local database'));
      r.onblocked = () => reject(new Error('the local database is blocked by another inkflo tab'));
    });
    return new IdbStore(db);
  }

  close(): void {
    this.db.close();
  }

  async listBooks(): Promise<BookMeta[]> {
    return (await req(this.db.transaction('books').objectStore('books').getAll())) as BookMeta[];
  }

  async getBook(id: string): Promise<BookMeta | null> {
    return ((await req(this.db.transaction('books').objectStore('books').get(id))) as BookMeta | undefined) ?? null;
  }

  async putBookMeta(m: BookMeta): Promise<void> {
    const tx = this.db.transaction('books', 'readwrite');
    tx.objectStore('books').put(m);
    await done(tx);
  }

  async getHead(id: string): Promise<HeadRecord | null> {
    return ((await req(this.db.transaction('heads').objectStore('heads').get(id))) as HeadRecord | undefined) ?? null;
  }

  async saveHead(meta: BookMeta, head: HeadRecord, assets: Map<string, Uint8Array>, refs: string[]): Promise<void> {
    const tx = this.db.transaction(['assets', 'books', 'heads', 'refs'], 'readwrite');
    const a = tx.objectStore('assets');
    for (const [k, v] of assets) a.put(v, k);
    tx.objectStore('books').put(meta);
    tx.objectStore('heads').put(head);
    tx.objectStore('refs').put(refs, headRef(head.id));
    await done(tx);
  }

  async deleteBook(id: string): Promise<void> {
    const vs = await this.listVersions(id);
    const tx = this.db.transaction(['books', 'heads', 'refs', 'versions'], 'readwrite');
    tx.objectStore('books').delete(id);
    tx.objectStore('heads').delete(id);
    tx.objectStore('refs').delete(headRef(id));
    for (const v of vs) {
      tx.objectStore('versions').delete(v.id);
      tx.objectStore('refs').delete(versionRef(v.id));
    }
    await done(tx);
  }

  async listFolders(): Promise<FolderRecord[]> {
    return (await req(this.db.transaction('folders').objectStore('folders').getAll())) as FolderRecord[];
  }

  async putFolder(f: FolderRecord): Promise<void> {
    const tx = this.db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(f);
    await done(tx);
  }

  async deleteFolder(id: string): Promise<void> {
    const books = await this.listBooks();
    const tx = this.db.transaction(['folders', 'books'], 'readwrite');
    tx.objectStore('folders').delete(id);
    for (const b of books) if (b.folder === id) tx.objectStore('books').put({ ...b, folder: null });
    await done(tx);
  }

  async getSetting<T>(key: string): Promise<T | null> {
    return ((await req(this.db.transaction('meta').objectStore('meta').get(key))) as T | undefined) ?? null;
  }

  async putSetting(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    await done(tx);
  }

  async putAssets(assets: Map<string, Uint8Array>): Promise<void> {
    if (!assets.size) return;
    const tx = this.db.transaction('assets', 'readwrite');
    const s = tx.objectStore('assets');
    for (const [k, v] of assets) s.put(v, k);
    await done(tx);
  }

  async getAsset(key: string): Promise<Uint8Array | null> {
    const v = await req(this.db.transaction('assets').objectStore('assets').get(key));
    return v ? new Uint8Array(v as ArrayBuffer | Uint8Array) : null;
  }

  async assetKeys(): Promise<string[]> {
    return (await req(this.db.transaction('assets').objectStore('assets').getAllKeys())) as string[];
  }

  async deleteAssets(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const tx = this.db.transaction('assets', 'readwrite');
    const s = tx.objectStore('assets');
    for (const k of keys) s.delete(k);
    await done(tx);
  }

  async referencedAssets(): Promise<Set<string>> {
    const all = (await req(this.db.transaction('refs').objectStore('refs').getAll())) as string[][];
    return new Set(all.flat());
  }

  async putVersion(v: VersionRecord, assets: Map<string, Uint8Array>, refs: string[]): Promise<void> {
    const tx = this.db.transaction(['assets', 'versions', 'refs'], 'readwrite');
    const a = tx.objectStore('assets');
    for (const [k, b] of assets) a.put(b, k);
    tx.objectStore('versions').put(v);
    tx.objectStore('refs').put(refs, versionRef(v.id));
    await done(tx);
  }

  async listVersions(book: string): Promise<VersionRecord[]> {
    const all = (await req(this.db.transaction('versions').objectStore('versions').index('book').getAll(book))) as VersionRecord[];
    return all.sort((a, b) => b.at - a.at);
  }

  async getVersion(id: string): Promise<VersionRecord | null> {
    return ((await req(this.db.transaction('versions').objectStore('versions').get(id))) as VersionRecord | undefined) ?? null;
  }

  async deleteVersion(id: string): Promise<void> {
    const tx = this.db.transaction(['versions', 'refs'], 'readwrite');
    tx.objectStore('versions').delete(id);
    tx.objectStore('refs').delete(versionRef(id));
    await done(tx);
  }
}

/** Open IndexedDB, or fall back to memory (work then only lasts until the tab closes). */
export async function openStore(): Promise<{ store: Store; persistent: boolean }> {
  try {
    return { store: await IdbStore.open(), persistent: true };
  } catch {
    return { store: new MemoryStore(), persistent: false };
  }
}

/** Ask the browser not to clear our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Which automatic versions to delete so only the newest `maxAuto` remain. Manual versions are never pruned. */
export function versionsToPrune(list: VersionRecord[], maxAuto: number): string[] {
  return list
    .filter((v) => v.auto)
    .sort((a, b) => b.at - a.at)
    .slice(maxAuto)
    .map((v) => v.id);
}

/** Asset keys nothing refers to: not a head, not a version, not a page still in memory. */
export function unreferencedAssets(allKeys: string[], referenced: Set<string>, keep: Set<string> = new Set()): string[] {
  return allKeys.filter((k) => !referenced.has(k) && !keep.has(k));
}

export { assetsOf };
