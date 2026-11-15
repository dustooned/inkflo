import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { newId } from '../doc/model';
import { LIBRARY, type BrushEntry } from '../draw/brushes';
import { cloneBrush, dyn, readCurvePoints, type Dynamic } from '../engine/core/brush';
import { parsePlist, unarchive } from './brushplist';
import { makeCanvas } from './canvasops';
import type { BrushImport } from './brushimport';

const MAX_ARCHIVE_BYTES = 1024 ** 3;
const MAX_ENTRIES = 12_000;
const MAX_BRUSHES = 300;
const MAX_SETTINGS_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 ** 2;
const ROUND_TIPS = new Map([['hard', 1], ['soft', 0.25], ['ultra-soft', 0.02]]);
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

type Settings = Record<string, unknown>;
const record = (v: unknown): Settings | undefined => v && typeof v === 'object' ? v as Settings : undefined;
function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  const value = record(v)?.['NS.string'];
  if (typeof value === 'string') return value;
  const bytes = record(v)?.['NS.bytes'];
  if (bytes instanceof Uint8Array) return new TextDecoder().decode(bytes);
  return undefined;
}
function num(info: Settings, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = info[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return Number(value);
  }
  return fallback;
}

function responseCurve(v: unknown): Dynamic['points'] {
  const list = record(v)?.points ?? v;
  const items = record(list)?.['NS.objects'] ?? list;
  if (!Array.isArray(items)) return undefined;
  const points: [number, number][] = [];
  for (const p of items) {
    const match = /^\{\s*([\deE+.-]+)\s*,\s*([\deE+.-]+)\s*\}$/.exec(str(p)?.trim() ?? '');
    if (!match || !Number.isFinite(Number(match[1])) || !Number.isFinite(Number(match[2]))) return undefined;
    points.push([clamp(Number(match[1])), clamp(Number(match[2]))]);
  }
  return readCurvePoints(points.sort((a, b) => a[0] - b[0])) ?? undefined;
}

function dynamics(info: Settings, key: 'Size' | 'Opacity'): Dynamic {
  const pressure = num(info, [`dynamicsPressure${key}`], 0);
  const speed = num(info, [`dynamicsSpeed${key}`], 0);
  const control = pressure ? 'pressure' : speed ? 'speed' : 'off';
  const amount = pressure || speed;
  const points = pressure ? responseCurve(info[`dynamicsPressure${key}Curve`]) : undefined;
  return {
    ...dyn(control, 1 - clamp(Math.abs(amount))),
    ...(points ? { points } : {}),
    ...(amount < 0 ? { invert: true } : {}),
    jitter: clamp(num(info, [`dynamicsJitter${key}`], 0)),
  };
}

export function grainTone(light: number, brightness: number, contrast: number): number {
  return clamp((light - 0.5) * 2 ** (2 * clamp(contrast, -1, 1)) + 0.5 + clamp(brightness, -1, 1));
}

async function entryBytes(entry: FileEntry, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (entry.encrypted || entry.uncompressedSize < 1 || entry.uncompressedSize > limit) throw new Error('Invalid brush data size.');
  return entry.getData(new Uint8ArrayWriter(), { useWebWorkers: false, checkSignature: true });
}

async function mask(entry: FileEntry, kind: 'tip' | 'grain', invert: boolean, brightness = 0, contrast = 0) {
  const bytes = await entryBytes(entry, MAX_IMAGE_BYTES);
  // These assets are PNG, with dimensions available before allocating any decoded pixels.
  const png = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || png.getUint32(0) !== 0x89504e47 || png.getUint32(4) !== 0x0d0a1a0a) throw new Error('Expected a PNG mask.');
  const w = png.getUint32(16), h = png.getUint32(20);
  if (!w || !h || w * h > 16_777_216 || Math.max(w, h) > 8192) throw new Error('Brush mask is too large.');
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    // Keep PNG data URLs within the brush book and library serializers' limits.
    const limit = kind === 'tip' ? 400_000 : 600_000;
    const max = kind === 'tip' ? 256 : 512;
    for (const size of [max, max / 2]) {
      const scale = Math.min(1, size / Math.max(w, h));
      const canvas = makeCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
      const g = canvas.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = g.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.data.length; i += 4) {
        const p = data.data;
        const light = (p[i]! * 0.3 + p[i + 1]! * 0.59 + p[i + 2]! * 0.11) / 255;
        const value = (invert ? 1 - light : light) * p[i + 3]! / 255;
        const grey = kind === 'tip' ? 255 : Math.round(grainTone(value, brightness, contrast) * 255);
        p[i] = p[i + 1] = p[i + 2] = grey;
        p[i + 3] = kind === 'tip' ? Math.round(value * 255) : 255;
      }
      g.putImageData(data, 0, 0);
      const url = canvas.toDataURL('image/png');
      const extent = Math.max(canvas.width, canvas.height);
      canvas.width = canvas.height = 0;
      if (url.length < limit) return { url, extent };
    }
    throw new Error('Brush mask could not fit the library.');
  } finally { image.close(); }
}

function mapBrush(info: Settings, name: string): BrushEntry {
  const b = cloneBrush(LIBRARY.find((entry) => entry.id === 'maru-pen')!.settings);
  b.name = name;
  b.size = clamp(Math.round(num(info, ['paintSize', 'maxSize'], 0.24) * 100), 2, 200);
  b.hardness = 0.85;
  b.angle = 0;
  b.roundness = clamp(num(info, ['shapeRoundness'], 1) || 1, 0.05);
  b.followDirection = num(info, ['shapeRotation'], 0) > 0.5;
  b.opacity = clamp(num(info, ['paintOpacity', 'maxOpacity'], 1));
  b.flow = 1;
  b.spacing = clamp(num(info, ['plotSpacing'], 0.15), 0.02, 2);
  b.scatter = clamp(num(info, ['plotJitter'], 0), 0, 8);
  b.grain = 0;
  b.sizeDyn = dynamics(info, 'Size');
  b.opacityDyn = dynamics(info, 'Opacity');
  b.flowDyn = dyn('off');
  const pencilTaper = num(info, ['pencilTaperStartLength'], 0) + num(info, ['pencilTaperEndLength'], 0) > 0;
  const taper = pencilTaper ? 'pencilTaper' : 'taper';
  b.taperStart = Math.round(clamp(num(info, [`${taper}StartLength`], 0)) * 160);
  b.taperEnd = Math.round(clamp(num(info, [`${taper}EndLength`], 0)) * 160);
  if (b.taperStart || b.taperEnd) {
    b.taperSize = clamp(num(info, [`${taper}Size`], 1));
    const opacity = clamp(num(info, [`${taper}Opacity`], 0));
    const shape = clamp(num(info, [`${taper}Shape`], 0));
    if (opacity) b.taperOpacity = opacity;
    if (shape) b.taperShape = shape;
  }
  b.smoothing = clamp(num(info, ['plotSmoothing', 'streamLine', 'streamline'], 0));
  b.stabilize = clamp(num(info, ['plotMovingAverageStabilization'], 0));
  b.wetPull = clamp(num(info, ['wetMixPull', 'dynamicsPull', 'paintPull', 'pull'], 0));
  const stamp = ['Hue', 'Saturation', 'Lightness', 'Darkness'].map((key) => clamp(num(info, [`dynamicsJitter${key}`], 0)));
  const stroke = ['Hue', 'Saturation', 'Lightness', 'Darkness'].map((key) => clamp(num(info, [`dynamicsJitterStroke${key}`], 0)));
  const jitter = stamp.some(Boolean) ? stamp : stroke;
  b.hueJitter = jitter[0];
  b.satJitter = jitter[1];
  b.brightJitter = Math.max(jitter[2]!, jitter[3]!);
  b.strokeColor = jitter === stroke && stroke.some(Boolean);
  return { id: newId('brush'), name, settings: b, group: 'mine', pass: 'ink', w: clamp(b.size / 300, 0.004, 0.5), note: 'Procreate brush' };
}

export async function importProcreate(file: File): Promise<BrushImport> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Choose a Procreate brush set up to 1 GiB.');
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    const contents = new Map<string, FileEntry>();
    let seen = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (++seen > MAX_ENTRIES) throw new Error('The brush set has too many files.');
      const key = entry.filename.toLowerCase();
      if (!entry.directory && !/(^|\/)__macosx\//.test(key) && !contents.has(key)) contents.set(key, entry);
    }
    const archives = [...contents.keys()].filter((key) => /(^|\/)brush\.archive$/.test(key) && !/(^|\/)reset\//.test(key));
    if (!archives.length) throw new Error('This file has no Procreate brushes.');
    for (const [key, entry] of contents) {
      if (!/(^|\/)brushset\.plist$/.test(key)) continue;
      try {
        const plist = record(parsePlist(await entryBytes(entry, MAX_SETTINGS_BYTES)));
        const folders = Array.isArray(plist?.brushes) ? plist.brushes : [];
        const order = new Map(folders.map((folder, i) => [str(folder)?.toLowerCase(), i]));
        const index = (path: string) => order.get(path.split('/').at(-2)) ?? Infinity;
        archives.sort((a, b) => index(a) - index(b));
      } catch { /* the archive order still works */ }
      break;
    }
    const entries: BrushEntry[] = [];
    let skipped = Math.max(0, archives.length - MAX_BRUSHES);
    let substitutions = 0;
    let roundTips = 0;
    const packName = file.name.replace(/\.[^.]+$/, '');
    for (const [i, path] of archives.slice(0, MAX_BRUSHES).entries()) {
      let info: Settings | null;
      try { info = unarchive(parsePlist(await entryBytes(contents.get(path)!, MAX_SETTINGS_BYTES))); }
      catch { info = null; }
      if (!info) { skipped++; continue; }
      const folder = path.slice(0, -'brush.archive'.length);
      const name = (str(info.name)?.trim() || (archives.length === 1 ? packName : `${packName} ${i + 1}`)).slice(0, 40);
      const entry = mapBrush(info, name);
      const b = entry.settings;
      let substitute = false;
      for (const [kind, property, filename] of [['tip', 'bundledShapePath', 'shape.png'], ['grain', 'bundledGrainPath', 'grain.png']] as const) {
        const requested = str(info[property])?.trim();
        const basename = requested?.split(/[\\/]/).at(-1)?.toLowerCase();
        const find = (name: string) => contents.get(folder + name) ?? contents.get(folder + 'reset/' + name);
        const source = (basename ? find(basename) : undefined) ?? find(filename);
        const invert = num(info, kind === 'tip' ? ['shapeInverted', 'shapeInvert'] : ['textureInverted', 'grainInverted', 'textureInvert'], 0) > 0;
        if (!source) {
          const round = !invert && kind === 'tip' ? /^brush-preset-(hard|soft|ultra-soft)\.(?:png|jpe?g)$/.exec(basename ?? '') : null;
          if (round) {
            b.hardness = ROUND_TIPS.get(round[1]!)!;
            roundTips++;
          } else if (requested && !(kind === 'grain' && basename === 'brush-preset-blank.png' && !invert)) {
            substitute = true;
          }
          continue;
        }
        try {
          const brightness = num(info, ['textureBrightness'], 0);
          const contrast = num(info, ['textureContrast'], 0);
          const image = await mask(source, kind, invert, brightness, contrast);
          if (kind === 'tip') {
            b.tipImage = image.url;
            b.hardness = 1;
          } else {
            b.grainImage = image.url;
            b.grain = clamp(num(info, ['grainDepth', 'textureDepth'], 0.8));
            b.grainMin = clamp(num(info, ['grainDepthMinimum'], 0));
            const scale = num(info, ['textureScale', 'grainScale'], 0.5) || 0.5;
            b.grainScale = clamp(scale * 2 * 256 / image.extent, 0.1, 4);
            b.grainMovement = clamp(num(info, ['textureMovement'], 1));
            b.grainRotation = clamp(num(info, ['textureRotation'], 0), -1, 1) * 180;
            b.grainFollow = 1 - clamp(num(info, ['textureZoom'], 1));
            b.grainRef = b.size;
            if ([27, 28].includes(num(info, ['grainBlendMode'], 1))) b.grainMode = 'height';
          }
        } catch { substitute = true; }
      }
      if (substitute) {
        entry.note = 'Procreate brush · source texture unavailable';
        substitutions++;
      }
      entries.push(entry);
    }
    const note = [
      substitutions ? `${substitutions} with a missing or unreadable tip or grain.` : '',
      roundTips ? `${roundTips} with equivalent round tips for standard Procreate shapes.` : '',
      'Some Procreate rendering settings differ. Dual brush combinations are skipped.',
    ].filter(Boolean).join(' ');
    return { entries, skipped, note };
  } finally { await reader.close(); }
}
