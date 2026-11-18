/** Tiny DOM helpers: no framework (CLAUDE.md rule 6). */
import { icon, type IconName } from './icons';
import { openModal } from './modal';

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
    input.addEventListener('cancel', () => resolve(null));
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

export function seg<T extends string>(options: { id: T; label: string; icon?: IconName; hint?: string }[], value: T, onPick: (v: T) => void, label = ''): HTMLElement {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    el.append(h('button', { type: 'button', title: o.hint ?? o.label, 'aria-pressed': String(o.id === value), ...(o.icon ? { class: 'seg-icon' } : {}), onclick: () => onPick(o.id) }, o.icon ? icon(o.icon, 16) : null, o.label));
  }
  return el;
}

export function confirmDialog(title: string, body: string, ok = 'OK'): Promise<boolean> {
  const modal = openModal<'cancel' | 'ok'>({ title, content: body, actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: ok, primary: true }] });
  return modal.done.then((id) => id === 'ok');
}

/** Ask for one line of text in a dialog. Resolves null on cancel. */
export function askText(title: string, label: string, value: string, ok = 'OK', allowEmpty = false): Promise<string | null> {
  const input = h('input', { value, 'aria-label': label, required: !allowEmpty });
  // an empty field blocks Save (as the form's `required` did); Enter in the field saves
  const modal = openModal<'cancel' | 'ok'>({
    title, content: h('label', { class: 'field' }, label, input), focus: input,
    actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: ok, primary: true, run: () => { if (!allowEmpty && input.value === '') { input.focus(); return false; } } }],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); modal.buttons.ok.click(); } });
  input.select();
  return modal.done.then((id) => (id === 'ok' ? (allowEmpty ? input.value.trim() : input.value.trim() || value) : null));
}
