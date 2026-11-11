// Vendored from 2Dope src/lettering/fonts.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Bundled lettering fonts (public/fonts, licences in public/fonts/README.md) and how a caption names
 * a font. Pure data. Projects can also embed their own fonts: a caption then names `custom:<id>`.
 */

export interface BundledFont {
  id: string;
  /** What students see. */
  label: string;
  /** What it is good for, shown under the name. */
  role: string;
  /** Files by face; only Regular is guaranteed. */
  files: { regular: string; bold?: string; italic?: string; boldItalic?: string };
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { id: 'comic-neue', label: 'Comic Neue', role: 'Classic comic dialogue', files: { regular: 'ComicNeue-Regular.ttf', bold: 'ComicNeue-Bold.ttf', italic: 'ComicNeue-Italic.ttf', boldItalic: 'ComicNeue-BoldItalic.ttf' } },
  { id: 'patrick-hand', label: 'Patrick Hand', role: 'Hand-lettered dialogue', files: { regular: 'PatrickHand-Regular.ttf' } },
  { id: 'architects-daughter', label: 'Architects Daughter', role: 'Hand-lettered, webcomic', files: { regular: 'ArchitectsDaughter-Regular.ttf' } },
  { id: 'indie-flower', label: 'Indie Flower', role: 'Loose handwriting', files: { regular: 'IndieFlower-Regular.ttf' } },
  { id: 'bubblegum-sans', label: 'Bubblegum Sans', role: 'Rounded cartoon', files: { regular: 'BubblegumSans-Regular.ttf' } },
  { id: 'permanent-marker', label: 'Permanent Marker', role: 'Marker captions', files: { regular: 'PermanentMarker-Regular.ttf' } },
  { id: 'bangers', label: 'Bangers', role: 'Sound effects, shouts', files: { regular: 'Bangers-Regular.ttf' } },
  { id: 'luckiest-guy', label: 'Luckiest Guy', role: 'Bold sound effects, titles', files: { regular: 'LuckiestGuy-Regular.ttf' } },
];

/** Font files a project may embed. */
export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const;
export const MAX_FONT_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECT_FONTS = 16;

export const isCustomFont = (font: string) => font.startsWith('custom:');
export const customFontId = (font: string) => font.slice(7);
export const bundledFont = (id: string) => BUNDLED_FONTS.find(f => f.id === id);

/** The file a bundled face uses (bold or italic fall back to Regular, which the browser then synthesises). */
export function bundledFile(f: BundledFont, bold: boolean, italic: boolean): { file: string; synthetic: boolean } {
  const want = bold && italic ? f.files.boldItalic : bold ? f.files.bold : italic ? f.files.italic : f.files.regular;
  return want ? { file: want, synthetic: false } : { file: f.files.regular, synthetic: bold || italic };
}

/** A unique CSS family name for a font face, so app UI fonts never clash with lettering fonts. */
export function familyName(font: string, bold: boolean, italic: boolean): string {
  return `L2D-${font.replace(/[^a-z0-9-]/gi, '_')}-${bold ? 'b' : 'r'}${italic ? 'i' : ''}`;
}

/** Is this a font file 2Dope accepts (by name and the first bytes)? */
export function isFontFile(name: string, head: Uint8Array): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (!(FONT_EXTENSIONS as readonly string[]).includes(ext) || head.length < 4) return false;
  const tag = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
  const sfnt = head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0;
  return sfnt || tag === 'OTTO' || tag === 'true' || tag === 'wOFF' || tag === 'wOF2';
}
