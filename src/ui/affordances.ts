import { icon, iconFor } from './icons';

/**
 * App-wide hover help and icons.
 *
 * - **Tooltips:** any control with a title, aria-label or data-tip shows a styled tip after a
 *   short hover (or on keyboard focus). The native title is moved to data-tip so it does not
 *   show twice. A tip that only repeats the visible text is skipped.
 * - **Icons:** buttons in the bars, menus and sidebars get the icon for their label. Secondary
 *   header buttons become icon-only; their name stays as aria-label and in the tooltip.
 */

const CONTROL = 'button, a[href], select, input[type="number"][aria-label], [role="button"], [role="menuitem"], [data-tip]';
/** Header buttons that show only their icon (the tooltip names them). */
const ICON_ONLY = new Set(['Spread', 'Spread preview', 'Simple / Studio', 'Mark done', 'Done ✓', 'Show inspector', 'Hide inspector', 'Inspector']);
const DECORATE = '.bar button, .ctx button, .chrome-actions button, .chrome-nav button, .insp button, .pop .item';

let tip: HTMLElement | null = null;
let timer = 0;
let target: Element | null = null;

function tipText(el: Element): string {
  const title = el.getAttribute('title');
  if (title) {
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
    // the title was the only name: keep it as the accessible name
    if (!el.getAttribute('aria-label') && !(el.textContent ?? '').trim()) el.setAttribute('aria-label', title);
  }
  const text = el.getAttribute('data-tip') || el.getAttribute('aria-label') || '';
  const visible = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== visible ? text : '';
}

function hide(): void {
  clearTimeout(timer);
  target = null;
  tip?.remove();
  tip = null;
}

function show(el: Element): void {
  const text = tipText(el);
  if (!text || !el.isConnected) return;
  tip?.remove();
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = text;
  document.body.append(tip);
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.bottom + 6;
  // Rail and side controls: the tip goes beside them, not over the next tool.
  if (el.closest('.rail')) { x = r.right + 8; y = r.top + r.height / 2 - h / 2; }
  else if (y + h > innerHeight - 4) y = r.top - h - 6;
  tip.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x))}px`;
  tip.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, y))}px`;
}

function schedule(el: Element, delay: number): void {
  if (el === target) return;
  hide();
  target = el;
  timer = window.setTimeout(() => show(el), delay);
}

export function decorate(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(DECORATE)) {
    if (el.closest('[data-noicons]')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    const aria = el.getAttribute('aria-label') || '';
    // an .icon button's text is a glyph ("←"); its name is the aria-label
    const label = (el.classList.contains('icon') ? aria || own : own || aria);
    if (el.dataset.iconized === label) continue;
    el.dataset.iconized = label;
    const name = iconFor(label);
    if (!name) continue;
    el.querySelector(':scope > svg.ico')?.remove();
    // a menu row's old text glyph gives way to the icon
    const oldGlyph = el.querySelector(':scope > span[aria-hidden="true"]:first-child');
    if (oldGlyph && el.matches('.pop .item')) oldGlyph.remove();
    const glyphOnly = el.classList.contains('icon') || (!!el.closest('.bar') && ICON_ONLY.has(label));
    if (glyphOnly) {
      if (own && !el.classList.contains('icon')) el.setAttribute('aria-label', own);
      for (const n of [...el.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove();
      el.classList.add('icon-only');
    }
    el.prepend(icon(name, glyphOnly ? 18 : 16));
  }
}

export function installAffordances(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = (e.target as Element).closest?.(CONTROL);
    if (!el || el.closest('.tip')) { if (!el) hide(); return; }
    schedule(el, 450);
  });
  document.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget as Element | null;
    if (target && (!to || !target.contains(to))) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest?.(CONTROL);
    if (el?.matches(':focus-visible')) schedule(el, 250);
  });
  document.addEventListener('focusout', hide);
  for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll'] as const) document.addEventListener(type, hide, { capture: true, passive: true });

  // Menus: arrow keys, Home and End move between enabled rows (the canvas menu, Export, flyouts).
  document.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const menu = (e.target as Element).closest?.('[role="menu"]');
    if (!menu) return;
    const rows = [...menu.querySelectorAll<HTMLElement>('button:not([disabled]), [role^="menuitem"]:not([disabled])')].filter((r) => r.offsetParent !== null);
    if (!rows.length) return;
    const at = rows.indexOf(e.target as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
      : (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus();
    e.preventDefault();
  });

  // Full one-row bars: a vertical wheel scrolls them sideways; a fade marks the hidden side.
  document.addEventListener('wheel', (e) => {
    const bar = (e.target as Element).closest?.('.bar');
    if (!(bar instanceof HTMLElement) || bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    bar.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  const edges = () => {
    for (const bar of document.querySelectorAll<HTMLElement>('.bar')) {
      const more = bar.scrollWidth - bar.clientWidth;
      bar.classList.toggle('more-end', more > 1 && bar.scrollLeft < more - 1);
      bar.classList.toggle('more-start', more > 1 && bar.scrollLeft > 1);
    }
  };
  document.addEventListener('scroll', (e) => { if ((e.target as Element).classList?.contains('bar')) edges(); }, { capture: true, passive: true });
  addEventListener('resize', edges);

  let queued = 0;
  const run = () => { queued = 0; decorate(); edges(); };
  new MutationObserver(() => { if (!queued) queued = requestAnimationFrame(run); })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
}
