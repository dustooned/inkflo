import type { Book } from '../doc/model';
import { bookFileStem } from '../io/publication';
import { confirmDialog, h } from './dom';

type Details = Pick<Book, 'title' | 'author' | 'publication'>;

export function openBookDetails(book: Details, save: (details: Details) => void | Promise<void>): void {
  const input = (value = '') => h('input', { value, maxlength: 120 });
  const title = input(book.title);
  title.required = true;
  const author = input(book.author);
  const series = input(book.publication?.series);
  const volume = input(book.publication?.volume);
  const chapter = input(book.publication?.chapter);
  const fields = [title, author, series, volume, chapter];
  const read = (): Details => {
    const publication = { series: series.value.trim() || undefined, volume: volume.value.trim() || undefined, chapter: chapter.value.trim() || undefined };
    return { title: title.value.trim(), author: author.value.trim(), publication: Object.values(publication).some(Boolean) ? publication : undefined };
  };
  const label = (text: string, field: HTMLInputElement) => h('label', { class: 'field' }, text, field);
  const preview = h('output', {});
  const status = h('p', { class: 'note', role: 'status', hidden: true });
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel');
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Save details');
  const form = h('form', { method: 'dialog' },
    h('header', {}, h('h2', {}, 'Book details')),
    h('div', { class: 'content stack' }, label('Title', title), label('Author', author), label('Series', series),
      h('div', { class: 'publication-numbers' }, label('Volume', volume), label('Chapter / episode', chapter)),
      h('p', { class: 'note export-name' }, 'Export filename starts with ', preview), status),
    h('footer', {}, cancel, submit));
  const dialog = h('dialog', { 'aria-label': 'Book details' }, form);
  const refresh = () => {
    const details = read();
    submit.disabled = !details.title;
    preview.value = bookFileStem(details);
  };
  let saving = false;
  form.addEventListener('input', refresh);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const details = read();
    if (saving || !details.title) return;
    saving = true;
    for (const control of [...fields, cancel, submit]) control.disabled = true;
    status.hidden = true;
    try {
      await save(details);
      dialog.close();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.hidden = false;
    } finally {
      saving = false;
      for (const control of [...fields, cancel, submit]) control.disabled = false;
    }
  });
  dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  refresh();
  document.body.append(dialog);
  dialog.showModal();
  title.select();
}

export function confirmDeleteBook(title: string, pages: number): Promise<boolean> {
  return confirmDialog('Delete book?', `“${title}” and its ${pages} page${pages === 1 ? '' : 's'} will be deleted from this device. This is permanent. Export an .inkflo file first to keep a copy.`, 'Delete book');
}
