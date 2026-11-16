import { describe, expect, it } from 'vitest';
import { blankEdgeRows, clampQuality, clampSlice, clampWidth, formatBytes, formatInfo, setupMatching, SCROLL_SETUPS, stripCount } from './webformat';

/** An RGBA image from rows of [r,g,b,a] colours (one colour per whole row, except where `art` marks a pixel). */
function image(width: number, rows: number[][], art: Record<number, number> = {}): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((c, y) => {
    for (let x = 0; x < width; x++) data.set(c, (y * width + x) * 4);
  });
  for (const [y, x] of Object.entries(art)) data.set([0, 0, 0, 255], (Number(y) * width + x) * 4);
  return data;
}
const paper = [255, 254, 249, 255];

describe('web formats and limits', () => {
  it('clamps width, slice height and quality into their limits', () => {
    expect(clampWidth(100)).toBe(320);
    expect(clampWidth(99999)).toBe(2400);
    expect(clampWidth(Number.NaN)).toBe(800);
    expect(clampSlice(10)).toBe(400);
    expect(clampSlice(1e6)).toBe(4000);
    expect(clampQuality(5)).toBe(1);
    expect(clampQuality(0)).toBe(0.3);
    expect(clampQuality(Number.NaN)).toBe(0.85);
  });
  it('knows which formats can be see-through or lossy', () => {
    expect(formatInfo('jpeg').alpha).toBe(false);
    expect(formatInfo('webp')).toMatchObject({ alpha: true, lossy: true });
    expect(formatInfo('png').lossy).toBe(false);
  });
  it('recognises a setup from its numbers', () => {
    const s = SCROLL_SETUPS[1]!;
    expect(setupMatching(s)?.id).toBe(s.id);
    expect(setupMatching({ ...s, width: 1000 })).toBeNull();
    // PNG has no quality, so quality never makes a PNG setup "custom"
    expect(setupMatching({ ...SCROLL_SETUPS[0]!, quality: 0.5 })?.id).toBe('standard');
  });
  it('counts strips and formats sizes', () => {
    expect(stripCount(1280, 1280)).toBe(1);
    expect(stripCount(1281, 1280)).toBe(2);
    expect(stripCount(0, 1280)).toBe(1);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});

describe('blankEdgeRows', () => {
  it('finds empty rows at the top and bottom', () => {
    const rows = [paper, paper, paper, paper, paper, paper, paper, paper, paper, paper];
    const data = image(4, rows, { 3: 1, 6: 2 });
    expect(blankEdgeRows(data, 4, 10)).toEqual({ top: 3, bottom: 3 });
  });
  it('leaves a margin when asked', () => {
    const data = image(4, Array(10).fill(paper), { 4: 0 });
    expect(blankEdgeRows(data, 4, 10, 2)).toEqual({ top: 2, bottom: 3 });
    expect(blankEdgeRows(data, 4, 10, 99)).toEqual({ top: 0, bottom: 0 });
  });
  it('treats transparent rows as empty whatever their hidden colour', () => {
    const rows = [[0, 0, 0, 0], [9, 9, 9, 0], [0, 0, 0, 255], [0, 0, 0, 255], [1, 2, 3, 0]];
    expect(blankEdgeRows(image(2, rows), 2, 5)).toEqual({ top: 2, bottom: 1 });
  });
  it('trims nothing from a fully empty image', () => {
    expect(blankEdgeRows(image(3, Array(6).fill(paper)), 3, 6)).toEqual({ top: 0, bottom: 0 });
  });
  it('does not trim art that starts on the first row', () => {
    expect(blankEdgeRows(image(3, Array(5).fill(paper), { 0: 1, 4: 1 }), 3, 5)).toEqual({ top: 0, bottom: 0 });
  });
});
