import type { LayerType, Letter, PlacedImage, Pt, Stroke } from '../doc/model';

/**
 * One clipboard for the whole app: pixels, placed images, vector lines and lettering copy
 * between layers, pages and books, and across tabs and projects through the system clipboard.
 * Other apps receive a PNG; pasting an image from another app places it as an image layer, and
 * pasting text in Caption makes a balloon.
 *
 * Positions are page inches (`centre`), so a paste can land under the pointer on any page.
 */

export type ClipPayload =
  | { kind: 'pixels'; name: string; canvas: HTMLCanvasElement; widthIn: number; heightIn: number; centre: Pt }
  | { kind: 'image'; name: string; canvas: HTMLCanvasElement; image: PlacedImage; centre: Pt }
  | { kind: 'strokes'; type: LayerType; strokes: Stroke[]; centre: Pt }
  | { kind: 'balloons'; letters: Letter[]; centre: Pt }
  | { kind: 'text'; text: string };

const MARK = 'inkflo-clipboard:v1:';
let memory: ClipPayload | null = null;

export function lastCopied(): ClipPayload | null {
  return memory;
}

/** What goes on the system clipboard: an inkflo marker (JSON) and, for pictures, a PNG. */
async function serialize(p: ClipPayload): Promise<{ text: string; png: Blob | null }> {
  if (p.kind === 'pixels' || p.kind === 'image') {
    const png = await new Promise<Blob | null>((resolve) => p.canvas.toBlob(resolve, 'image/png'));
    const dataUrl = p.canvas.width * p.canvas.height <= 4_000_000 ? p.canvas.toDataURL('image/png') : null;
    const { canvas: _canvas, ...rest } = p;
    return { text: MARK + JSON.stringify({ ...rest, dataUrl }), png };
  }
  return { text: MARK + JSON.stringify(p), png: null };
}

/** Keep the copy in memory and offer it to the system clipboard (best effort). */
export async function copyToClipboard(p: ClipPayload): Promise<'system' | 'app'> {
  memory = p;
  try {
    const { text, png } = await serialize(p);
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const items: Record<string, Blob> = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
      if (png) items['image/png'] = png;
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return 'system';
    }
    await navigator.clipboard?.writeText?.(text);
    return 'system';
  } catch {
    return 'app';
  }
}

async function imageCanvas(source: Blob | string): Promise<HTMLCanvasElement> {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Turn clipboard contents into a payload: inkflo data first, then an image, then text. */
export async function readClipboard(text: string | null, files: readonly File[]): Promise<ClipPayload | null> {
  if (text?.startsWith(MARK)) {
    try {
      const data = JSON.parse(text.slice(MARK.length)) as ClipPayload & { dataUrl?: string | null };
      if (data.kind === 'pixels' || data.kind === 'image') {
        // the same tab can reuse its canvas; another tab rebuilds it from the data URL
        if (memory && memory.kind === data.kind && JSON.stringify(memory.centre) === JSON.stringify(data.centre)) return memory;
        if (!data.dataUrl) return memory;
        const { dataUrl, ...rest } = data;
        return { ...rest, canvas: await imageCanvas(dataUrl) } as ClipPayload;
      }
      return data;
    } catch {
      return memory;
    }
  }
  const image = files.find((f) => f.type.startsWith('image/'));
  if (image) {
    const canvas = await imageCanvas(image);
    // an outside picture arrives at 150 dpi, a sensible collage size
    return { kind: 'pixels', name: image.name.replace(/\.[^.]+$/, '') || 'Pasted image', canvas, widthIn: canvas.width / 150, heightIn: canvas.height / 150, centre: { x: 0, y: 0 } };
  }
  if (text && text.trim()) return { kind: 'text', text: text.trim().slice(0, 2000) };
  return memory;
}

/** Read the system clipboard on demand (the Paste menu item); falls back to the app's copy. */
export async function pasteFromSystem(): Promise<ClipPayload | null> {
  try {
    if (navigator.clipboard && 'read' in navigator.clipboard) {
      const items = await navigator.clipboard.read();
      let text: string | null = null;
      const files: File[] = [];
      for (const item of items) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === 'text/plain') text = await blob.text();
          else if (type.startsWith('image/')) files.push(new File([blob], 'Pasted image', { type }));
        }
      }
      return await readClipboard(text, files);
    }
  } catch {
    // permission refused or unsupported: use the app's own copy
  }
  return memory;
}

/** Copies of letters with fresh ids, moved by `delta` points, unlinked from the script. */
export function relabelLetters(letters: readonly Letter[], delta: Pt, newId: () => string): Letter[] {
  const ids = new Map(letters.map((l) => [l.id, newId()]));
  return letters.map((l) => {
    const copy: Letter = structuredClone(l);
    copy.id = ids.get(l.id)!;
    delete copy.src;
    delete copy.generated;
    delete copy.keptScriptLine;
    if (copy.continuation) {
      const after = ids.get(copy.continuation.after);
      if (after) copy.continuation = { ...copy.continuation, after };
      else delete copy.continuation;
    }
    copy.cap = { ...copy.cap, x: copy.cap.x + delta.x, y: copy.cap.y + delta.y, tails: copy.cap.tails.map((t) => ({ ...t, x: t.x + delta.x, y: t.y + delta.y })) };
    return copy;
  });
}

/** Strokes moved by `delta` inches. */
export function moveStrokes(strokes: readonly Stroke[], delta: Pt): Stroke[] {
  return strokes.map((s) => ({ ...s, pts: s.pts.map((p) => ({ ...p, x: p.x + delta.x, y: p.y + delta.y })) }));
}
