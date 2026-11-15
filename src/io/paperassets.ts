import { hash01 } from '../engine/core/rng';
import { assetKey } from './capture';
import { encodePng, makeCanvas } from './canvasops';

export const PAPER_PRESETS = [
  { id: 'newsprint', label: 'Comic newsprint', base: [239, 230, 209], seed: 607 },
  { id: 'cold-press', label: 'Cold press paper', base: [248, 245, 235], seed: 908 },
  { id: 'recycled-kraft', label: 'Recycled kraft', base: [199, 164, 116], seed: 1217 },
  { id: 'thin-riso', label: 'Thin riso paper', base: [234, 234, 231], seed: 459 },
] as const;

type PaperPreset = typeof PAPER_PRESETS[number];
const smooth = (v: number) => v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);

function noise(seed: number, x: number, y: number, step: number, salt: number): number {
  const ix = Math.floor(x / step), iy = Math.floor(y / step);
  const u = smooth(x / step - ix), v = smooth(y / step - iy);
  const row = (j: number) => {
    const i = j * 32_768 + ix;
    return hash01(seed, i, salt) * (1 - u) + hash01(seed, i + 1, salt) * u;
  };
  return row(iy) * (1 - v) + row(iy + 1) * v;
}

/** Paint a full-sheet paper asset. The grains are generated from a seed and never tile on the page. */
function renderPaper(preset: PaperPreset, g: CanvasRenderingContext2D): void {
  const { width, height } = g.canvas;
  const { id, base, seed } = preset;
  const data = g.createImageData(width, height);
  const strength = { newsprint: 12, 'cold-press': 17, 'recycled-kraft': 24, 'thin-riso': 17 }[id];
  const thin = id === 'thin-riso';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const broad = noise(seed, x, y, id === 'cold-press' ? 13 : 21, 9);
      const fine = noise(seed, thin ? x / 2.5 : x, y, id === 'cold-press' ? 5 : 3, 29);
      const speck = hash01(seed, i, 17);
      const pit = thin ? 0 : id === 'cold-press'
        ? smooth((0.55 - fine) * 2.7) * broad
        : smooth((speck - 0.91) * 10) * broad;
      const tone = strength * ((broad - 0.5) * 0.7 + (fine - 0.5) * 0.55 + (speck - 0.5) * 0.34 - pit * 0.9);
      data.data[i * 4] = base[0] + tone;
      data.data[i * 4 + 1] = base[1] + tone;
      data.data[i * 4 + 2] = base[2] + tone;
      data.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(data, 0, 0);
  if (id !== 'recycled-kraft') return;
  g.strokeStyle = '#624322';
  g.lineCap = 'round';
  for (let i = 0; i < 2_500; i++) {
    const x = hash01(seed, i, 33) * width, y = hash01(seed, i, 34) * height;
    const angle = hash01(seed, i, 35) * 2 * Math.PI;
    const size = 1 + 8 * hash01(seed, i, 36);
    const dx = Math.cos(angle) * size, dy = Math.sin(angle) * size;
    g.globalAlpha = 0.08 + 0.23 * hash01(seed, i, 37);
    g.lineWidth = 0.45 + 0.65 * hash01(seed, i, 38);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + dx * 0.5 - dy * 0.2, y + dy * 0.5 + dx * 0.2, x + dx, y + dy);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Fit the book's page proportions while keeping the texture source within the asset budget. */
export async function makePaperAsset(preset: PaperPreset, page: { widthIn: number; heightIn: number }) {
  const edge = 2048;
  const scale = edge / Math.max(page.widthIn, page.heightIn);
  const canvas = makeCanvas(Math.max(1, Math.round(page.widthIn * scale)), Math.max(1, Math.round(page.heightIn * scale)));
  try {
    renderPaper(preset, canvas.getContext('2d')!);
    const bytes = await encodePng(canvas);
    return { asset: { key: assetKey(bytes), name: preset.label, width: canvas.width, height: canvas.height }, bytes };
  } finally { canvas.width = canvas.height = 0; }
}
