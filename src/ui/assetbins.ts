import type { Studio } from '../app/studio';
import type { BookAsset, Pt } from '../doc/model';
import { withBin } from '../geom/bins';
import { IMAGE_ACCEPT, prepareAsset } from '../io/bookassets';
import { loadMarks } from '../render/marks';
import { binPanel } from './binpanel';
import { openBookAssets } from './bookassets';
import { h } from './dom';
import { askToReduce } from './reducechoice';

/** Image bins (Draw): the book's images, placed by a tap or dragged onto the page. */
export interface BinsHost {
  studio: Studio;
  place(asset: BookAsset, at: Pt | null, reference?: boolean): Promise<boolean>;
  stage: HTMLElement;
  toPage(e: { clientX: number; clientY: number }): Pt;
}

export function assetBins(host: BinsHost) {
  const { studio } = host;
  const book = () => studio.book!;
  const urls = new Map<string, string>();
  const fileInput = h('input', { type: 'file', accept: IMAGE_ACCEPT, multiple: true, hidden: true, 'aria-label': 'Add images to this bin' });

  async function addFiles(files: File[], bin: string, at?: Pt): Promise<string> {
    const images = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    if (!images.length) return 'Drop PNG, JPEG or WebP images.';
    const assets: BookAsset[] = [], bytes = new Map<string, Uint8Array>();
    let skipped = 0;
    for (const f of images) {
      try { const r = await prepareAsset(f, askToReduce); assets.push(withBin(r.asset, bin)); bytes.set(r.asset.key, r.bytes); }
      catch { skipped++; }
    }
    const added = await studio.addAssets(assets, bytes);
    // dropped on the page: place what was dropped, a little apart
    if (at) for (const [i, a] of assets.entries()) {
      const stored = book().assets?.find((x) => x.key === a.key);
      if (stored) await host.place(stored, { x: at.x + i * 0.3, y: at.y + i * 0.3 });
    }
    return `Added ${added} to ${bin}.${skipped ? ` ${skipped} couldn’t be read.` : ''}${added < assets.length ? ' Some were already in this book.' : ''}`;
  }

  const panel = binPanel<BookAsset>({
    id: 'images', title: 'Image bins', noun: 'image',
    read: () => ({ bins: book().bins, items: book().assets ?? [] }),
    write(label, next) {
      const b = book();
      const before = { bins: b.bins, assets: b.assets };
      const after = { bins: next.bins, assets: next.items };
      const apply = (s: { bins?: string[]; assets?: BookAsset[] }) => { if (s.bins?.length) b.bins = s.bins; else delete b.bins; b.assets = s.assets; };
      studio.run({ label, do: () => apply(after), undo: () => apply(before) });
    },
    thumb(asset) {
      const img = h('img', { alt: '', draggable: false });
      const url = urls.get(asset.key);
      if (url) img.src = url;
      else void studio.store.getAsset(asset.key).then((data) => {
        if (!data) return;
        const u = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/png' }));
        urls.set(asset.key, u);
        img.src = u;
      });
      return img;
    },
    place: (asset, at) => host.place(asset, at),
    tip: 'Tap to place · drag onto the page or a bin',
    empty: 'Drop images here, or tap + Add. Then drag them onto the page.',
    menu: (asset) => [
      { label: 'Place in the middle', run: () => void host.place(asset, null) },
      { label: 'Place as reference', run: () => void host.place(asset, null, true) },
      { label: book().artistMark === asset.key ? 'Artist mark ✓' : 'Use as Artist mark', run: () => {
        const b = book(), before = b.artistMark;
        if (before === asset.key) return;
        studio.run({ label: 'Set Artist mark', do: () => { b.artistMark = asset.key; }, undo: () => { if (before) b.artistMark = before; else delete b.artistMark; } });
        void loadMarks([asset.key], (k) => studio.store.getAsset(k));
        panel.refresh(true);
      } },
    ],
    head: () => [
      h('button', { class: 'btn', type: 'button', title: 'Add images to this bin', onclick: () => fileInput.click() }, '+ Add'),
      h('button', { class: 'btn', type: 'button', title: 'Asset packs, copying from other books, downloads', onclick: () => openBookAssets(studio) }, 'Manage'),
      fileInput,
    ],
    files: addFiles,
    remove: (asset) => studio.removeAsset(asset.key),
    extra: () => book().artistMark ?? '',
  }, host.stage, host.toPage);
  fileInput.addEventListener('change', () => { const files = [...fileInput.files ?? []]; fileInput.value = ''; if (files.length) void panel.takeFiles(files); });

  return {
    el: panel.el,
    refresh: () => panel.refresh(),
    dispose(): void {
      panel.dispose();
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
