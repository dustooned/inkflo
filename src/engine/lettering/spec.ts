// Vendored from 2Dope src/lettering/spec.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * The caption model (LetterSpec): a balloon and its lettering, stored on a drawings layer and
 * rendered live (never baked). Pure data and validation, no DOM and no app imports, so the same
 * code can move into a comics app. Positions and sizes are page units (document pixels).
 */

export type BalloonStyle = 'speech' | 'thought' | 'shout' | 'whisper' | 'box' | 'sfx' | 'custom';
export const BALLOON_STYLES: readonly BalloonStyle[] = ['speech', 'thought', 'shout', 'whisper', 'box', 'sfx', 'custom'];
export type TailJoin = 'merged' | 'seam' | 'bubbles' | 'lightning' | 'none';
export const TAIL_JOINS: readonly TailJoin[] = ['merged', 'seam', 'bubbles', 'lightning', 'none'];
export type LetterSize = 'small' | 'body' | 'big';
export const LETTER_SIZES: readonly LetterSize[] = ['small', 'body', 'big'];
/** Lettering sizes as a fraction of the page height: the same for every caption, so lettering stays consistent. */
export const LETTER_SIZE_FRACTION: Record<LetterSize, number> = { small: 0.026, body: 0.034, big: 0.06 };
export type LetterAlign = 'center' | 'left' | 'right';

export interface CaptionTail {
  /** The tip, page units. */
  x: number;
  y: number;
  /** Where the tail bends (page units); absent = straight. */
  bend?: [number, number];
  join: TailJoin;
  /** Base width as a multiple of the lettering size. */
  width: number;
  /** Joined and Seam: how the width narrows to the tip (1 = straight; below 1 thins fast, above stays fat). */
  taper?: number;
  /** Joined and Seam: the tip's width as a share of the base (0 = a sharp point). */
  tip?: number;
  /** Bubbles: how many, their size and how much smaller each one gets. */
  count?: number;
  size?: number;
  shrink?: number;
  /** Lightning: how many zigs and how wide they swing. */
  zigs?: number;
  amp?: number;
  /** Lightning: a thick, filled bolt instead of a line; and how thick the line or bolt is. */
  bolt?: boolean;
  line?: number;
  /**
   * The tip follows another layer: `at` is a point in that layer's own page units, so the tip stays
   * on the same spot of the character as it moves, turns and scales. x and y are kept as the tip's
   * place when that layer is gone.
   */
  follow?: { layer: string; at: [number, number] };
}

/** The ranges of each tail style's own settings (and what absent means). */
export const TAIL_LIMITS = { taper: [0.3, 3, 1], tip: [0, 0.6, 0], count: [1, 8, 3], size: [0.3, 3, 1], shrink: [0, 0.9, 0.67], zigs: [1, 10, 3], amp: [0.2, 3, 1], line: [0.3, 4, 1] } as const;

/**
 * How a balloon is drawn, beyond its style. All optional; absent = the style's classic look.
 * - round: superellipse power (2 = oval; ~2.7 = the classic comic balloon, flatter top and bottom;
 *   5+ = a soft rounded box).
 * - wobble: 0–1, a hand-inked irregularity (only ever outward, so it never crowds the words).
 * - spikes / spikeDepth: a shout's points and how far they reach (share of the balloon).
 * - bumps / bumpDepth: a thought cloud's scallops.
 * - outline: a custom shape (an imported SVG or a drawn balloon), normalised to -1…1, that is
 *   stretched to fit the words like any other style.
 */
export interface BalloonLook {
  round?: number;
  wobble?: number;
  spikes?: number;
  spikeDepth?: number;
  bumps?: number;
  bumpDepth?: number;
  outline?: [number, number][];
}
export const LOOK_LIMITS = { round: [2, 8], wobble: [0, 1], spikes: [4, 40], spikeDepth: [0.05, 1], bumps: [4, 30], bumpDepth: [0.04, 0.5] } as const;
export const MAX_OUTLINE_POINTS = 400;

/** Keyable caption settings: Motion shows them as Caption rows. */
export type CaptionKey = 'reveal' | 'balloon' | 'textOpacity' | 'balloonOpacity' | 'inkStart' | 'inkEnd' | 'tracking' | 'leading' | 'shake' | 'wave' | 'jitter' | 'writeOn';
export const CAPTION_KEYS: { key: CaptionKey; label: string; min: number; max: number; def: number; unit: string }[] = [
  { key: 'reveal', label: 'Reveal', min: 0, max: 100, def: 100, unit: '%' },
  { key: 'balloon', label: 'Balloon', min: 0, max: 150, def: 100, unit: '%' },
  { key: 'textOpacity', label: 'Text opacity', min: 0, max: 100, def: 100, unit: '%' },
  { key: 'balloonOpacity', label: 'Balloon opacity', min: 0, max: 100, def: 100, unit: '%' },
  { key: 'inkStart', label: 'Ink start', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'inkEnd', label: 'Ink length', min: 0, max: 100, def: 100, unit: '%' },
  { key: 'tracking', label: 'Tracking', min: -100, max: 300, def: 0, unit: '' },
  { key: 'leading', label: 'Line spacing', min: 80, max: 200, def: 115, unit: '%' },
  { key: 'shake', label: 'Shake', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'wave', label: 'Wave', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'jitter', label: 'Jitter', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'writeOn', label: 'Write on', min: 0, max: 100, def: 100, unit: '%' },
];

/** A keyframe track for a caption setting (same shape as the app's Prop<number>). */
export interface CaptionTrack { value: number; keys: { f: number; v: number; in: unknown; out: unknown }[] }

export interface CaptionSpec {
  v: 1;
  text: string;
  /** A bundled font id (see fonts.ts) or `custom:<asset id>`. */
  font: string;
  bold: boolean;
  italic: boolean;
  caps: boolean;
  size: LetterSize;
  align: LetterAlign;
  /** Balloon centre, page units. */
  x: number;
  y: number;
  style: BalloonStyle;
  /** Custom balloons: the outline around the centre, page units (closed). */
  path?: [number, number][];
  tails: CaptionTail[];
  fill: string;
  ink: string;
  /** Balloon ink width as a fraction of the lettering size. */
  inkWidth: number;
  textColor: string;
  /** Outline behind the letters (sound effects); null = none. Width as a fraction of the lettering size. */
  textOutline: string | null;
  textOutlineWidth: number;
  /** A colour block behind the balloon, offset like a print shadow (offsets in lettering sizes). */
  underFill?: { color: string; dx: number; dy: number };
  /**
   * Sound effects on a path: the letters follow an arc, a wave or a drawn line (offsets from the
   * caption's centre, page units). `bend` is the arc's or wave's strength, -1 to 1.
   */
  curve?: TextCurve;
  /** Joined balloons: more balloons in the same look, each with its words, attached to this one. */
  links?: CaptionLink[];
  /** Letter size fine-tune: a multiple of the named size, 0.5–3 (absent = 1). Still a share of the page height. */
  scale?: number;
  /** Balloon width as a share of the style's usual shape, 0.5–2.5 (absent = 1). */
  shape?: number;
  /** How the balloon is drawn: roundness, wobble, spikes, bumps or a custom outline. */
  look?: BalloonLook;
  /** The smallest the balloon gets (half-width, half-height, page units), e.g. a converted drawing's size. */
  minSize?: [number, number];
  /** Still values of the keyable settings (absent = default). */
  values?: Partial<Record<CaptionKey, number>>;
  /** Keyframes of the keyable settings, in layer time. */
  keys?: Partial<Record<CaptionKey, CaptionTrack>>;
}

export const MAX_CAPTION_CHARS = 600;
export const MAX_TAILS = 4;
export const MAX_LINKS = 3;

export type TextCurve = { kind: 'arc' | 'wave'; bend: number } | { kind: 'drawn'; points: [number, number][] };
export const MAX_CURVE_POINTS = 200;

/** A joined balloon: its words and its centre (page units). */
export interface CaptionLink { text: string; x: number; y: number }

const COLOR = /^#[0-9a-f]{6}$/i;

export function defaultCaption(x: number, y: number, style: BalloonStyle = 'speech'): CaptionSpec {
  return {
    v: 1, text: '', font: style === 'sfx' ? 'bangers' : 'comic-neue', bold: style === 'shout', italic: false, caps: true,
    size: style === 'sfx' ? 'big' : 'body', align: 'center', x, y, style,
    tails: style === 'sfx' || style === 'box' ? [] : [{ x: x - 40, y: y + 110, join: style === 'thought' ? 'bubbles' : 'merged', width: 1.2 }],
    fill: '#ffffff', ink: '#111111', inkWidth: 0.09, textColor: style === 'sfx' ? '#f2c230' : '#111111',
    textOutline: style === 'sfx' ? '#111111' : null, textOutlineWidth: 0.18,
  };
}

/** The value of a keyable setting: its still value, or its default. */
export function captionValue(c: CaptionSpec, key: CaptionKey): number {
  const d = CAPTION_KEYS.find(k => k.key === key)!;
  const v = c.values?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.def;
}

/** Validate a stored caption (throws on what cannot be repaired; clamps the rest). */
/** A balloon look read back safely (clamped; a malformed outline is dropped). Null when empty. */
export function readLook(input: unknown): BalloonLook | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>, out: BalloonLook = {};
  for (const k of Object.keys(LOOK_LIMITS) as (keyof typeof LOOK_LIMITS)[]) {
    const v = r[k], [lo, hi] = LOOK_LIMITS[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, k === 'spikes' || k === 'bumps' ? Math.round(v) : v));
  }
  const o = r.outline;
  if (Array.isArray(o) && o.length >= 8 && o.length <= MAX_OUTLINE_POINTS && o.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.5))) out.outline = (o as [number, number][]).map(([x, y]) => [x, y]);
  return Object.keys(out).length ? out : null;
}

/** A text path read back safely (or null). */
export function readCurve(input: unknown): TextCurve | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  if ((r.kind === 'arc' || r.kind === 'wave') && typeof r.bend === 'number' && Number.isFinite(r.bend)) return { kind: r.kind, bend: Math.max(-1, Math.min(1, r.bend)) };
  if (r.kind === 'drawn' && Array.isArray(r.points) && r.points.length >= 2 && r.points.length <= MAX_CURVE_POINTS && r.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e5))) return { kind: 'drawn', points: (r.points as [number, number][]).map(([x, y]) => [x, y]) };
  return null;
}

export function readCaption(input: unknown): CaptionSpec {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid caption.');
  const r = input as Record<string, unknown>;
  if (r.v !== 1) throw new Error('Unsupported caption format.');
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const col = (v: unknown, d: string) => (typeof v === 'string' && COLOR.test(v) ? v : d);
  const text = typeof r.text === 'string' ? r.text.replace(/\r\n?/g, '\n').slice(0, MAX_CAPTION_CHARS) : '';
  const style = BALLOON_STYLES.includes(r.style as BalloonStyle) ? (r.style as BalloonStyle) : 'speech';
  const font = typeof r.font === 'string' && /^[a-z0-9:-]{1,64}$/i.test(r.font) ? r.font : 'comic-neue';
  const tails: CaptionTail[] = Array.isArray(r.tails) ? r.tails.slice(0, MAX_TAILS).flatMap((t): CaptionTail[] => {
    const q = t as Record<string, unknown> | null;
    if (!q || typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return [];
    const bend = Array.isArray(q.bend) && q.bend.length === 2 && q.bend.every(n => typeof n === 'number' && Number.isFinite(n)) ? (q.bend as [number, number]) : undefined;
    const extra: Partial<CaptionTail> = {};
    for (const k of Object.keys(TAIL_LIMITS) as (keyof typeof TAIL_LIMITS)[]) {
      const v = q[k], [lo, hi] = TAIL_LIMITS[k];
      if (typeof v === 'number' && Number.isFinite(v)) extra[k] = Math.min(hi, Math.max(lo, k === 'count' || k === 'zigs' ? Math.round(v) : v));
    }
    const f = q.follow as { layer?: unknown; at?: unknown } | undefined;
    const follow = f && typeof f.layer === 'string' && /^[A-Za-z0-9_:-]{1,80}$/.test(f.layer) && Array.isArray(f.at) && f.at.length === 2 && f.at.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6) ? { layer: f.layer, at: [f.at[0], f.at[1]] as [number, number] } : undefined;
    return [{ x: q.x, y: q.y, ...(bend ? { bend } : {}), join: TAIL_JOINS.includes(q.join as TailJoin) ? (q.join as TailJoin) : 'merged', width: num(q.width, 0.3, 4, 1.2), ...extra, ...(q.bolt === true ? { bolt: true } : {}), ...(follow ? { follow } : {}) }];
  }) : [];
  const path = Array.isArray(r.path) && r.path.length >= 3 && r.path.length <= 2000 && r.path.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n))) ? (r.path as [number, number][]) : undefined;
  const values: Partial<Record<CaptionKey, number>> = {};
  if (r.values && typeof r.values === 'object') for (const k of CAPTION_KEYS) { const v = (r.values as Record<string, unknown>)[k.key]; if (typeof v === 'number' && Number.isFinite(v)) values[k.key] = Math.min(k.max, Math.max(k.min, v)); }
  const keys: Partial<Record<CaptionKey, CaptionTrack>> = {};
  if (r.keys && typeof r.keys === 'object') for (const k of CAPTION_KEYS) {
    const t = (r.keys as Record<string, unknown>)[k.key] as Record<string, unknown> | undefined;
    if (!t || typeof t.value !== 'number' || !Array.isArray(t.keys)) continue;
    const ks = (t.keys as Record<string, unknown>[]).filter(x => x && Number.isInteger(x.f) && typeof x.v === 'number' && Number.isFinite(x.v) && x.in && x.out).slice(0, 2000);
    if (ks.length) keys[k.key] = { value: t.value, keys: ks.map(x => ({ f: x.f as number, v: Math.min(k.max, Math.max(k.min, x.v as number)), in: x.in, out: x.out })).sort((a, b) => a.f - b.f) };
  }
  return {
    v: 1, text, font, bold: r.bold === true, italic: r.italic === true, caps: r.caps !== false,
    size: LETTER_SIZES.includes(r.size as LetterSize) ? (r.size as LetterSize) : 'body',
    align: r.align === 'left' || r.align === 'right' ? r.align : 'center',
    x: num(r.x, -1e6, 1e6, 0), y: num(r.y, -1e6, 1e6, 0), style, ...(style === 'custom' && path ? { path } : {}), tails,
    fill: col(r.fill, '#ffffff'), ink: col(r.ink, '#111111'), inkWidth: num(r.inkWidth, 0, 0.6, 0.09),
    textColor: col(r.textColor, '#111111'), textOutline: r.textOutline === null || r.textOutline === undefined ? null : col(r.textOutline, '#111111'), textOutlineWidth: num(r.textOutlineWidth, 0, 0.6, 0.18),
    ...(typeof r.shape === 'number' && Number.isFinite(r.shape) && r.shape !== 1 ? { shape: num(r.shape, 0.5, 2.5, 1) } : {}),
    ...(typeof r.scale === 'number' && Number.isFinite(r.scale) && r.scale !== 1 ? { scale: num(r.scale, 0.5, 3, 1) } : {}),
    ...(readLook(r.look) ? { look: readLook(r.look)! } : {}),
    ...(readCurve(r.curve) ? { curve: readCurve(r.curve)! } : {}),
    ...(r.underFill && typeof r.underFill === 'object' ? (() => { const u = r.underFill as Record<string, unknown>; return { underFill: { color: col(u.color, '#111111'), dx: num(u.dx, -3, 3, 0.3), dy: num(u.dy, -3, 3, 0.3) } }; })() : {}),
    ...(Array.isArray(r.links) && r.links.length ? { links: (r.links as unknown[]).slice(0, MAX_LINKS).flatMap((k): CaptionLink[] => { const q = k as Record<string, unknown> | null; return q && typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y) ? [{ text: typeof q.text === 'string' ? q.text.replace(/\r\n?/g, '\n').slice(0, MAX_CAPTION_CHARS) : '', x: num(q.x, -1e6, 1e6, 0), y: num(q.y, -1e6, 1e6, 0) }] : []; }) } : {}),
    ...(Array.isArray(r.minSize) && r.minSize.length === 2 && r.minSize.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ? { minSize: [num(r.minSize[0], 1, 1e5, 1), num(r.minSize[1], 1, 1e5, 1)] as [number, number] } : {}),
    ...(Object.keys(values).length ? { values } : {}), ...(Object.keys(keys).length ? { keys } : {}),
  };
}
