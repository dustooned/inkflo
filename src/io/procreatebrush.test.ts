import { expect, it } from 'vitest';
import { writeZip } from '../engine/io/zip';
import { importBrushFile } from './brushimport';
import { grainTone } from './procreatebrush';

const plist = (body: string) => new TextEncoder().encode(`<plist><dict>${body}</dict></plist>`);

it('imports Procreate settings in set order and reports unreadable and missing resources', async () => {
  const archives = writeZip([
    { name: 'Wrapped/first/Brush.archive', data: plist(
      '<key>name</key><string>Fine liner</string><key>bundledShapePath</key><string>Brush-Preset-Hard.png</string>' +
      '<key>bundledGrainPath</key><string>Brush-Preset-Blank.png</string>') },
    { name: 'Wrapped/first/Reset/Brush.archive', data: plist('<key>name</key><string>Backup</string>') },
    { name: 'Wrapped/second/Brush.archive', data: plist(
      '<key>name</key><string>Grain brush</string><key>bundledGrainPath</key><string>System grain.png</string>' +
      '<key>dynamicsPressureSize</key><real>-0.75</real><key>plotSpacing</key><real>0.25</real>') },
    { name: 'Wrapped/bad/Brush.archive', data: new Uint8Array([0]) },
    { name: 'Wrapped/Brushset.plist', data: plist('<key>brushes</key><array><string>second</string><string>first</string></array>') },
  ]);
  const result = await importBrushFile(new File([archives as BlobPart], 'Fixture.brushset'));
  expect(result.skipped).toBe(1);
  expect(result.entries.map((entry) => entry.name)).toEqual(['Grain brush', 'Fine liner']);
  expect(result.entries[0]?.note).toContain('source texture unavailable');
  expect(result.entries[0]?.settings).toMatchObject({ spacing: 0.25, sizeDyn: { control: 'pressure', min: 0.25, invert: true } });
  expect(result.entries[1]?.settings).toMatchObject({ hardness: 1, grain: 0 });
  expect(result.note).toContain('1 with a missing');
  expect(result.note).toContain('1 with equivalent round tips');
});

it('keeps neutral grain unchanged and preserves the direction of tonal adjustments', () => {
  expect(grainTone(0.6, 0, 0)).toBeCloseTo(0.6);
  expect(grainTone(0.6, -0.2, 1)).toBeCloseTo(0.7);
  expect(grainTone(0.4, -0.2, 1)).toBe(0);
});
