import type { Book, Page, Publication } from '../doc/model';

export function publicationLabel(publication?: Publication): string {
  if (!publication) return '';
  return [publication.series, publication.volume && `Vol. ${publication.volume}`, publication.chapter && `Ch. ${publication.chapter}`].filter(Boolean).join(' · ');
}

function filenamePart(text: string, limit: number): string {
  const cleaned = text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const encoder = new TextEncoder();
  let result = '';
  for (const char of cleaned) {
    limit -= encoder.encode(char).length;
    if (limit < 0) break;
    result += char;
  }
  return result.replace(/-$/, '');
}

/** A portable stem shared by print, web, game and editable book exports. */
export function bookFileStem(book: Pick<Book, 'title' | 'publication'>): string {
  const title = filenamePart(book.title, 54);
  const series = filenamePart(book.publication?.series ?? '', 40);
  const volume = filenamePart(book.publication?.volume ?? '', 15);
  const chapter = filenamePart(book.publication?.chapter ?? '', 20);
  const stem = [series, volume && `vol-${volume}`, chapter && `ch-${chapter}`, title !== series && title].filter(Boolean).join('-') || 'book';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `book-${stem}` : stem;
}

export function pageFileStem(page: Pick<Page, 'title'>, number: number, bookStem = ''): string {
  return [bookStem, `page-${String(number).padStart(3, '0')}`, filenamePart(page.title ?? '', 30)].filter(Boolean).join('-');
}
