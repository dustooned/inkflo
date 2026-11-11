// Adapted from 2Dope src/view/captionfonts.ts @ 707f793: bundled lettering fonts load on first
// use as FontFaces under unique family names; until then a fallback is used and the page redraws
// when the face arrives. inkflo has no imported fonts yet, so no project font store.

import { BUNDLED_FONTS, bundledFile, bundledFont, familyName } from '../engine/lettering/fonts';

const FALLBACK = '"Comic Sans MS", "Chalkboard SE", system-ui, sans-serif';

type FaceState = { state: 'loading' | 'ready' | 'failed'; job: Promise<void> };
const faces = new Map<string, FaceState>();

/** Fired on window when a lettering face finished loading (views redraw). */
export const FONT_EVENT = 'inkflo:fonts';

function load(font: string, bold: boolean, italic: boolean): Promise<void> {
  const family = familyName(font, bold, italic);
  const have = faces.get(family);
  if (have) return have.job;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
  const f = bundledFont(font) ?? bundledFont('comic-neue')!;
  const { file, synthetic } = bundledFile(f, bold, italic);
  const url = `${import.meta.env.BASE_URL}fonts/${file}`;
  const entry: FaceState = { state: 'loading', job: Promise.resolve() };
  entry.job = (async () => {
    try {
      // a missing bold/italic face loads the regular file; the browser synthesises the style
      const face = new FontFace(family, `url(${url})`, synthetic ? {} : { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
      await face.load();
      document.fonts.add(face);
      entry.state = 'ready';
    } catch {
      entry.state = 'failed';
    }
    window.dispatchEvent(new CustomEvent(FONT_EVENT));
  })();
  faces.set(family, entry);
  return entry.job;
}

/** The CSS font for lettering at a pixel size: its own face when loaded, a fallback meanwhile. */
export function letterFont(c: { font: string; bold: boolean; italic: boolean }, px: number): string {
  const family = familyName(c.font, c.bold, c.italic);
  const have = faces.get(family);
  if (!have) void load(c.font, c.bold, c.italic);
  const face = have?.state === 'ready' ? `"${family}", ${FALLBACK}` : FALLBACK;
  return `${c.italic ? 'italic ' : ''}${c.bold ? '700 ' : '400 '}${px.toFixed(2)}px ${face}`;
}

export function letterFontReady(c: { font: string; bold: boolean; italic: boolean }): boolean {
  return faces.get(familyName(c.font, c.bold, c.italic))?.state === 'ready';
}

/** Wait until every face these captions use has loaded (exports and print call this first). */
export async function lettersReady(caps: Iterable<{ font: string; bold: boolean; italic: boolean; text: string }>): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const c of caps) {
    jobs.push(load(c.font, c.bold, c.italic));
    if (c.text.includes('*')) jobs.push(load(c.font, true, c.italic));
    if (c.text.includes('_')) jobs.push(load(c.font, c.bold, true));
  }
  await Promise.all(jobs);
}

export { BUNDLED_FONTS };
