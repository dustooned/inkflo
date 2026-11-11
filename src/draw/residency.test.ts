import { describe, expect, it } from 'vitest';
import { newPageArt, planeCanvas, recordSaved, referencedKeys, Residency, residentBytes, storedPageArt, touchLayer, type PageArt } from './residency';
import { fake, fakeOps } from '../test/fakes';

const W = 10;
const H = 20;
const PLANE = W * H * 4;

/** A resident page with the given passes drawn ('' = canvas exists but blank). */
function page(id: string, passes: Partial<Record<'pencil' | 'ink' | 'colour', string>>): PageArt {
  const a = newPageArt(id, `Page ${id}`, W, H);
  const ops = fakeOps();
  for (const [pass, px] of Object.entries(passes)) fake(planeCanvas(a, pass as 'ink', ops)).px = px;
  return a;
}

const pages = (as: PageArt[]) => new Map(as.map((a) => [a.id, a]));

describe('page residency', () => {
  it('parks the least recently used pages to fit the budget and brings every pass back intact', async () => {
    const as = [page('1', { pencil: 'p1', ink: 'i1' }), page('2', { ink: 'i2' }), page('3', { ink: 'i3', colour: 'c3' }), page('4', { ink: 'i4' })];
    const r = new Residency(fakeOps(), async () => null, PLANE * 3);
    r.setPages(pages(as));
    r.use([as[3]!]);
    r.touch(as[2]!);
    await r.settle();
    expect(r.liveBytes()).toBeLessThanOrEqual(PLANE * 3);
    expect(as[3]!.parked).toBeNull(); // wanted: never parked
    expect(as[0]!.parked).not.toBeNull(); // oldest
    expect(fake(as[0]!.planes.pencil).width).toBe(0); // memory handed back
    expect(residentBytes(as[0]!)).toBe(0);

    await r.ensure(as[0]!);
    expect(as[0]!.parked).toBeNull();
    expect(fake(as[0]!.planes.pencil).px).toBe('p1');
    expect(fake(as[0]!.planes.ink).px).toBe('i1');
    expect(fake(as[0]!.planes.ink).height).toBe(H);
  });

  it('a layer never drawn has no canvas, and a blank layer parks as nothing', async () => {
    const a = page('1', { ink: '' }); // ink canvas exists but is blank; no other layers
    const r = new Residency(fakeOps(), async () => null, 0);
    r.setPages(pages([a]));
    await r.settle();
    expect(a.parked?.planes).toEqual({ ink: null });
    await r.ensure(a);
    expect(a.planes.pencil).toBeUndefined();
    expect(a.planes.colour).toBeUndefined();
    expect(fake(a.planes.ink).width).toBe(W); // the canvas object came back at page size
  });

  it('a saved page parks as its stored keys without encoding again', async () => {
    const log: string[] = [];
    const a = page('1', { ink: 'i1' });
    recordSaved(a, { ink: { rev: a.revs.ink ?? 0, key: 'assets/k.png' } });
    const r = new Residency(fakeOps(log), async () => null, 0);
    r.setPages(pages([a]));
    await r.settle();
    expect(log).toEqual([]);
    expect(a.parked?.planes.ink).toEqual({ key: 'assets/k.png', bytes: null });
    expect(referencedKeys([a])).toEqual(new Set(['assets/k.png']));
  });

  it('a book opens parked and decodes from the asset source, marking what it read as saved', async () => {
    const enc = new TextEncoder();
    const a = storedPageArt('1', 'Page 1', W, H, { pencil: null, ink: 'assets/ink.png', colour: 'assets/col.png' });
    const store: Record<string, Uint8Array> = { 'assets/ink.png': enc.encode('INK'), 'assets/col.png': enc.encode('COL') };
    const r = new Residency(fakeOps(), async (k) => store[k] ?? null, PLANE * 10);
    r.setPages(pages([a]));
    await r.ensure(a);
    expect(fake(a.planes.ink).px).toBe('INK');
    expect(fake(a.planes.colour).px).toBe('COL');
    expect(a.planes.pencil).toBeUndefined();
    expect(a.saved).toEqual({ pencil: { rev: 0, key: null }, ink: { rev: 0, key: 'assets/ink.png' }, colour: { rev: 0, key: 'assets/col.png' } });
  });

  it('a changed layer is re-encoded when parked; an unchanged saved layer is not', async () => {
    const log: string[] = [];
    const a = page('1', { ink: 'I', colour: 'C' });
    recordSaved(a, { ink: { rev: a.revs.ink ?? 0, key: 'assets/i.png' }, colour: { rev: a.revs.colour ?? 0, key: 'assets/c.png' } });
    touchLayer(a, 'colour');
    fake(a.planes.colour).px = 'C2';
    const r = new Residency(fakeOps(log), async () => null, 0);
    r.setPages(pages([a]));
    await r.settle();
    expect(log).toEqual(['encode C2']);
    expect(a.parked?.planes.ink).toEqual({ key: 'assets/i.png', bytes: null });
  });

  it('a missing asset warns and leaves that pass blank', async () => {
    const a = storedPageArt('1', 'Page 1', W, H, { pencil: null, ink: 'assets/gone.png', colour: null });
    const warnings: string[] = [];
    const r = new Residency(fakeOps(), async () => null, PLANE * 10);
    r.onWarning = (m) => warnings.push(m);
    r.setPages(pages([a]));
    await r.ensure(a);
    expect(a.parked).toBeNull();
    expect(fake(a.planes.ink).px).toBe('');
    expect(warnings[0]).toContain('Page 1');
    expect(warnings[0]).toContain('ink');
  });

  it('pinned pages are never parked until unpinned', async () => {
    const a = page('1', { ink: 'i' });
    const r = new Residency(fakeOps(), async () => null, 0);
    r.setPages(pages([a]));
    await r.pin(a);
    await r.settle();
    expect(a.parked).toBeNull();
    r.unpin(a);
    await r.settle();
    expect(a.parked).not.toBeNull();
  });

  it('a page edited while it was being compressed is not parked', async () => {
    const a = page('1', { ink: 'before' });
    const ops = fakeOps();
    const r = new Residency(ops, async () => null, 0);
    r.setPages(pages([a]));
    // let parking start, then edit before the encode resolves
    await new Promise((res) => setTimeout(res, 0));
    fake(a.planes.ink).px = 'after';
    a.rev += 1;
    r.budget = PLANE * 10; // stop it retrying
    await r.settle();
    expect(a.parked).toBeNull();
    expect(fake(a.planes.ink).px).toBe('after');
  });

  it('drawing on a parked page is refused', () => {
    const a = storedPageArt('1', 'Page 1', W, H, { pencil: null, ink: 'k', colour: null });
    expect(() => planeCanvas(a, 'ink', fakeOps())).toThrow(/parked/);
  });
});
