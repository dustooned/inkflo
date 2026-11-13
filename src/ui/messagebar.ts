import { h } from './dom';

export interface HintOptions {
  control?: HTMLElement;
  tone?: 'info' | 'warn';
  timeout?: number;
}

export function messageBar() {
  const label = h('span', { class: 'message-text', role: 'status', 'aria-live': 'polite' });
  const slot = h('div', { class: 'message-control', hidden: true });
  const el = h('div', { class: 'messagebar' }, label, slot);
  let timer = 0;
  function clearHint(): boolean {
    clearTimeout(timer);
    if (!label.textContent && slot.hidden) return false;
    label.textContent = '';
    slot.replaceChildren();
    slot.hidden = true;
    delete el.dataset.tone;
    return true;
  }
  return {
    el,
    clearHint,
    hint(text: string, opts: HintOptions = {}) {
      clearTimeout(timer);
      if (label.textContent !== text) label.textContent = text;
      if (slot.firstChild !== (opts.control ?? null)) slot.replaceChildren(...(opts.control ? [opts.control] : []));
      slot.hidden = !opts.control;
      el.dataset.tone = opts.tone ?? 'info';
      if (opts.timeout) timer = window.setTimeout(clearHint, opts.timeout);
    },
  };
}
