import type { BookAsset } from '../doc/model';
import { readBookAssets } from '../doc/schema';
import { readZip, writeZip } from '../engine/io/zip';
import { assetKey } from './capture';
import { encodePng, makeCanvas } from './canvasops';

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';

export async function readAssetImage(file: File): Promise<{ canvas: HTMLCanvasElement; reduced: boolean }> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 96 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP smaller than 96 MB.');
  const image = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 8192 / Math.max(image.width, image.height), Math.sqrt(16_000_000 / (image.width * image.height)));
    const canvas = makeCanvas(Math.max(1, Math.floor(image.width * ratio)), Math.max(1, Math.floor(image.height * ratio)));
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, reduced: ratio < 1 };
  } finally { image.close(); }
}

export async function prepareAsset(file: File): Promise<{ asset: BookAsset; bytes: Uint8Array }> {
  const { canvas } = await readAssetImage(file);
  const bytes = await encodePng(canvas);
  return { asset: { key: assetKey(bytes), name: file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || 'Image', width: canvas.width, height: canvas.height }, bytes };
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
