import { allLayers, pagePixels, type Book } from '../doc/model';
import type { BookFile } from '../doc/schema';
import { newPageArt, storedPageArt, type PageArt } from '../draw/residency';

export interface Loaded {
  book: Book;
  /** One entry per page. Pages with stored layers start parked; nothing is decoded here. */
  art: Map<string, PageArt>;
}

/**
 * Build the live book from a validated file. Every stored layer starts parked, pointing at its
 * asset, and comes back through the residency manager when the page is first shown. The assets
 * must be readable through the residency manager's source.
 */
export function loadBookFile(file: BookFile): Loaded {
  const book = structuredClone(file.book);
  const art = new Map<string, PageArt>();
  book.pages.forEach((page, i) => {
    const { width, height } = pagePixels(page, book.dpi);
    const label = `Page ${i + 1}`;
    const keys = file.art[page.id];
    const bitmap = keys && Object.keys(keys).length ? storedPageArt(page.id, label, width, height, keys) : newPageArt(page.id, label, width, height);
    for (const l of allLayers(page)) if (l.image) bitmap.planeSizes[l.id] = { width: l.image.pixelWidth, height: l.image.pixelHeight };
    art.set(page.id, bitmap);
  });
  return { book, art };
}
