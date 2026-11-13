import type { ScreenTone } from '../doc/model';

const TILE = 96;
const tiles = new Map<string, HTMLCanvasElement>();

/** One repeat cell in document coordinates. Patterns remain in phase across export strips. */
function tileFor({ shape, density, color }: ScreenTone): HTMLCanvasElement {
  const key = `${shape}:${density}:${color}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const tile = document.createElement('canvas');
  tile.width = tile.height = TILE;
  const g = tile.getContext('2d')!;
  g.scale(TILE, TILE);
  g.fillStyle = color;
  if (density >= 1) g.fillRect(0, 0, 1, 1);
  else if (shape === 'line' || shape === 'cross') {
    const width = shape === 'line' ? density : 1 - Math.sqrt(1 - density);
    g.fillRect(0, (1 - width) / 2, 1, width);
    if (shape === 'cross') g.fillRect((1 - width) / 2, 0, width, 1);
  } else {
    // Switch to paper holes at heavy coverage so the marks can reach solid black.
    const holes = shape !== 'square' && density > 0.5;
    const coverage = holes ? 1 - density : density;
    if (holes) {
      g.fillRect(0, 0, 1, 1);
      g.globalCompositeOperation = 'destination-out';
    }
    const positions = holes ? [[0, 0], [0, 1], [1, 0], [1, 1]] : [[0.5, 0.5]];
    for (const [x, y] of positions) {
      const size = Math.sqrt(coverage);
      g.beginPath();
      if (shape === 'dot') g.arc(x!, y!, size / Math.sqrt(Math.PI), 0, 2 * Math.PI);
      else if (shape === 'square') g.rect(x! - size / 2, y! - size / 2, size, size);
      else {
        const r = size / Math.sqrt(2);
        g.moveTo(x!, y! - r); g.lineTo(x! + r, y!); g.lineTo(x!, y! + r); g.lineTo(x! - r, y!); g.closePath();
      }
      g.fill();
    }
  }
  if (tiles.size >= 100) tiles.clear();
  tiles.set(key, tile);
  return tile;
}

export function drawScreenTone(g: CanvasRenderingContext2D, tone: ScreenTone, w: number, h: number, scale: number): void {
  if (!tone.density) return;
  g.save();
  const matrix = g.getTransform();
  const pixelsPerUnit = Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  if (scale * pixelsPerUnit / tone.frequency < 2.5) {
    // Blend unresolved dots to their average at low zoom to avoid false moiré bands.
    g.fillStyle = tone.color;
    g.globalAlpha *= tone.density;
  } else {
    const pattern = g.createPattern(tileFor(tone), 'repeat')!;
    pattern.setTransform(new DOMMatrix().rotate(tone.angle).scale(scale / (tone.frequency * TILE)));
    g.fillStyle = pattern;
  }
  if (tone.region) {
    g.beginPath();
    tone.region.forEach(({ x, y }, i) => i ? g.lineTo(x * scale, y * scale) : g.moveTo(x * scale, y * scale));
    g.closePath();
    g.fill('evenodd');
  } else g.fillRect(0, 0, w, h);
  g.restore();
}
