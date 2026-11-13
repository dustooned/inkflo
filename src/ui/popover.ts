import { h, seg, slider } from './dom';
import { prefs, setPrefs, type Backdrop, type Layout, type Theme } from './prefs';

let open: { el: HTMLElement; close: () => void } | null = null;

/**
 * Show a popover next to an anchor. Closes on Escape, an outside click, or when another opens.
 * Focus moves into it and returns to the anchor on close.
 */
export function popover(anchor: HTMLElement, content: HTMLElement, side: 'right' | 'below' | 'above' | 'left' = 'below', label = 'Menu', onClose?: () => void): () => void {
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
    if (e.target instanceof Element && e.target.closest('dialog[open]')) return;
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  function close(): void {
    if (open?.el !== el) return;
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    open = null;
    onClose?.();
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
export function displayMenu(anchor: HTMLElement, opts: { layout?: boolean; composition?: boolean } = {}): void {
  const build = () => {
    const p = prefs();
    const vignette = h('input', { type: 'checkbox', checked: p.vignette });
    const finger = h('input', { type: 'checkbox', checked: p.fingerDrawing });
    finger.addEventListener('change', () => setPrefs({ fingerDrawing: finger.checked }));
    vignette.addEventListener('change', () => setPrefs({ vignette: vignette.checked }));
    const guide = h('select', { 'aria-label': 'Composition guides' }, GUIDES.map((g) => h('option', { value: g.id, selected: g.id === p.guide }, g.label)));
    guide.addEventListener('change', () => setPrefs({ guide: guide.value as Guide }));
    const snap = h('input', { type: 'checkbox', checked: p.snapGuide });
    snap.addEventListener('change', () => setPrefs({ snapGuide: snap.checked }));
    return h('div', { style: 'width:240px' },
      h('h4', {}, 'Theme'),
      seg<Theme>([{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], p.theme, (v) => { setPrefs({ theme: v }); rebuild(); }, 'Theme'),
      h('h4', {}, 'Canvas backdrop'),
      seg<Backdrop>([{ id: 'grid', label: 'Grid' }, { id: 'dots', label: 'Dots' }, { id: 'plain', label: 'Plain' }], p.backdrop, (v) => { setPrefs({ backdrop: v }); rebuild(); }, 'Backdrop'),
      h('div', { class: 'row' }, slider('Grid strength', 0, 100, 1, p.gridOpacity * 100, (v) => `${v}%`, (v) => setPrefs({ gridOpacity: v / 100 }))),
      h('div', { class: 'row' }, slider('Board brightness', -100, 100, 1, p.boardBrightness * 100, (v) => v ? `${v > 0 ? '+' : ''}${v}%` : 'Theme', (v) => setPrefs({ boardBrightness: v / 100 }))),
      h('div', { class: 'row' }, h('label', {}, vignette, 'Vignette')),
      opts.composition ? [
        h('h4', {}, 'Composition guides'),
        h('div', { class: 'row' }, guide),
        h('div', { class: 'row' }, h('label', {}, snap, 'Snap drawing to guide lines')),
      ] : null,
      opts.layout
        ? [h('div', { class: 'sep' }), h('h4', {}, 'Layout'),
          seg<Layout>([{ id: 'studio', label: 'Studio' }, { id: 'simple', label: 'Simple' }, { id: 'focus', label: 'Focus' }], p.layout, (v) => { setPrefs({ layout: v }); rebuild(); }, 'Layout'),
          h('div', { class: 'row' }, h('label', {}, finger, 'Draw with finger')),
          h('p', { class: 'note', style: 'margin:0 8px 6px' }, 'Tab switches between Studio and Focus.')]
        : null,
    );
  };
  const holder = h('div', {}, build());
  const rebuild = () => holder.replaceChildren(build());
  popover(anchor, holder, 'below', 'Display');
}

/** The header button that opens the display menu. */
export function displayButton(layout = false, composition = false): HTMLButtonElement {
  const b = h('button', { class: 'icon', type: 'button', 'aria-label': 'Display settings', title: 'Display: theme, backdrop, layout' }, '◐');
  b.addEventListener('click', () => displayMenu(b, { layout, composition }));
  return b;
}
import { GUIDES, type Guide } from '../geom/composition';
