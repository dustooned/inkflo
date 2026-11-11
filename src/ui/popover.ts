import { h, seg } from './dom';
import { prefs, setPrefs, type Backdrop, type Theme } from './prefs';

let open: { el: HTMLElement; close: () => void } | null = null;

/**
 * Show a popover next to an anchor. Closes on Escape, an outside click, or when another opens.
 * Focus moves into it and returns to the anchor on close.
 */
export function popover(anchor: HTMLElement, content: HTMLElement, side: 'right' | 'below' | 'above' | 'left' = 'below', label = 'Menu'): () => void {
  open?.close();
  const el = h('div', { class: 'pop', role: 'dialog', 'aria-label': label }, content);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x = side === 'right' ? r.right + 8 : side === 'left' ? r.left - w - 8 : r.left;
  let y = side === 'below' ? r.bottom + 6 : side === 'above' ? r.top - hgt - 6 : r.top;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  y = Math.max(8, Math.min(window.innerHeight - hgt - 8, y));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  function close(): void {
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (open?.el === el) open = null;
  }
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  open = { el, close };
  (el.querySelector('button, input, select') as HTMLElement | null)?.focus();
  return close;
}

export function closePopover(): void {
  open?.close();
}

/** The display menu: theme, canvas backdrop, layout. */
export function displayMenu(anchor: HTMLElement, opts: { layout?: boolean } = {}): void {
  const build = () => {
    const p = prefs();
    const opacity = h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: p.gridOpacity, 'aria-label': 'Grid strength' });
    opacity.addEventListener('input', () => setPrefs({ gridOpacity: Number(opacity.value) }));
    const vignette = h('input', { type: 'checkbox', checked: p.vignette });
    vignette.addEventListener('change', () => setPrefs({ vignette: vignette.checked }));
    return h('div', { style: 'width:240px' },
      h('h4', {}, 'Theme'),
      seg<Theme>([{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], p.theme, (v) => { setPrefs({ theme: v }); rebuild(); }, 'Theme'),
      h('h4', {}, 'Canvas backdrop'),
      seg<Backdrop>([{ id: 'grid', label: 'Grid' }, { id: 'dots', label: 'Dots' }, { id: 'plain', label: 'Plain' }], p.backdrop, (v) => { setPrefs({ backdrop: v }); rebuild(); }, 'Backdrop'),
      h('div', { class: 'row' }, h('label', {}, 'Strength', opacity)),
      h('div', { class: 'row' }, h('label', {}, vignette, 'Vignette')),
      opts.layout
        ? [h('div', { class: 'sep' }), h('h4', {}, 'Layout'),
          seg([{ id: 'studio', label: 'Studio' }, { id: 'focus', label: 'Focus' }], p.layout, (v) => { setPrefs({ layout: v as 'studio' | 'focus' }); rebuild(); }, 'Layout'),
          h('p', { class: 'note', style: 'margin:0 8px 6px' }, 'Tab switches between Studio and Focus.')]
        : null,
    );
  };
  const holder = h('div', {}, build());
  const rebuild = () => holder.replaceChildren(build());
  popover(anchor, holder, 'below', 'Display');
}

/** The header button that opens the display menu. */
export function displayButton(layout = false): HTMLButtonElement {
  const b = h('button', { class: 'icon', type: 'button', 'aria-label': 'Display settings', title: 'Display: theme, backdrop, layout' }, '◐');
  b.addEventListener('click', () => displayMenu(b, { layout }));
  return b;
}
