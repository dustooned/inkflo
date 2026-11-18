import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openModal } from './modal';

/** Just enough DOM for the modal shell (the unit suite runs in Node, without a browser). */
class FakeEvent {
  defaultPrevented = false;
  constructor(readonly type: string) {}
  preventDefault() { this.defaultPrevented = true; }
}
class FakeEl {
  readonly attrs = new Map<string, string>();
  readonly children: (FakeEl | string)[] = [];
  parent: FakeEl | null = null;
  className = '';
  textContent = '';
  open = false;
  focused = false;
  private listeners = new Map<string, ((e: FakeEvent) => void)[]>();
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  append(...nodes: (FakeEl | string)[]) { for (const n of nodes) { if (typeof n !== 'string') n.parent = this; this.children.push(n); } }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  addEventListener(type: string, fn: (e: FakeEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  dispatch(type: string) { const e = new FakeEvent(type); for (const fn of this.listeners.get(type) ?? []) fn(e); return e; }
  click() { this.dispatch('click'); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  /** Like a browser: the "close" event comes later, not inside close(). */
  close() { if (!this.open) return; this.open = false; queueMicrotask(() => this.dispatch('close')); }
  get isConnected(): boolean { return this.parent === body || !!this.parent?.isConnected; }
}
let body: FakeEl;
const saved = (globalThis as { document?: unknown }).document;
beforeEach(() => {
  body = new FakeEl('body');
  (globalThis as { document?: unknown }).document = { body, createElement: (tag: string) => new FakeEl(tag) };
});
afterEach(() => { (globalThis as { document?: unknown }).document = saved; });
const fake = (n: unknown) => n as FakeEl;
const tags = (e: FakeEl) => e.children.map((c) => (typeof c === 'string' ? c : c.tagName));

describe('openModal', () => {
  it('builds header, content and footer, opens, and answers with the clicked action', async () => {
    const field = document.createElement('input');
    const h = openModal({ title: 'Rename', className: 'small', content: ['Pick a name.', field], actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', primary: true }], focus: field });
    const d = fake(h.dialog);
    expect(d.open).toBe(true);
    expect(d.isConnected).toBe(true);
    expect(d.className).toBe('small');
    expect(tags(d)).toEqual(['header', 'div', 'footer']);
    expect(fake(h.content).className).toBe('content');
    expect(tags(fake(h.content))).toEqual(['p', 'input']);
    expect(fake((fake(h.content).children[0] as FakeEl)).className).toBe('note');
    expect(fake(h.buttons.ok).className).toBe('btn primary');
    expect(fake(h.buttons.cancel).className).toBe('btn');
    expect(fake(field).focused).toBe(true);
    fake(h.buttons.ok).click();
    expect(await h.done).toBe('ok');
    expect(d.open).toBe(false);
    expect(d.isConnected).toBe(false);
    expect(h.closed).toBe(true);
  });

  it('answers Escape with the cancel id and stops the browser closing it on its own', async () => {
    const h = openModal({ title: 'T', actions: [{ id: 'keep', label: 'Keep' }], cancelId: 'keep' });
    expect(fake(h.dialog).dispatch('cancel').defaultPrevented).toBe(true);
    expect(await h.done).toBe('keep');
  });

  it('answers once: a later close, click or close event changes nothing', async () => {
    const closes: string[] = [];
    const h = openModal({ title: 'T', actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'OK' }], onClose: (id) => closes.push(id) });
    h.close('ok');
    h.close('cancel');
    fake(h.buttons.cancel).click();
    await Promise.resolve();
    expect(await h.done).toBe('ok');
    expect(closes).toEqual(['ok']);
  });

  it('treats an outside close of the <dialog> as cancel', async () => {
    const h = openModal({ title: 'T' });
    fake(h.dialog).close();
    expect(await h.done).toBe('cancel');
    expect(fake(h.dialog).isConnected).toBe(false);
  });

  it('keeps the dialog open when an action’s run returns false', async () => {
    let valid = false;
    const h = openModal({ title: 'T', actions: [{ id: 'ok', label: 'Apply', run: () => valid }] });
    fake(h.buttons.ok).click();
    expect(h.closed).toBe(false);
    expect(fake(h.dialog).open).toBe(true);
    valid = true;
    fake(h.buttons.ok).click();
    expect(await h.done).toBe('ok');
  });

  it('puts a detail line in the header and extra classes on the content', () => {
    const note = document.createElement('p');
    const h = openModal({ title: 'T', detail: note, contentClass: 'stack' });
    const header = fake(h.dialog).children[0] as FakeEl;
    expect(tags(header)).toEqual(['h2', 'p']);
    expect(fake(h.content).className).toBe('content stack');
  });

  it('marks danger buttons, and has no footer without actions', () => {
    const h = openModal({ title: 'Delete', content: 'Gone for good.', actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'go', label: 'Delete', danger: true }] });
    expect(fake(h.buttons.go).className).toBe('btn danger');
    const info = openModal({ title: 'Info' });
    expect(info.footer).toBeNull();
    expect(tags(fake(info.dialog))).toEqual(['header', 'div']);
  });
});
