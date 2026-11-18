import { h } from './dom';

/**
 * The shared shell for inkflo's modal dialogs: a <dialog> with a header, a content area and a
 * footer row of buttons (the structure `app.css` styles). The primitive owns showModal,
 * Escape, closing and removal; callers keep their own fields, previews and validation.
 *
 * Each dialog answers once, with the id of the button that closed it (or `cancelId` for
 * Escape, or when something else closes the <dialog>). `done` resolves as soon as the answer
 * is given; it never waits for the "close" event, which browsers may hold back while the page
 * is not on screen.
 */

export interface ModalAction<Id extends string = string> {
  id: Id;
  label: string;
  /** `.btn.primary` */
  primary?: boolean;
  /** `.btn.danger` */
  danger?: boolean;
  /** Pushes this button and the ones after it to the right edge of the footer. */
  spaceBefore?: boolean;
  /** Runs on click before the dialog closes. Return false to keep it open (validation, async work). */
  run?: () => boolean | void;
}

export interface ModalOptions<Id extends string = string> {
  title: string;
  /** Extra classes on the <dialog> (a width class, say). */
  className?: string;
  ariaLabel?: string;
  /** Sits under the title inside the header (a one-line description). */
  detail?: Node;
  /** Extra classes on the `.content` area (`stack`, say). */
  contentClass?: string;
  /** A string becomes a `<p class="note">`; nodes are appended as they are. */
  content?: string | Node | (string | Node)[];
  actions?: ModalAction<Id>[];
  /** The answer for Escape and outside closes. Default `cancel`. */
  cancelId?: Id;
  /** Focused once the dialog is open. */
  focus?: HTMLElement | null;
  /** Runs once after the dialog has closed and left the page, with the answer. */
  onClose?: (id: Id) => void;
}

export interface ModalHandle<Id extends string = string> {
  dialog: HTMLDialogElement;
  /** The `.content` area, for adding to the dialog after it opens. */
  content: HTMLElement;
  /** The footer row, or null when there are no actions. */
  footer: HTMLElement | null;
  buttons: Record<Id, HTMLButtonElement>;
  /** Answer with `id` (default `cancelId`), close and remove the dialog. Later calls do nothing. */
  close(id?: Id): void;
  readonly closed: boolean;
  done: Promise<Id>;
}

export function openModal<Id extends string = string>(options: ModalOptions<Id>): ModalHandle<Id> {
  const cancelId = (options.cancelId ?? 'cancel') as Id;
  const content = h('div', { class: options.contentClass ? `content ${options.contentClass}` : 'content' });
  const parts = options.content === undefined ? [] : Array.isArray(options.content) ? options.content : [options.content];
  for (const c of parts) content.append(typeof c === 'string' ? h('p', { class: 'note' }, c) : c);
  const dialog = h('dialog', { class: options.className, 'aria-label': options.ariaLabel }, h('header', {}, h('h2', {}, options.title), options.detail), content);

  let resolve!: (id: Id) => void;
  const done = new Promise<Id>((r) => { resolve = r; });
  let answered = false;
  const close = (id: Id = cancelId) => {
    if (answered) return;
    answered = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    resolve(id);
    options.onClose?.(id);
  };

  const buttons = {} as Record<Id, HTMLButtonElement>;
  let footer: HTMLElement | null = null;
  if (options.actions?.length) {
    footer = h('footer', {});
    for (const a of options.actions) {
      if (a.spaceBefore) footer.append(h('span', { class: 'spacer' }));
      const b = h('button', { class: `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, type: 'button' }, a.label);
      b.addEventListener('click', () => { if (a.run?.() !== false) close(a.id); });
      buttons[a.id] = b;
      footer.append(b);
    }
    dialog.append(footer);
  }

  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(cancelId); });
  dialog.addEventListener('close', () => close(cancelId));
  document.body.append(dialog);
  dialog.showModal();
  options.focus?.focus();
  return { dialog, content, footer, buttons, close, get closed() { return answered; }, done };
}
