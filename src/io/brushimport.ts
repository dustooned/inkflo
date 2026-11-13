import type { Abr, BrushDynamics, SampleInfo } from 'ag-psd';
import { newId } from '../doc/model';
import { LIBRARY, type BrushEntry } from '../draw/brushes';
import { cloneBrush, dyn } from '../engine/core/brush';
import { makeCanvas } from './canvasops';

const clamp = (value: number, min = 0, max = 1) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
const base = () => cloneBrush(LIBRARY.find((b) => b.id === 'maru-pen')!.settings);
const LIMIT = 64 * 1024 * 1024;
export interface BrushImport {
  entries: BrushEntry[];
  skipped: number;
  note?: string;
}

function tipCanvas(width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, 256 / Math.max(width, height));
  return makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
}

function sampleTip(sample: SampleInfo, flipX: boolean, flipY: boolean): string {
  const { w, h } = sample.bounds;
  const canvas = tipCanvas(w, h);
  const g = canvas.getContext('2d')!;
  const data = g.createImageData(canvas.width, canvas.height);
  data.data.fill(255);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const sx = Math.floor((x + 0.5) * w / canvas.width), sy = Math.floor((y + 0.5) * h / canvas.height);
      data.data[(y * canvas.width + x) * 4 + 3] = sample.alpha[(flipY ? h - 1 - sy : sy) * w + (flipX ? w - 1 - sx : sx)]!;
    }
  }
  g.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function readBrushImage(file: File, grayscale: 'dark' | 'light' = 'dark'): Promise<string> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Choose a PNG, JPG or WebP brush image.');
  if (file.size > LIMIT) throw new Error('Choose an image under 64 MB.');
  const image = await createImageBitmap(file);
  try {
    const canvas = tipCanvas(image.width, image.height);
    const g = canvas.getContext('2d')!;
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = g.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    const opaque = pixels.every((v, i) => i % 4 !== 3 || v === 255);
    for (let i = 0; i < pixels.length; i += 4) {
      const light = (pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) / 255;
      const value = opaque ? grayscale === 'dark' ? 1 - light : light : pixels[i + 3]! / 255;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(value * 255);
    }
    g.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
  } finally { image.close(); }
}

function dynamics(value: BrushDynamics | undefined, override = false, minimum = value?.minimum ?? 0) {
  const control = override || value?.control === 'pen pressure' ? 'pressure' : value?.control === 'pen tilt' ? 'tilt' : 'off';
  return { ...dyn(control, clamp(minimum)), jitter: clamp(value?.jitter ?? 0) };
}

function preset(name: string, note: string, settings: BrushEntry['settings'], size: number): BrushEntry {
  name = name.trim().slice(0, 40) || 'Imported brush';
  return { id: newId('brush'), name, note, group: 'mine', pass: 'ink', w: clamp(size / 300, 0.004, 0.5), settings: { ...settings, name } };
}

export function fromAbr(abr: Abr, name: string): { entries: BrushEntry[]; skipped: number } {
  const samples = new Map(abr.samples.filter((s) => s.bounds.w > 0 && s.bounds.h > 0 && s.alpha.length === s.bounds.w * s.bounds.h).map((s) => [s.id, s]));
  const used = new Set<string>();
  const entries: BrushEntry[] = [];
  let skipped = 0;
  for (const brush of abr.brushes) {
    const { shape, toolOptions: tool, shapeDynamics: motion, transfer } = brush;
    if (entries.length >= 128 || (shape.type !== 'computed' && shape.type !== 'sampled')) { skipped++; continue; }
    const sample = shape.type === 'sampled' ? samples.get(shape.sampledData) : undefined;
    if (shape.type === 'sampled' && !sample) { skipped++; continue; }
    const b = base();
    if (sample) {
      b.tipImage = sampleTip(sample, shape.flipX, shape.flipY);
      used.add(sample.id);
    }
    const size = shape.size || (sample ? Math.max(sample.bounds.w, sample.bounds.h) : 10);
    b.spacing = clamp((shape.spacingOn ? shape.spacing : brush.spacing) || 0.1, 0.02, 5);
    b.angle = ((Number.isFinite(shape.angle) ? shape.angle % 360 : 0) + 360) % 360;
    b.roundness = clamp(shape.roundness, 0.05, 1);
    b.hardness = shape.type === 'computed' ? clamp(shape.hardness) : 1;
    b.flow = clamp((tool?.flow ?? 100) / 100);
    b.opacity = clamp((tool?.opacity ?? 100) / 100);
    b.smoothing = tool?.smoothing ? clamp(tool.smoothingValue / 100) : 0;
    b.sizeDyn = dynamics(motion?.sizeDynamics ?? tool?.sizeDynamics, tool?.usePressureOverridesSize, motion?.minimumDiameter);
    b.opacityDyn = dynamics(transfer?.opacityDynamics ?? tool?.opacityDynamics, tool?.usePressureOverridesOpacity);
    b.flowDyn = dynamics(transfer?.flowDynamics ?? tool?.flowDynamics);
    b.scatter = clamp(brush.scatter?.scatterDynamics.jitter ?? 0, 0, 2);
    b.followDirection = motion?.angleDynamics.control === 'direction';
    entries.push(preset(brush.name, 'Photoshop ABR', b, size));
  }
  // Some packs supply tips with no descriptors.
  for (const sample of samples.values()) {
    if (used.has(sample.id)) continue;
    if (entries.length >= 128) { skipped++; continue; }
    const b = base();
    b.tipImage = sampleTip(sample, false, false);
    entries.push(preset(`${name} ${entries.length + 1}`, 'ABR sampled tip', b, Math.max(sample.bounds.w, sample.bounds.h)));
  }
  return { entries, skipped };
}

export async function importBrushFile(file: File): Promise<BrushImport> {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  if (file.size > LIMIT) throw new Error('Choose a brush file under 64 MB.');
  if (ext === 'abr') {
    const { readAbr } = await import('ag-psd');
    return fromAbr(readAbr(new Uint8Array(await file.arrayBuffer()), { totalMemoryLimit: LIMIT }), name);
  }
  if (ext === 'sut') {
    const { readSut } = await import('./sut');
    const { name: toolName, settings, images, limited } = await readSut(new Uint8Array(await file.arrayBuffer()));
    const b = base();
    const read = (key: keyof typeof settings, fallback: number) => typeof settings[key] === 'number' ? settings[key] as number : fallback;
    const size = read('BrushSize', 24);
    b.hardness = clamp(read('BrushHardness', 100) / 100);
    b.opacity = clamp(read('Opacity', 100) / 100);
    b.flow = clamp(read('BrushFlow', 100) / 100);
    b.roundness = clamp(read('BrushThickness', 100) / 100, 0.05, 1);
    b.angle = ((read('BrushRotation', 0) % 360) + 360) % 360;
    b.spacing = read('BrushAutoIntervalType', 0) ? 0.12 : clamp(read('BrushInterval', 10) / 100, 0.02, 5);
    b.smoothing = read('BrushUseRevision', 0) ? clamp(read('BrushRevision', 0) / 100) : 0;
    b.antiAlias = read('AntiAlias', 2) > 0;
    const label = toolName || name;
    const entries: BrushEntry[] = [];
    let skipped = 0;
    for (const [i, bytes] of images.entries()) {
      try {
        const tipImage = await readBrushImage(new File([bytes], `${label}.png`, { type: 'image/png' }));
        entries.push(preset(images.length > 1 ? `${label} ${i + 1}` : label, 'Clip Studio SUT tip', { ...b, tipImage }, size));
      } catch { skipped++; }
    }
    if (!images.length) entries.push(preset(label, 'Clip Studio SUT', b, size));
    const notes = [limited ? 'Only the first embedded tips were read.' : '', images.length > 1 ? 'Each embedded tip is a separate brush.' : '',
      settings.BrushRibbon || settings.BrushUseSpray || settings.TextureImage ? 'Ribbon, spray and texture effects may need to be recreated in Brush Studio.' : ''];
    const note = notes.filter(Boolean).join(' ');
    return { entries, skipped, note };
  }
  const b = base();
  b.tipImage = await readBrushImage(file);
  return { entries: [preset(name, 'Image brush tip', b, 24)], skipped: 0 };
}
