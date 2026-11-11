// Vendored from 2Dope src/core/pen.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Pen and tablet setup for this device: a pressure curve applied before every brush's own dynamics,
 * what the pen's eraser end and side button do, and a probe that learns what the pen reports.
 *
 * Browsers do not name the tablet (Wacom, Huion, XP-Pen, Apple Pencil all arrive as Pointer
 * Events), so detection is by behaviour: does the pen report pressure that changes, tilt, twist,
 * an eraser end, a side button, hover. The tips name the driver settings that usually fix what is
 * missing.
 */

export const PEN_PREFS_KEY = '2dope.pen';

export type BarrelAction = 'menu' | 'pan' | 'zoom' | 'eraser';
const BARREL: BarrelAction[] = ['menu', 'pan', 'zoom', 'eraser'];

export interface PenPrefs {
  version: 1;
  /** -1 soft (full strength with a light hand) .. 1 firm (needs a heavy hand). 0 is linear. */
  firmness: number;
  /** Raw pressure below this counts as the lightest touch (0..0.4). */
  threshold: number;
  /** Raw pressure that already gives full strength (0.2..1). */
  full: number;
  /** Use the pen's tilt (off for drivers that report a fixed or noisy tilt). */
  tilt: boolean;
  /** Turning the pen over to its eraser end switches to the Eraser, and back for the tip. */
  eraserEnd: boolean;
  /** The pen's side (barrel) button on the canvas. */
  barrel: BarrelAction;
  /** The pointer over the canvas while drawing (missing = crosshair; older builds ignore it). */
  cursor?: CanvasCursor;
  /**
   * Touch and hold on the canvas. 'eyedropper' (the default): one finger picks a colour (Draw and
   * Animate); a one-finger double-tap (or the ☰ button) opens the menu. 'menu': the hold opens the
   * menu. A two-finger tap is always undo.
   */
  touchHold?: TouchHold;
}

export type TouchHold = 'eyedropper' | 'menu';

export type CanvasCursor = 'crosshair' | 'circle' | 'dot' | 'brush' | 'none';
export const CANVAS_CURSORS: [CanvasCursor, string][] = [['crosshair', 'Crosshair'], ['circle', 'Small circle'], ['dot', 'Dot'], ['brush', 'Brush size'], ['none', 'None (pen screens)']];

/** Largest cursor picture browsers show (Chrome and Safari cap custom cursors at 128 px). */
const MAX_CURSOR = 124;

/**
 * The CSS cursor for a canvas cursor choice. `diameter` is the brush's size on screen in CSS pixels
 * (for 'brush'; tools without a size pass 0 and get the small circle). Rings are drawn dark inside
 * white so they show on any colour. A brush larger than a cursor picture can be shows the crosshair.
 */
export function canvasCursorCss(kind: CanvasCursor = 'crosshair', diameter = 0): string {
  const svg = (size: number, body: string) => {
    const c = size / 2;
    const url = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body.replace(/C/g, String(c))}</svg>`)}`;
    return `url("${url}") ${Math.floor(c)} ${Math.floor(c)}, crosshair`;
  };
  const ring = (size: number, r: number) => svg(size, `<circle cx="C" cy="C" r="${r}" fill="none" stroke="#fff" stroke-width="3"/><circle cx="C" cy="C" r="${r}" fill="none" stroke="#000" stroke-width="1"/>`);
  if (kind === 'none') return 'none';
  if (kind === 'dot') return svg(8, '<circle cx="C" cy="C" r="2.5" fill="#000" stroke="#fff" stroke-width="1.5"/>');
  if (kind === 'circle' || (kind === 'brush' && diameter <= 0)) return ring(16, 5.5);
  if (kind === 'brush') {
    if (diameter > MAX_CURSOR - 4) return 'crosshair';
    const r = Math.max(2, diameter / 2);
    const size = Math.ceil(r * 2 + 6) | 1;
    // a dot in the middle marks the exact spot on a ring too big to aim with
    return svg(size, `<circle cx="C" cy="C" r="${r}" fill="none" stroke="#fff" stroke-width="3"/><circle cx="C" cy="C" r="${r}" fill="none" stroke="#000" stroke-width="1"/>${r > 8 ? '<circle cx="C" cy="C" r="1" fill="#000"/>' : ''}`);
  }
  return 'crosshair';
}

export function defaultPenPrefs(): PenPrefs {
  return { version: 1, firmness: 0, threshold: 0, full: 1, tilt: true, eraserEnd: true, barrel: 'menu', cursor: 'crosshair', touchHold: 'eyedropper' };
}

const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export function readPenPrefs(value: unknown): PenPrefs {
  const d = defaultPenPrefs();
  if (!value || typeof value !== 'object') return d;
  const v = value as Partial<PenPrefs>;
  if (v.version !== 1) return d;
  const threshold = num(v.threshold, 0, 0.4, d.threshold);
  return {
    version: 1,
    firmness: num(v.firmness, -1, 1, d.firmness),
    threshold,
    full: Math.max(threshold + 0.05, num(v.full, 0.2, 1, d.full)),
    tilt: typeof v.tilt === 'boolean' ? v.tilt : d.tilt,
    eraserEnd: typeof v.eraserEnd === 'boolean' ? v.eraserEnd : d.eraserEnd,
    barrel: BARREL.includes(v.barrel as BarrelAction) ? v.barrel as BarrelAction : 'menu',
    cursor: CANVAS_CURSORS.some(([k]) => k === v.cursor) ? v.cursor as CanvasCursor : 'crosshair',
    touchHold: v.touchHold === 'menu' ? 'menu' : 'eyedropper',
  };
}

/** Raw pen pressure (0..1) to the pressure brushes see. The defaults return it unchanged. */
export function mapPressure(raw: number, p: PenPrefs): number {
  const lo = p.threshold, hi = Math.max(lo + 0.05, p.full);
  const t = Math.min(1, Math.max(0, (raw - lo) / (hi - lo)));
  return Math.pow(t, Math.pow(2, p.firmness * 1.5));
}

/** Pointer Events' eraser button bit (a pen turned over, or a pen's eraser button). */
export const ERASER_BUTTONS = 32;

export interface PenSample {
  type: string;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  /** Pointer Events' `buttons`: 0 is hover, 1 the tip, 2 the side button, 32 the eraser. */
  buttons: number;
}

export interface PenCaps {
  /** A pen (pointerType 'pen') has been seen. */
  pen: boolean;
  /** The last kind of pointer that pressed on the canvas or the test pad. */
  lastType: string;
  /** Pressure seen changing, never changing over several strokes, or not known yet. */
  pressure: 'unknown' | 'none' | 'yes';
  /** Rough pressure resolution (a power of two), 0 until enough strokes. */
  levels: number;
  /** Strongest raw pressure seen in a stroke. */
  maxPressure: number;
  strokes: number;
  tilt: boolean;
  twist: boolean;
  eraser: boolean;
  barrel: boolean;
  hover: boolean;
}

/** Learns what the pen reports. Feed it pen and mouse events; it keeps no event objects. */
export class PenProbe {
  private c: PenCaps = { pen: false, lastType: '', pressure: 'unknown', levels: 0, maxPressure: 0, strokes: 0, tilt: false, twist: false, eraser: false, barrel: false, hover: false };
  private flat = 0;
  private step = 1;
  private samples = 0;
  private stroke: { min: number; max: number; n: number; last: number } | null = null;

  caps(): PenCaps { return { ...this.c }; }

  /** One sample. Returns true when this sample showed the pen reports no pressure (once). */
  observe(s: PenSample): boolean {
    if (s.buttons && s.type !== 'touch') this.c.lastType = s.type;
    if (s.type !== 'pen') { this.stroke = null; return false; }
    const c = this.c;
    c.pen = true;
    if (s.tiltX || s.tiltY) c.tilt = true;
    if (s.twist) c.twist = true;
    if (s.buttons & ERASER_BUTTONS) c.eraser = true;
    if (s.buttons & 2) c.barrel = true;
    if (!s.buttons) { c.hover = true; return this.endStroke(); }
    const p = s.pressure, k = this.stroke;
    if (!k) { this.stroke = { min: p, max: p, n: 1, last: p }; return false; }
    k.min = Math.min(k.min, p); k.max = Math.max(k.max, p); k.n++;
    const d = Math.abs(p - k.last);
    if (d > 1e-6) { this.step = Math.min(this.step, d); this.samples++; }
    k.last = p;
    return false;
  }

  /** The pen lifted. Returns true when the pen has now shown it reports no pressure (once). */
  endStroke(): boolean {
    const k = this.stroke, c = this.c;
    this.stroke = null;
    if (!k || k.n < 6) return false;
    c.strokes++;
    c.maxPressure = Math.max(c.maxPressure, k.max);
    if (k.max - k.min > 0.02) { c.pressure = 'yes'; this.flat = 0; }
    else if (c.pressure !== 'yes' && ++this.flat >= 2 && c.pressure === 'unknown') { c.pressure = 'none'; return true; }
    if (c.pressure === 'yes' && this.samples >= 40) c.levels = Math.pow(2, Math.round(Math.log2(1 / this.step)));
    return false;
  }
}

export type Platform = 'windows' | 'mac' | 'linux' | 'chromeos' | 'ios' | 'android' | 'other';

export function platformOf(ua: string, platform = '', touchPoints = 0): Platform {
  const s = `${platform} ${ua}`.toLowerCase();
  if (/iphone|ipad|ipod/.test(s) || (/mac/.test(s) && touchPoints > 1)) return 'ios';
  if (/android/.test(s)) return 'android';
  if (/cros|chrome os/.test(s)) return 'chromeos';
  if (/win/.test(s)) return 'windows';
  if (/mac/.test(s)) return 'mac';
  if (/linux|x11/.test(s)) return 'linux';
  return 'other';
}

/** One line on what the pen reports, and tips for what is missing. */
export function diagnosePen(c: PenCaps, platform: Platform): { summary: string; tips: string[] } {
  const tips: string[] = [];
  const ink = 'turn on Windows Ink in the tablet driver (Wacom Tablet Properties → Mapping → Use Windows Ink; Huion and Gaomon: Windows Ink in the pen settings; XP-Pen: Pen → Windows Ink), then reload this page';
  const driverTip = (what: string): string =>
    platform === 'windows' ? `${what}: ${ink}.`
      : platform === 'mac' ? `${what}: install the tablet maker’s current driver and allow it in System Settings → Privacy & Security → Accessibility, then restart the browser.`
        : platform === 'linux' ? `${what}: check that the tablet is listed by libinput (libinput list-devices) and that the browser runs on Wayland or with XInput2.`
          : `${what}: update the tablet’s driver or app, and check pressure in its own test.`;
  if (!c.pen) {
    if (c.lastType === 'mouse') tips.push(driverTip('Drawing with a tablet pen but this says mouse? The driver is sending mouse input'));
    else tips.push('Draw on the test pad with your pen to see what it reports.');
    return { summary: c.lastType === 'mouse' ? 'Only mouse input so far: no pressure or tilt.' : 'No pen seen yet.', tips };
  }
  const has = [c.tilt && 'tilt', c.twist && 'twist (rotation)', c.eraser && 'eraser end', c.barrel && 'side button', c.hover && 'hover'].filter(Boolean).join(', ');
  const pressure = c.pressure === 'yes' ? `pressure${c.levels ? ` (about ${c.levels.toLocaleString()} levels)` : ''}` : c.pressure === 'none' ? 'no pressure' : 'pressure not checked yet';
  if (c.pressure === 'none') tips.push(driverTip('The pen reports the same pressure all the time'));
  if (c.pressure === 'yes' && c.strokes >= 3 && c.maxPressure < 0.6) tips.push(`Your strongest strokes reach ${Math.round(c.maxPressure * 100)}% pressure. Lower “Full strength at”, or tap “Set from my test strokes”.`);
  if (c.pressure === 'yes' && !c.tilt && c.strokes >= 3) tips.push('No tilt reported. Many tablets have none; brushes that use tilt act as if the pen is upright.');
  if (platform === 'windows') tips.push('A ring or a menu that appears when the pen rests still is Windows “press and hold”. Turn it off in Settings → Bluetooth & devices → Pen & Windows Ink, or in the tablet driver.');
  return { summary: `Pen with ${pressure}${has ? `, ${has}` : ''}.`, tips };
}
