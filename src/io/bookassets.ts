import type { BookAsset } from '../doc/model';
import { readBookAssets } from '../doc/schema';
import { readZip, writeZip } from '../engine/io/zip';
import { assetKey } from './capture';
import { encodePng, makeCanvas } from './canvasops';

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';

/** Largest image a book can store: 8192 px on a side and 16 megapixels (browser canvas limits). */
export function assetFit(width: number, height: number): { width: number; height: number; ratio: number } {
  const ratio = Math.min(1, 8192 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)), ratio };
}

/**
 * Asked before an oversized image is reduced: the source size and the size it would become.
 * Return true to reduce (the file on disk is untouched), false to cancel.
 */
export type ReduceChoice = (source: { width: number; height: number }, to: { width: number; height: number }) => Promise<boolean>;

export class ImportCancelled extends Error {}

/** Read an image for the book. Oversized images are reduced only when `reduce` agrees. */
export async function readAssetImage(file: File, reduce?: ReduceChoice): Promise<{ canvas: HTMLCanvasElement; reduced: boolean; source: { width: number; height: number } }> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 96 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP smaller than 96 MB.');
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error(`“${file.name}” could not be decoded. It may be too large for this browser; reduce it in another app below 8192 px and try again.`); }
  try {
    const source = { width: image.width, height: image.height };
    const fit = assetFit(image.width, image.height);
    if (fit.ratio < 1) {
      if (!reduce) throw new Error(`“${file.name}” is ${source.width} × ${source.height} px, larger than a book can hold (8192 px or 16 megapixels). Reduce it in another app, or import it where you can choose to reduce it.`);
      if (!(await reduce(source, fit))) throw new ImportCancelled('Import cancelled. Your original file is unchanged.');
    }
    const canvas = makeCanvas(fit.width, fit.height);
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, reduced: fit.ratio < 1, source };
  } finally { image.close(); }
}

export async function prepareAsset(file: File, reduce?: ReduceChoice): Promise<{ asset: BookAsset; bytes: Uint8Array; reduced: boolean; source: { width: number; height: number } }> {
  const { canvas, reduced, source } = await readAssetImage(file, reduce);
  const bytes = await encodePng(canvas);
  return { asset: { key: assetKey(bytes), name: file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || 'Image', width: canvas.width, height: canvas.height }, bytes, reduced, source };
}

const FORMAT = 'inkflo-assets';

export async function exportAssets(assets: BookAsset[], get: (key: string) => Promise<Uint8Array | null>): Promise<Blob> {
  const files = [{ name: 'assets.json', data: new TextEncoder().encode(JSON.stringify({ format: FORMAT, assets })) }];
  for (const { key } of assets) {
    const data = await get(key);
    if (!data) throw new Error(`Missing image ${key}.`);
    files.push({ name: key, data: new Uint8Array(data) });
  }
  return new Blob([writeZip(files) as BlobPart], { type: 'application/zip' });
}

export async function importAssets(file: File): Promise<{ assets: BookAsset[]; bytes: Map<string, Uint8Array> }> {
  if (file.size > 192 * 1024 * 1024) throw new Error('Choose an asset pack smaller than 192 MB.');
  const files = await readZip(new Uint8Array(await file.arrayBuffer()));
  const manifest = files.get('assets.json');
  if (!manifest) throw new Error('This archive has no Inkflo asset list.');
  const pack = JSON.parse(new TextDecoder().decode(manifest));
  if (pack?.format !== FORMAT) throw new Error('This is not an Inkflo asset pack.');
  const assets = readBookAssets(pack.assets);
  const bytes = new Map<string, Uint8Array>();
  for (const { key, width, height } of assets) {
    const image = files.get(key);
    if (!image || image.length < 33 || assetKey(image) !== key) throw new Error(`Missing or damaged image ${key}.`);
    const png = new DataView(image.buffer, image.byteOffset, image.byteLength);
    if (png.getUint32(0) !== 0x89504e47 || png.getUint32(12) !== 0x49484452 || png.getUint32(16) !== width || png.getUint32(20) !== height) throw new Error(`Invalid image ${key}.`);
    bytes.set(key, image);
  }
  return { assets, bytes };
}
