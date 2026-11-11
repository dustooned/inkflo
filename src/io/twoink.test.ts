import { expect, it } from 'vitest';
import { crc32 } from '../engine/io/zip';
import { coverage, inkMix, pngAtDpi } from './twoink';

it('keeps white paper clean and adds the shadow plate as tones darken', () => {
  expect(coverage(0)).toEqual([0, 0]);
  expect(coverage(0.25)).toEqual([0.375, 0]);
  expect(coverage(1)).toEqual([1, 1]);
  expect(inkMix(['#ff0000', '#00ffff'], 0, 0)).toEqual([255, 255, 255]);
  expect(inkMix(['#ff0000', '#00ffff'], 1, 1)).toEqual([0, 0, 0]);
});

it('adds a PNG resolution chunk with a valid checksum, then replaces it in place', () => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64'));
  const plate = pngAtDpi(png, 300);
  expect(plate.length).toBe(png.length + 21);
  expect(new TextDecoder().decode(plate.slice(37, 41))).toBe('pHYs');
  const data = new DataView(plate.buffer);
  expect(data.getUint32(41)).toBe(11811);
  expect(data.getUint32(45)).toBe(11811);
  expect(data.getUint32(50)).toBe(crc32(plate.subarray(37, 50)));
  const reencoded = pngAtDpi(plate, 600);
  expect(reencoded.length).toBe(plate.length);
  expect(new DataView(reencoded.buffer).getUint32(41)).toBe(23622);
});
