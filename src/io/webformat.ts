/**
 * Choices for web comics: image format, quality, strip width and slice height, plus a few
 * ready-made setups. Pure, so the dialog and the exporters share one set of limits.
 */

export type WebFormat = 'png' | 'jpeg' | 'webp';

export interface FormatInfo {
  id: WebFormat;
  label: string;
  short: string;
  ext: string;
  mime: string;
  /** Lossy formats take a quality; PNG does not. */
  lossy: boolean;
  /** Can the image keep transparent areas? JPG cannot. */
  alpha: boolean;
}

export const WEB_FORMATS: FormatInfo[] = [
  { id: 'png', label: 'PNG: sharpest, biggest files', short: 'PNG', ext: 'png', mime: 'image/png', lossy: false, alpha: true },
  { id: 'webp', label: 'WebP: small files, modern browsers', short: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true },
  { id: 'jpeg', label: 'JPG: small files, opens everywhere', short: 'JPG', ext: 'jpg', mime: 'image/jpeg', lossy: true, alpha: false },
];

export const formatInfo = (id: WebFormat): FormatInfo => WEB_FORMATS.find((f) => f.id === id) ?? WEB_FORMATS[0]!;

export const DEFAULT_QUALITY = 0.85;
export const clampQuality = (q: number): number => (Number.isFinite(q) ? Math.round(Math.max(0.3, Math.min(1, q)) * 100) / 100 : DEFAULT_QUALITY);

/** Limits for a vertical-scroll strip, in pixels. */
export const SCROLL_WIDTH_RANGE = { min: 320, max: 2400 } as const;
export const SCROLL_SLICE_RANGE = { min: 400, max: 4000 } as const;
export const clampWidth = (v: number): number => Math.round(Math.max(SCROLL_WIDTH_RANGE.min, Math.min(SCROLL_WIDTH_RANGE.max, Number.isFinite(v) ? v : 800)));
export const clampSlice = (v: number): number => Math.round(Math.max(SCROLL_SLICE_RANGE.min, Math.min(SCROLL_SLICE_RANGE.max, Number.isFinite(v) ? v : 1280)));

export interface ScrollSetup {
  id: string;
  label: string;
  note: string;
  width: number;
  sliceHeight: number;
  format: WebFormat;
  quality: number;
}

/** Starting points. Sites differ: always check the upload page of where you publish. */
export const SCROLL_SETUPS: ScrollSetup[] = [
  { id: 'standard', label: 'Standard web column', note: '800 px wide PNG strips. Works almost everywhere.', width: 800, sliceHeight: 1280, format: 'png', quality: DEFAULT_QUALITY },
  { id: 'phone', label: 'Sharp on phones', note: '1080 px wide WebP strips. Crisp on modern screens, much smaller than PNG.', width: 1080, sliceHeight: 1600, format: 'webp', quality: 0.9 },
  { id: 'small', label: 'Small and fast', note: '720 px wide JPG strips. The smallest files, for slow connections or upload limits.', width: 720, sliceHeight: 1280, format: 'jpeg', quality: 0.8 },
];

export function setupMatching(o: { width: number; sliceHeight: number; format: WebFormat; quality: number }): ScrollSetup | null {
  return SCROLL_SETUPS.find((s) => s.width === o.width && s.sliceHeight === o.sliceHeight && s.format === o.format && (!formatInfo(o.format).lossy || Math.abs(s.quality - o.quality) < 0.005)) ?? null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** How many strips a tall episode is cut into. */
export const stripCount = (totalRows: number, sliceHeight: number): number => Math.max(1, Math.ceil(totalRows / sliceHeight));

/**
 * Rows of empty margin at the top and bottom of a rendered image: leading rows that are all one
 * colour (the colour of the top-left pixel), and trailing rows that are all the colour of the
 * bottom-left pixel. A fully empty image trims nothing. `keep` rows of margin are left in place.
 */
export function blankEdgeRows(data: ArrayLike<number>, width: number, height: number, keep = 0, tolerance = 3): { top: number; bottom: number } {
  if (width < 1 || height < 2) return { top: 0, bottom: 0 };
  const same = (y: number, ref: number) => {
    const r = data[ref]!, g = data[ref + 1]!, b = data[ref + 2]!, a = data[ref + 3]!;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (Math.abs(data[i + 3]! - a) > tolerance) return false;
      // fully transparent pixels all look alike whatever their hidden colour
      if (a > tolerance && (Math.abs(data[i]! - r) > tolerance || Math.abs(data[i + 1]! - g) > tolerance || Math.abs(data[i + 2]! - b) > tolerance)) return false;
    }
    return true;
  };
  let top = 0;
  while (top < height && same(top, 0)) top++;
  if (top === height) return { top: 0, bottom: 0 };
  let bottom = 0;
  const last = (height - 1) * width * 4;
  while (bottom < height - top && same(height - 1 - bottom, last)) bottom++;
  return { top: Math.max(0, top - keep), bottom: Math.max(0, bottom - keep) };
}
