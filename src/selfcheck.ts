/**
 * Browser self-check: exercises the parts Vitest cannot (real canvas, PNG codec, IndexedDB,
 * RasterEngine replay). Results go to the page and to `window.__selfcheck` for automation.
 * Uses its own database, deleted at the start and the end; the user's library is never opened.
 */
import { groupOf, newBook, newLayer, pagePixels, type Book, type Layer, type Page, type Stroke } from './doc/model';
import { parseBookFile } from './doc/schema';
import { replayLayer } from './draw/replay';
import { newPageArt, Residency, type PageArt } from './draw/residency';
import { RasterEngine } from './engine/brush/raster';
import { hash01 } from './engine/core/rng';
import { Autosaver } from './io/autosave';
import { captureBook } from './io/capture';
import { browserPlaneOps, decodePngInto, encodePng, isBlank, makeCanvas } from './io/canvasops';
import { loadBookFile } from './io/load';
import { IdbStore, metaFromFile } from './io/persist';

const DB = 'inkflo-selfcheck';
const ops = browserPlaneOps;

interface Result {
  name: string;
  ok: boolean;
  info?: boolean;
  ms: number;
  detail: string;
}

const results: Result[] = [];
const list = document.getElementById('results')!;
const pagesEl = document.getElementById('pages')!;

async function check(name: string, fn: () => Promise<string> | string, info = false): Promise<void> {
  const t0 = performance.now();
  let ok = true;
  let detail = '';
  try {
    detail = await fn();
  } catch (e) {
    ok = false;
    detail = e instanceof Error ? e.message : String(e);
  }
  const r: Result = { name, ok, info, ms: performance.now() - t0, detail };
  results.push(r);
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = `${ok ? (info ? 'ℹ' : '✓') : '✗'} ${name} (${r.ms.toFixed(0)} ms)${detail ? `: ${detail}` : ''}`;
  list.append(li);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Deterministic wobbly strokes across the page (page units = inches). */
function strokes(n: number, seed: number, brushId: string, w: number, page: Page): Stroke[] {
  const out: Stroke[] = [];
  for (let s = 0; s < n; s++) {
    const r = (salt: number) => hash01(seed + s, 0, salt);
    const x0 = 0.3 + r(1) * (page.widthIn - 0.6);
    const y0 = 0.3 + r(2) * (page.heightIn - 0.6);
    const ang = r(3) * Math.PI * 2;
    const len = 0.3 + r(4) * 1.2;
    const pts = [];
    const pressure = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const bend = Math.sin(f * Math.PI) * (r(5) - 0.5) * 0.4;
      pts.push({ x: x0 + Math.cos(ang) * len * f - Math.sin(ang) * bend, y: y0 + Math.sin(ang) * len * f + Math.cos(ang) * bend });
      pressure.push(0.25 + 0.75 * Math.sin(f * Math.PI));
    }
    out.push({ pts, pressure, w, brushId, seed: seed * 1000 + s });
  }
  return out;
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
}

/** Alpha must match exactly; colour within 1 (canvas stores premultiplied alpha). */
function compare(a: HTMLCanvasElement, b: HTMLCanvasElement): { alphaDiff: number; rgbOver1: number } {
  assert(a.width === b.width && a.height === b.height, `size ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  const pa = pixels(a);
  const pb = pixels(b);
  let alphaDiff = 0;
  let rgbOver1 = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (pa[i + 3] !== pb[i + 3]) alphaDiff++;
    else if (pa[i + 3]! > 0) for (let k = 0; k < 3; k++) if (Math.abs(pa[i + k]! - pb[i + k]!) > 1) rgbOver1++;
  }
  return { alphaDiff, rgbOver1 };
}

/** JSON with sorted keys, so field order does not count as a change. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

function copy(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height);
  out.getContext('2d')!.drawImage(c, 0, 0);
  return out;
}

function show(c: HTMLCanvasElement, caption: string): void {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(c, cap);
  pagesEl.append(fig);
}

/** Background layers with the ids 'pencil' and 'ink', so their bitmaps are art.planes.pencil / .ink. */
function bookWithArt(inkStrokes: number): { book: Book; page: Page; art: Map<string, PageArt>; inkL: Layer; pencilL: Layer } {
  const book = newBook('Self-check');
  const page = book.pages[0]!;
  const inkL: Layer = { ...newLayer('ink', 'ink'), strokes: strokes(inkStrokes, 11, 'g-pen', 0.025, page) };
  const pencilL: Layer = { ...newLayer('pencil', 'pencil'), strokes: strokes(20, 77, 'pencil-hb', 0.03, page) };
  groupOf(page, 'background').layers.push(pencilL, inkL);
  const { width, height } = pagePixels(page, book.dpi);
  const art = new Map([[page.id, newPageArt(page.id, 'Page 1', width, height)]]);
  return { book, page, art, inkL, pencilL };
}

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

async function run(): Promise<void> {
  await deleteDb();
  const engine = new RasterEngine(1, 1);
  const { book, page, art, inkL, pencilL } = bookWithArt(60);
  const a = art.get(page.id)!;
  let ink: HTMLCanvasElement | null = null;

  await check('Replay draws ink and pencil onto the page bitmaps', () => {
    replayLayer(page, a, inkL, book.dpi, engine, ops);
    replayLayer(page, a, pencilL, book.dpi, engine, ops);
    ink = a.planes.ink!;
    assert(!isBlank(ink), 'ink bitmap is blank');
    assert(!isBlank(a.planes.pencil!), 'pencil bitmap is blank');
    assert(!a.planes.colour, 'a colour layer bitmap was created without anything to draw');
    show(copy(ink), `ink, ${inkL.strokes.length} strokes, ${ink.width}×${ink.height}`);
    show(copy(a.planes.pencil!), `pencil, ${pencilL.strokes.length} strokes`);
    return `${ink.width}×${ink.height} px at ${book.dpi} dpi`;
  });

  await check('isBlank: a fresh canvas is blank', () => {
    assert(isBlank(makeCanvas(64, 64)), 'fresh canvas reported as painted');
    return '';
  });

  await check('Replay is deterministic (same strokes, same pixels)', () => {
    const again = newPageArt(page.id, 'again', a.width, a.height);
    replayLayer(page, again, inkL, book.dpi, engine, ops);
    const d = compare(ink!, again.planes.ink!);
    assert(d.alphaDiff === 0 && d.rgbOver1 === 0, `${d.alphaDiff} alpha / ${d.rgbOver1} colour pixels differ`);
    return 'pixel-identical';
  });

  await check('PNG round trip keeps every pixel', async () => {
    const bytes = await encodePng(ink!);
    const back = makeCanvas(ink!.width, ink!.height);
    await decodePngInto(back, bytes);
    const d = compare(ink!, back);
    assert(d.alphaDiff === 0, `${d.alphaDiff} pixels changed alpha`);
    assert(d.rgbOver1 === 0, `${d.rgbOver1} pixels changed colour by more than 1`);
    return `${(bytes.byteLength / 1024).toFixed(0)} KB PNG`;
  });

  await check(
    '600 dpi replay matches 300 dpi when scaled down',
    () => {
      const hi = newPageArt(page.id, 'hi', pagePixels(page, 600).width, pagePixels(page, 600).height);
      replayLayer(page, hi, inkL, 600, engine, ops);
      const down = makeCanvas(a.width, a.height);
      const g = down.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(hi.planes.ink!, 0, 0, a.width, a.height);
      const pa = pixels(ink!);
      const pb = pixels(down);
      let sum = 0;
      let painted = 0;
      for (let i = 3; i < pa.length; i += 4) {
        if (pa[i]! || pb[i]!) {
          painted++;
          sum += Math.abs(pa[i]! - pb[i]!);
        }
      }
      const mean = sum / Math.max(1, painted);
      show(down, '600 dpi ink, scaled to 300');
      assert(mean < 40, `mean alpha difference ${mean.toFixed(1)} / 255 on painted pixels (limit 40)`);
      return `mean alpha difference ${mean.toFixed(1)} / 255 on painted pixels`;
    },
  );

  await check('Residency parks real canvases and restores them exactly', async () => {
    const before = copy(ink!);
    const r = new Residency(ops, async () => null, 0);
    r.setPages(art);
    await r.settle();
    assert(a.parked !== null, 'page was not parked under a zero budget');
    assert(a.planes.ink!.width === 0, 'parked canvas still holds memory');
    await r.ensure(a);
    const d = compare(before, a.planes.ink!);
    assert(d.alphaDiff === 0 && d.rgbOver1 === 0, `${d.alphaDiff} alpha / ${d.rgbOver1} colour pixels differ`);
    // (not setPages(new Map()): that frees the old pages' canvases, as closing a book should)
    return 'parked to 0×0, restored pixel-exact';
  });

  let store: IdbStore | null = null;
  await check('Autosave to IndexedDB, reopen, same book and pixels', async () => {
    const before = { ink: copy(a.planes.ink!), pencil: copy(a.planes.pencil!) };
    store = await IdbStore.open(DB);
    const saver = new Autosaver(store, () => captureBook(book, art, ops));
    saver.open(metaFromFile({ format: 'inkflo-book', schema: 1, savedBy: 'selfcheck', book, art: {} }), false);
    await saver.flush();
    await saver.idle();
    saver.stop();
    assert(saver.state === 'saved', `autosave state ${saver.state}: ${saver.error ?? ''}`);
    store.close();

    const fresh = await IdbStore.open(DB);
    store = fresh;
    const head = await fresh.getHead(book.id);
    assert(!!head, 'no saved head');
    const loaded = loadBookFile(parseBookFile(head!.json));
    assert(canonical(loaded.book.pages[0]!.groups) === canonical(page.groups), 'strokes changed in the round trip');
    const la = loaded.art.get(page.id)!;
    assert(la.parked !== null, 'loaded page should start parked');
    const r = new Residency(ops, (k) => fresh.getAsset(k));
    r.setPages(loaded.art);
    await r.ensure(la);
    for (const pass of ['ink', 'pencil'] as const) {
      const d = compare(before[pass], la.planes[pass]!);
      assert(d.alphaDiff === 0 && d.rgbOver1 <= 0, `${pass}: ${d.alphaDiff} alpha / ${d.rgbOver1} colour pixels differ`);
    }
    const assets = await fresh.assetKeys();
    return `${assets.length} assets, ${(head!.json.length / 1024).toFixed(1)} KB book.json`;
  });

  // ---- timings (information, judged on the target iPad, not here)
  const N = 100;
  const big = bookWithArt(N);
  const bp = big.page;
  const ba = big.art.get(bp.id)!;
  await check(
    `Timing: replay ${N} ink strokes (300 dpi)`,
    () => {
      const t0 = performance.now();
      replayLayer(bp, ba, big.inkL, big.book.dpi, engine, ops);
      const ms = performance.now() - t0;
      return `${ms.toFixed(0)} ms, ${(ms / N).toFixed(1)} ms per stroke`;
    },
    true,
  );
  await check(
    `Timing: open a ${N}-stroke page from its stored bitmap (spec: 500 strokes < 150 ms on iPad Air)`,
    async () => {
      const bytes = await encodePng(ba.planes.ink!);
      const c = makeCanvas(ba.width, ba.height);
      const t0 = performance.now();
      await decodePngInto(c, bytes);
      return `${(performance.now() - t0).toFixed(0)} ms decode, ${(bytes.byteLength / 1024).toFixed(0)} KB`;
    },
    true,
  );

  (store as IdbStore | null)?.close();
  await deleteDb();

  const failed = results.filter((r) => !r.ok).length;
  const summary = document.getElementById('summary')!;
  summary.textContent = failed ? `${failed} of ${results.length} failed` : `All ${results.length} passed`;
  summary.className = failed ? 'fail' : 'pass';
  (window as unknown as { __selfcheck: unknown }).__selfcheck = { done: true, failed, results };
}

void run();
