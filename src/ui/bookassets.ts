import type { Studio } from '../app/studio';
import type { Book, BookAsset } from '../doc/model';
import { parseBookFile } from '../doc/schema';
import { exportAssets, IMAGE_ACCEPT, importAssets, prepareAsset } from '../io/bookassets';
import { download, h, slug } from './dom';

export function openBookAssets(studio: Studio, place?: (asset: BookAsset) => void): void {
  if (!studio.book) return;
  const book: Book = studio.book;
  const ensureOpen = () => { if (studio.book !== book) throw new Error('The open book changed.'); };
  const status = h('p', { class: 'note', role: 'status' });
  const grid = h('div', { class: 'asset-grid' });
  const urls = new Set<string>();
  let revision = 0;
  let busy = false;
  const imageInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, multiple: true, 'aria-label': 'Add asset images' });
  const packInput = h('input', { type: 'file', accept: '.inkassets,.zip', 'aria-label': 'Import asset pack' });
  const other = h('select', { 'aria-label': 'Copy from book' }, h('option', { value: '' }, 'Choose another book'));
  const copy = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => void task(async () => {
    const head = await studio.store.getHead(other.value);
    if (!head) throw new Error('That book is unavailable.');
    const source = parseBookFile(head.json).book;
    const bytes = new Map<string, Uint8Array>();
    for (const { key } of source.assets ?? []) {
      const data = await studio.store.getAsset(key);
      if (!data) throw new Error('A source image is unavailable.');
      bytes.set(key, data);
    }
    ensureOpen();
    const count = await studio.addAssets(source.assets ?? [], bytes);
    return count ? `Copied ${count} images from ${source.title}.` : 'No new images in that book.';
  }) }, 'Copy assets');
  other.addEventListener('change', () => { copy.disabled = !other.value || busy; });
  const pack = h('button', { class: 'btn', type: 'button', onclick: () => void task(async () => {
    const blob = await exportAssets(book.assets ?? [], (key) => studio.store.getAsset(key));
    download(blob, `${slug(book.title)}.inkassets`);
    return 'Asset pack exported.';
  }) }, 'Export asset pack');
  const dialog = h('dialog', { class: 'asset-dialog', 'aria-label': 'Book assets' },
    h('header', {}, h('h2', {}, 'Book assets'), h('p', { class: 'note' }, book.title)),
    h('div', { class: 'content' },
      h('div', { class: 'asset-actions' }, h('label', { class: 'field' }, 'Add images', imageInput), h('label', { class: 'field' }, 'Import asset pack', packInput)),
      h('div', { class: 'asset-actions' }, other, copy, pack), status, grid),
    h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Done')));
  async function task(run: () => Promise<string>): Promise<void> {
    if (busy || studio.book !== book) return;
    busy = true;
    imageInput.disabled = packInput.disabled = copy.disabled = pack.disabled = true;
    status.textContent = 'Working…';
    try { status.textContent = await run(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'The asset operation failed.'; }
    finally { busy = false; imageInput.disabled = packInput.disabled = false; copy.disabled = !other.value; if (dialog.open) render(); }
  }
  function render(): void {
    const id = ++revision;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    const assets = book.assets ?? [];
    pack.disabled = busy || !assets.length;
    grid.replaceChildren(...assets.map((asset) => {
      const img = h('img', { alt: '', loading: 'lazy' });
      void studio.store.getAsset(asset.key).then((data) => {
        if (!data || id !== revision || !dialog.open) return;
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/png' }));
        urls.add(url); img.src = url;
      }).catch(() => { if (id === revision) img.alt = 'Preview unavailable'; });
      return h('article', { class: 'asset-card' }, img, h('strong', {}, asset.name), h('small', {}, `${asset.width} × ${asset.height}`),
        h('div', { class: 'asset-actions' }, place ? h('button', { class: 'btn', type: 'button', onclick: () => { dialog.close(); place(asset); } }, 'Place') : null,
          h('button', { class: 'btn', type: 'button', 'aria-label': `Download ${asset.name}`, onclick: () => void task(async () => {
            const data = await studio.store.getAsset(asset.key);
            if (!data) throw new Error('This asset’s image is missing.');
            download(new Blob([data as BlobPart], { type: 'image/png' }), `${slug(asset.name)}.png`);
            return 'Image downloaded.';
          }) }, 'PNG'),
          h('button', { class: 'btn', type: 'button', 'aria-label': `Remove ${asset.name}`, onclick: () => { if (!busy) { studio.removeAsset(asset.key); render(); } } }, 'Remove')));
    }));
    if (!assets.length) grid.append(h('p', { class: 'note' }, 'Add images to reuse on any page in this book.'));
  }
  imageInput.addEventListener('change', () => {
    const files = [...imageInput.files ?? []]; imageInput.value = '';
    if (!files.length) return;
    void task(async () => {
      const assets = new Map<string, BookAsset>(), bytes = new Map<string, Uint8Array>();
      let skipped = 0;
      for (const file of files) {
        try { const result = await prepareAsset(file); assets.set(result.asset.key, result.asset); bytes.set(result.asset.key, result.bytes); }
        catch { skipped++; }
      }
      ensureOpen();
      const count = await studio.addAssets([...assets.values()], bytes);
      return `Added ${count} images.${skipped ? ` ${skipped} unreadable or unsupported.` : ''}`;
    });
  });
  packInput.addEventListener('change', () => {
    const file = packInput.files?.[0]; packInput.value = '';
    if (file) void task(async () => { const data = await importAssets(file); ensureOpen(); return `Imported ${await studio.addAssets(data.assets, data.bytes)} images.`; });
  });
  dialog.addEventListener('close', () => { revision++; for (const url of urls) URL.revokeObjectURL(url); dialog.remove(); });
  document.body.append(dialog); dialog.showModal(); render();
  void studio.listBooks().then((list) => other.append(...list.filter((item) => item.id !== book.id).map((item) => h('option', { value: item.id }, item.title))));
}
