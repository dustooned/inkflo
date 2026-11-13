import type { Book, Page, PageMark } from '../doc/model';

/**
 * Artist marks: one image per book (an asset), placed on pages by reference. The decoded images
 * live here so the one renderer can draw them synchronously; pages redraw when a mark finishes
 * loading, and exports load every mark first.
 */

export const MARK_EVENT = 'inkflo:marks';
const images = new Map<string, ImageBitmap>();
const loading = new Map<string, Promise<void>>();

export function markImage(key: string): ImageBitmap | undefined {
  return images.get(key);
}

/** Decode the mark images these keys name (once each). */
export function loadMarks(keys: Iterable<string>, getAsset: (key: string) => Promise<Uint8Array | null>): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const key of new Set(keys)) {
    if (images.has(key)) continue;
    let job = loading.get(key);
    if (!job) {
      job = (async () => {
        const bytes = await getAsset(key);
        if (!bytes) return;
        images.set(key, await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' })));
        window.dispatchEvent(new CustomEvent(MARK_EVENT));
      })().catch(() => undefined).finally(() => loading.delete(key));
      loading.set(key, job);
    }
    jobs.push(job);
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Every key a book uses for marks: its designated mark and every placement. */
export function markKeys(book: Book): string[] {
  return [...new Set([...(book.artistMark ? [book.artistMark] : []), ...book.pages.flatMap((p) => (p.marks ?? []).map((m) => m.key))])];
}

/** The mark's drawn size in inches (height from the image's own proportions). */
export function markSize(mark: PageMark): { w: number; h: number } | null {
  const img = images.get(mark.key);
  if (!img) return null;
  return { w: mark.width, h: mark.width * img.height / img.width };
}

/** Draw the page's visible marks (scale px per inch). Hidden marks are left out of everything. */
export function drawMarks(g: CanvasRenderingContext2D, page: Page, scale: number): void {
  for (const m of page.marks ?? []) {
    if (m.hidden) continue;
    const img = images.get(m.key);
    if (!img) continue;
    const w = m.width * scale, h = w * img.height / img.width;
    g.drawImage(img, m.x * scale - w / 2, m.y * scale - h / 2, w, h);
  }
}
