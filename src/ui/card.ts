import { h } from './dom';

interface CardOptions {
  title: string;
  className?: string;
  detail?: HTMLElement;
  preview?: HTMLElement;
  sections: HTMLElement[];
  footer: (HTMLElement | null)[];
  onClose?: () => void;
  returnFocus?: () => HTMLElement | null;
}

export function card(options: CardOptions) {
  const dialog = h('dialog', { class: ['settings-card', options.className].filter(Boolean).join(' '), 'aria-label': options.title },
    h('header', {}, h('h2', {}, options.title), options.detail),
    h('div', { class: 'content' }, options.preview, options.sections),
    h('footer', {}, options.footer),
  );
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    dialog.close();
  });
  return {
    dialog,
    open() {
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.addEventListener('close', () => {
        options.onClose?.();
        dialog.remove();
        const target = trigger?.isConnected ? trigger : options.returnFocus?.();
        if (!document.querySelector('dialog[open]')) target?.focus();
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    },
  };
}
