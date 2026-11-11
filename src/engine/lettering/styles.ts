// Vendored from 2Dope src/lettering/styles.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Caption styles: a caption's look without its words or place, saved to reuse and to share as a
 * file. Portable (no app imports). A style can carry an imported font's bytes so it opens the same
 * on another device; the app decides where fonts are kept.
 */
import { readCaption, readLook, type CaptionSpec, type CaptionTail, type TailJoin } from './spec';

export const STYLE_FORMAT = '2dope-caption-style';
export const STYLE_VERSION = 1;
/** A style file's limit (an embedded font can be up to 4 MB, as base64). */
export const MAX_STYLE_BYTES = 6 * 1024 * 1024;
export const MAX_SAVED_STYLES = 40;

/** What a style changes on a caption (everything about its look). */
const LOOK_FIELDS = ['font', 'bold', 'italic', 'caps', 'size', 'scale', 'align', 'style', 'shape', 'look', 'fill', 'ink', 'inkWidth', 'textColor', 'textOutline', 'textOutlineWidth', 'underFill'] as const;
type LookFields = Pick<CaptionSpec, (typeof LOOK_FIELDS)[number]>;

export interface CaptionStyleTail extends Omit<CaptionTail, 'x' | 'y' | 'bend'> { join: TailJoin }

export interface CaptionStyle {
  format: typeof STYLE_FORMAT;
  v: typeof STYLE_VERSION;
  id: string;
  name: string;
  look: LookFields;
  /** Spacing (the still values of tracking and line spacing). */
  tracking?: number;
  leading?: number;
  /** The first tail's style and settings (where tails point stays with each caption). */
  tail?: CaptionStyleTail;
  /** An imported font this style uses, so the file brings it along. */
  font?: { name: string; ext: string; data: string };
}

/** A style from a caption. */
export function captureStyle(c: CaptionSpec, id: string, name: string): CaptionStyle {
  const look = {} as Record<string, unknown>;
  for (const k of LOOK_FIELDS) if (c[k] !== undefined) look[k] = structuredClone(c[k]);
  const t = c.tails[0];
  const { x: _x, y: _y, bend: _b, ...tail } = t ?? ({} as CaptionTail);
  return {
    format: STYLE_FORMAT, v: STYLE_VERSION, id, name: styleName(name), look: look as LookFields,
    ...(c.values?.tracking !== undefined ? { tracking: c.values.tracking } : {}),
    ...(c.values?.leading !== undefined ? { leading: c.values.leading } : {}),
    ...(t ? { tail: tail as CaptionStyleTail } : {}),
  };
}

/** A caption with a style's look (its words, place, animation and tail tips are kept). */
export function applyStyle(c: CaptionSpec, s: CaptionStyle): CaptionSpec {
  const next: CaptionSpec = { ...c, ...structuredClone(s.look) };
  for (const k of LOOK_FIELDS) if (s.look[k] === undefined) delete (next as unknown as Record<string, unknown>)[k];
  const values = { ...c.values };
  if (s.tracking !== undefined) values.tracking = s.tracking; else delete values.tracking;
  if (s.leading !== undefined) values.leading = s.leading; else delete values.leading;
  if (Object.keys(values).length) next.values = values; else delete next.values;
  if (next.style === 'sfx') next.tails = [];
  else if (s.tail) {
    const keep = (t: CaptionTail) => ({ x: t.x, y: t.y, ...(t.bend ? { bend: t.bend } : {}) });
    next.tails = c.tails.map(t => ({ ...structuredClone(s.tail!), ...keep(t) }));
  }
  // a custom ("as drawn") style needs its outline: without one the balloon goes back to speech
  if (next.style === 'custom' && !next.look?.outline) next.style = 'speech';
  return readCaption(next);
}

export function styleName(v: unknown): string {
  const n = typeof v === 'string' ? v.trim().slice(0, 40) : '';
  return n || 'My style';
}

/** A style read back safely (from storage or a file). Throws on anything that is not one. */
export function readStyle(input: unknown): CaptionStyle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('This is not a caption style.');
  const r = input as Record<string, unknown>;
  if (r.format !== STYLE_FORMAT) throw new Error('This is not a 2Dope caption style.');
  if (r.v !== STYLE_VERSION) throw new Error('This caption style was made by a newer 2Dope.');
  const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : 'style';
  // the look goes through the caption reader, so every value is checked and clamped
  const look = r.look && typeof r.look === 'object' ? (r.look as Record<string, unknown>) : {};
  const probe = readCaption({ v: 1, text: '', x: 0, y: 0, tails: [], ...look, look: readLook(look.look) ?? undefined });
  const out = {} as Record<string, unknown>;
  for (const k of LOOK_FIELDS) if (k in look && probe[k] !== undefined) out[k] = probe[k];
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  let tail: CaptionStyleTail | undefined;
  if (r.tail && typeof r.tail === 'object') {
    const t = readCaption({ v: 1, text: '', x: 0, y: 0, tails: [{ x: 1e5, y: 1e5, ...(r.tail as object) }] }).tails[0];
    if (t) { const { x: _x, y: _y, bend: _b, ...rest } = t; tail = rest; }
  }
  let font: CaptionStyle['font'];
  if (r.font && typeof r.font === 'object') {
    const f = r.font as Record<string, unknown>;
    if (typeof f.name === 'string' && typeof f.ext === 'string' && /^(ttf|otf|woff2?)$/.test(f.ext) && typeof f.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(f.data) && f.data.length < MAX_STYLE_BYTES)
      font = { name: f.name.slice(0, 60), ext: f.ext, data: f.data };
  }
  const tracking = num(r.tracking, -100, 300), leading = num(r.leading, 80, 200);
  return {
    format: STYLE_FORMAT, v: STYLE_VERSION, id, name: styleName(r.name), look: out as LookFields,
    ...(tracking !== undefined ? { tracking } : {}), ...(leading !== undefined ? { leading } : {}),
    ...(tail ? { tail } : {}), ...(font ? { font } : {}),
  };
}

/** Ready-made styles to start from. */
export const BUILTIN_STYLES: CaptionStyle[] = [
  { format: STYLE_FORMAT, v: STYLE_VERSION, id: 'b-classic', name: 'Classic', look: { font: 'comic-neue', bold: false, italic: false, caps: true, size: 'body', align: 'center', style: 'speech', fill: '#ffffff', ink: '#111111', inkWidth: 0.09, textColor: '#111111', textOutline: null, textOutlineWidth: 0.18 }, tail: { join: 'merged', width: 1.2 } },
  { format: STYLE_FORMAT, v: STYLE_VERSION, id: 'b-shout', name: 'Big shout', look: { font: 'bangers', bold: false, italic: false, caps: true, size: 'big', align: 'center', style: 'shout', look: { spikes: 14, spikeDepth: 0.35 }, fill: '#fff36b', ink: '#111111', inkWidth: 0.08, textColor: '#d6202b', textOutline: null, textOutlineWidth: 0.18 }, tail: { join: 'merged', width: 1.4 } },
  { format: STYLE_FORMAT, v: STYLE_VERSION, id: 'b-narration', name: 'Narration', look: { font: 'patrick-hand', bold: false, italic: false, caps: true, size: 'body', align: 'left', style: 'box', fill: '#fbe9b5', ink: '#3a2a10', inkWidth: 0.07, textColor: '#2a1d08', textOutline: null, textOutlineWidth: 0.18 } },
  { format: STYLE_FORMAT, v: STYLE_VERSION, id: 'b-thought', name: 'Dreamy thought', look: { font: 'indie-flower', bold: false, italic: false, caps: false, size: 'body', align: 'center', style: 'thought', look: { bumps: 11, bumpDepth: 0.2 }, fill: '#eef5ff', ink: '#5470a8', inkWidth: 0.07, textColor: '#2b3d66', textOutline: null, textOutlineWidth: 0.18 }, tail: { join: 'bubbles', width: 1.2, count: 4, shrink: 0.75 } },
  { format: STYLE_FORMAT, v: STYLE_VERSION, id: 'b-radio', name: 'Radio', look: { font: 'comic-neue', bold: false, italic: true, caps: true, size: 'body', align: 'center', style: 'speech', look: { round: 3.4, wobble: 0 }, fill: '#ffffff', ink: '#111111', inkWidth: 0.09, textColor: '#111111', textOutline: null, textOutlineWidth: 0.18 }, tail: { join: 'lightning', width: 1.2, zigs: 4, amp: 1.3 } },
  { format: STYLE_FORMAT, v: STYLE_VERSION, id: 'b-sfx', name: 'Sound effect', look: { font: 'luckiest-guy', bold: false, italic: false, caps: true, size: 'big', align: 'center', style: 'sfx', fill: '#ffffff', ink: '#111111', inkWidth: 0.09, textColor: '#ffb21e', textOutline: '#111111', textOutlineWidth: 0.22 } },
];

