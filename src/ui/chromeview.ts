import { overflowActions, type ChromeAction } from './chrome';
import { h } from './dom';
import { popover, popoverIsOpen } from './popover';
import { prefs } from './prefs';

export function chromeActions(actions: ChromeAction[], extra: () => HTMLElement[]) {
  const { shown, overflow } = overflowActions(actions, 4);
  const buttons = shown.map((action, index) => h('button', {
    class: 'icon', 'data-action-index': index, type: 'button', 'aria-label': action.label, title: action.label,
    onclick: (e) => action.run(e.currentTarget as HTMLElement),
  }, action.glyph ?? action.label));
  const more = h('button', { class: 'icon', type: 'button', 'aria-label': 'More document actions', 'aria-haspopup': 'dialog' }, '⋯');
  more.onclick = () => {
    const hidden = shown.filter((_, index) => buttons[index]!.offsetWidth === 0);
    const list = [...hidden, ...overflow].map((action) => h('button', {
      class: 'item', type: 'button', disabled: action.disabled?.(), 'aria-pressed': action.pressed ? String(action.pressed()) : null,
      onclick: () => { close(); more.focus(); action.run(more); },
    }, action.label));
    const close = popover(more, h('div', { class: 'chrome-menu' }, list, extra()), 'below', 'Document actions');
  };
  const el = h('div', { class: 'chrome-actions', role: 'group', 'aria-label': 'Document actions' }, buttons, more);
  return Object.assign(el, {
    refresh() {
      shown.forEach((action, i) => {
        const button = buttons[i]!;
        button.disabled = action.disabled?.() ?? false;
        if (action.pressed) button.setAttribute('aria-pressed', String(action.pressed()));
      });
    },
  });
}

export function autoHideChrome(screen: HTMLElement, surfaces: HTMLElement[]) {
  let timer = 0;
  const pointers = new Set<number>();
  function visible(show: boolean): void {
    screen.classList.toggle('chrome-hidden', !show);
    for (const el of surfaces) el.inert = !show;
  }
  function schedule(): void {
    clearTimeout(timer);
    if (prefs().layout !== 'focus' || !prefs().autoHide) return;
    timer = window.setTimeout(() => {
      const focused = document.activeElement;
      if (pointers.size || document.querySelector('dialog[open]') || popoverIsOpen()
        || surfaces.some((el) => el.contains(focused) && focused?.matches(':focus-visible'))) {
        schedule();
        return;
      }
      if (focused instanceof HTMLElement && surfaces.some((el) => el.contains(focused))) focused.blur();
      visible(false);
    }, prefs().autoHideDelay);
  }
  function wake(): void {
    visible(true);
    schedule();
  }
  const down = (e: PointerEvent) => { pointers.add(e.pointerId); wake(); };
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); schedule(); };
  const blur = () => { pointers.clear(); schedule(); };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('wheel', wake, { capture: true, passive: true });
  window.addEventListener('keydown', wake, true);
  window.addEventListener('blur', blur);
  return {
    wake,
    dispose() {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('wheel', wake, true);
      window.removeEventListener('keydown', wake, true);
      window.removeEventListener('blur', blur);
    },
  };
}
