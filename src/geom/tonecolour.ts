/**
 * Colours for tone that sits on a flat fill. "Match the fill" shades the fill's own hue: the dots
 * come out as a deeper, slightly richer version of the flat, so a shadow on red stays red.
 */

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * A shade of `hex`: lightness scaled by `1 - depth` (0.4 by default), a touch more saturated.
 * Greys stay grey. Returns the input when it is not a #rrggbb colour.
 */
export function shadeOf(hex: string, depth = 0.4): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = toHsl(...rgb);
  const [r, g, b] = fromHsl(h, s ? Math.min(1, s * 1.1 + 0.03) : 0, l * (1 - Math.max(0, Math.min(0.9, depth))));
  return rgbToHex(r, g, b);
}
