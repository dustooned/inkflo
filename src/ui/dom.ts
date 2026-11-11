/** Tiny DOM helpers: no framework (CLAUDE.md rule 6). */

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function toast(message: string, ms = 2600): void {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book';
}

/** A labelled range slider for context bars. */
export function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void, onCommit?: (v: number) => void): HTMLElement {
  const out = h('b', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  input.addEventListener('change', () => onCommit?.(Number(input.value)));
  return h('label', { class: 'mini' }, label, input, out);
}

export function seg<T extends string>(options: { id: T; label: string }[], value: T, onPick: (v: T) => void, label = ''): HTMLElement {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    el.append(h('button', { type: 'button', 'aria-pressed': String(o.id === value), onclick: () => onPick(o.id) }, o.label));
  }
  return el;
}

export function confirmDialog(title: string, body: string, ok = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    const d = h('dialog', {},
      h('header', {}, h('h2', {}, title)),
      h('div', { class: 'content' }, h('p', { class: 'note' }, body)),
      h('footer', {},
        h('button', { class: 'btn', type: 'button', onclick: () => { d.close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); resolve(true); } }, ok)));
    d.addEventListener('close', () => { d.remove(); resolve(false); });
    document.body.append(d);
    d.showModal();
  });
}

/** Ask for one line of text in a dialog. Resolves null on cancel. */
export function askText(title: string, label: string, value: string, ok = 'OK'): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      d.close();
      resolve(v);
    };
    const input = h('input', { value, 'aria-label': label, required: true });
    const form = h('form', { method: 'dialog' },
      h('header', {}, h('h2', {}, title)),
      h('div', { class: 'content' }, h('label', { class: 'field' }, label, input)),
      h('footer', {},
        h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, ok)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value.trim() || value);
    });
    const d = h('dialog', {}, form);
    d.addEventListener('close', () => {
      d.remove();
      finish(null);
    });
    document.body.append(d);
    d.showModal();
    input.select();
  });
}
