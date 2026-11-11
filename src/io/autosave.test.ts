import { describe, expect, it } from 'vitest';
import { Autosaver, DEFAULTS, type AutosaveHooks } from './autosave';
import { captureBook } from './capture';
import { loadBookFile } from './load';
import { MemoryStore, metaFromFile, unreferencedAssets, versionsToPrune, type VersionRecord } from './persist';
import { findLayer, groupOf, newBook, newLayer, newPage, pagePixels, type Book, type LayerType } from '../doc/model';
import { parseBookFile } from '../doc/schema';
import { newPageArt, planeCanvas, Residency, touchLayer, type PageArt } from '../draw/residency';
import { fake, FakeClock, fakeOps } from '../test/fakes';

/** An open book: document, live page art and the pieces autosave needs. */
function setup(hooks?: Partial<AutosaveHooks>) {
  const log: string[] = [];
  const ops = fakeOps(log);
  const store = new MemoryStore();
  const clock = new FakeClock();
  const book: Book = newBook('Night Shift', 'D.', clock.now());
  book.dpi = 2; // tiny fake pages
  const art = new Map<string, PageArt>();
  const addPage = () => {
    const p = newPage(clock.now());
    book.pages.push(p);
    const { width, height } = pagePixels(p, book.dpi);
    art.set(p.id, newPageArt(p.id, `Page ${book.pages.length}`, width, height));
    return p;
  };
  for (const p of book.pages) {
    const { width, height } = pagePixels(p, book.dpi);
    art.set(p.id, newPageArt(p.id, 'Page 1', width, height));
  }
  const saver = new Autosaver(store, () => captureBook(book, art, ops), { busy: () => false, cover: async () => null, keep: () => new Set(), ...hooks }, DEFAULTS, clock);
  /** Draw on a Background layer whose id is its type, and count it as one command. */
  const draw = (pageId: string, type: LayerType, px: string) => {
    const page = book.pages.find((p) => p.id === pageId)!;
    if (!findLayer(page, type)) groupOf(page, 'background').layers.push(newLayer(type, type));
    const a = art.get(pageId)!;
    fake(planeCanvas(a, type, ops)).px = px;
    touchLayer(a, type);
    saver.markDirty();
  };
  return { log, ops, store, clock, book, art, saver, addPage, draw };
}

/** Let queued async saves (encodes use real 1 ms timers) run to the end. */
async function drain(saver: Autosaver) {
  for (let i = 0; i < 5; i++) {
    await saver.idle();
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('autosave', () => {
  it('saves 400 ms after the last change, and a reopened book has the same pages, cuts and pixels (M0 done-when)', async () => {
    const s = setup();
    s.saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: 't', book: s.book, art: {} }), false);
    const p1 = s.book.pages[0]!;
    const p2 = s.addPage();
    const p3 = s.addPage();
    p1.cuts.push({ id: 'c1', mode: 'across', pts: [{ x: 0, y: 3 }, { x: 6.6, y: 3 }] });
    s.book.lastStage = 'draw';
    s.book.lastPageId = p2.id;
    s.draw(p1.id, 'ink', 'INK-1');
    s.draw(p2.id, 'pencil', 'PEN-2');
    findLayer(p1, 'ink')!.layer.strokes.push({ pts: [{ x: 1, y: 1 }, { x: 2, y: 2 }], pressure: [0.3, 0.8], w: 0.03, brushId: 'g-pen', seed: 9 });
    findLayer(p1, 'ink')!.layer.fills.push({ at: { x: 1, y: 1 }, color: '#2F6F7E', gap: 0.02 });

    // each change restarts the 400 ms wait
    await s.clock.advance(399);
    await drain(s.saver);
    expect(s.store.heads.size).toBe(0);
    await s.clock.advance(1);
    await drain(s.saver);
    expect(s.saver.state).toBe('saved');
    const head = s.store.heads.get(s.book.id)!;

    // "refresh": rebuild everything from the store alone
    const file = parseBookFile(head.json);
    const { book, art } = loadBookFile(file);
    expect(book.pages.map((p) => p.id)).toEqual([p1.id, p2.id, p3.id]);
    expect(book.pages[0]!.cuts).toEqual(p1.cuts);
    expect(book.pages[0]!.groups).toEqual(p1.groups);
    expect(book.lastStage).toBe('draw');
    expect(book.lastPageId).toBe(p2.id);
    const r = new Residency(fakeOps(), (k) => s.store.getAsset(k));
    r.setPages(art);
    await r.ensure(art.get(p1.id)!);
    await r.ensure(art.get(p2.id)!);
    expect(fake(art.get(p1.id)!.planes.ink).px).toBe('INK-1');
    expect(fake(art.get(p2.id)!.planes.pencil).px).toBe('PEN-2');
    expect(art.get(p3.id)!.parked).toBeNull(); // nothing drawn: a fresh page, nothing to load
    expect(s.store.books.get(s.book.id)!.pages).toBe(3);
  });

  it('does not re-encode a page that has not changed since the last save', async () => {
    const s = setup();
    const p1 = s.book.pages[0]!;
    const p2 = s.addPage();
    s.saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: 't', book: s.book, art: {} }), true);
    s.draw(p1.id, 'ink', 'A');
    await s.clock.advance(400);
    await drain(s.saver);
    expect(s.log).toEqual(['encode A']);
    s.draw(p2.id, 'ink', 'B');
    await s.clock.advance(400);
    await drain(s.saver);
    expect(s.log).toEqual(['encode A', 'encode B']);
  });

  it('waits while the pen is down', async () => {
    let down = true;
    const s = setup({ busy: () => down });
    s.saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: 't', book: s.book, art: {} }), true);
    s.draw(s.book.pages[0]!.id, 'ink', 'X');
    await s.clock.advance(2000);
    await drain(s.saver);
    expect(s.store.heads.size).toBe(0);
    down = false;
    await s.clock.advance(400);
    await drain(s.saver);
    expect(s.store.heads.size).toBe(1);
  });

  it('keeps an automatic restore point every 10 commands', async () => {
    const s = setup();
    s.saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: 't', book: s.book, art: {} }), true);
    const id = s.book.pages[0]!.id;
    for (let i = 1; i <= 9; i++) s.draw(id, 'ink', `v${i}`);
    await s.clock.advance(400);
    await drain(s.saver);
    expect(await s.store.listVersions(s.book.id)).toHaveLength(0);
    s.draw(id, 'ink', 'v10');
    await s.clock.advance(400);
    await drain(s.saver);
    const vs = await s.store.listVersions(s.book.id);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.auto).toBe(true);
    // the version points at the same content-addressed asset as the head: no copy
    expect(s.store.refs.get(`v:${vs[0]!.id}`)).toEqual(s.store.refs.get(`h:${s.book.id}`));
    expect(JSON.parse(vs[0]!.json).art[id].ink).toBe(JSON.parse(s.store.heads.get(s.book.id)!.json).art[id].ink);
  });

  it('a failed save keeps the previous one and retries', async () => {
    const s = setup();
    s.saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: 't', book: s.book, art: {} }), true);
    const id = s.book.pages[0]!.id;
    s.draw(id, 'ink', 'good');
    await s.clock.advance(400);
    await drain(s.saver);
    const good = s.store.heads.get(s.book.id)!.json;
    const real = s.store.saveHead.bind(s.store);
    s.store.saveHead = async () => {
      throw new Error('disk full');
    };
    s.draw(id, 'ink', 'bad');
    await s.clock.advance(400);
    await drain(s.saver);
    expect(s.saver.state).toBe('error');
    expect(s.saver.error).toBe('disk full');
    expect(s.store.heads.get(s.book.id)!.json).toBe(good);
    s.store.saveHead = real;
    await s.clock.advance(DEFAULTS.retryMs);
    await drain(s.saver);
    expect(s.saver.state).toBe('saved');
  });
});

describe('library helpers', () => {
  it('prunes only the oldest automatic versions', () => {
    const v = (id: string, at: number, auto: boolean): VersionRecord => ({ id, book: 'b', name: id, auto, at, json: '' });
    expect(versionsToPrune([v('a', 1, true), v('b', 2, false), v('c', 3, true), v('d', 4, true)], 2)).toEqual(['a']);
  });

  it('never deletes an asset a head, version or page in memory still uses', () => {
    expect(unreferencedAssets(['x', 'y', 'z'], new Set(['x']), new Set(['y']))).toEqual(['z']);
  });
});
