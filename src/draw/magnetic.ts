import type { Pt } from '../doc/model';

export interface EdgeMap { width: number; height: number; scale: number; strength: Uint8Array }

export function buildEdges(data: Uint8ClampedArray, width: number, height: number, scale: number): EdgeMap {
  const grey = new Uint8Array(width * height);
  const alpha = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) {
    const p = i * 4;
    alpha[i] = data[p + 3]!;
    grey[i] = 255 - (255 - (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!)) * alpha[i]! / 255;
  }
  const strength = new Uint8Array(grey.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const dx = i + 1, sx = i - 1, dy = i + width, sy = i - width;
    strength[i] = Math.min(255, Math.max(Math.hypot(grey[dx]! - grey[sx]!, grey[dy]! - grey[sy]!),
      Math.hypot(alpha[dx]! - alpha[sx]!, alpha[dy]! - alpha[sy]!) * 0.6));
  }
  return { width, height, scale, strength };
}

/** An edge-biased minimum-cost path through a narrow corridor along the user's gesture. */
export function magneticPath(map: EdgeMap, gesture: readonly Pt[], reach: number): Pt[] {
  if (gesture.length < 2) return [...gesture];
  const { width, height, scale, strength } = map;
  const radius = Math.max(2, Math.min(22, Math.round(reach * scale)));
  const edge = (x: number, y: number) => {
    const px = Math.round(x), py = Math.round(y);
    return px < 0 || py < 0 || px >= width || py >= height ? 0 : strength[py * width + px]!;
  };
  const samples: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 1; i < gesture.length; i++) {
    const a = gesture[i - 1]!, b = gesture[i]!;
    const dx = (b.x - a.x) * scale, dy = (b.y - a.y) * scale;
    const length = Math.hypot(dx, dy);
    if (length < 0.1) continue;
    const n = Math.min(1800, Math.ceil(length / 2));
    for (let j = 0; j <= n; j++) {
      if (j === 0 && samples.length) continue;
      samples.push({ x: a.x * scale + dx * j / n, y: a.y * scale + dy * j / n, nx: -dy / length, ny: dx / length });
    }
    if (samples.length > 7000) return [...gesture];
  }
  if (samples.length < 2) return [...gesture];
  const count = radius * 2 + 1;
  const back = new Uint8Array(count * samples.length);
  let cost = new Float32Array(count);
  let next = new Float32Array(count);
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!;
    for (let j = 0; j < count; j++) {
      const d = j - radius;
      const signal = edge(p.x + p.nx * d, p.y + p.ny * d);
      const weight = (d / radius) ** 2 * 0.85 - signal / 255 * 2.2;
      let best = Infinity, from = j;
      for (let k = Math.max(0, j - 3); k <= Math.min(count - 1, j + 3); k++) {
        const score = cost[k]! + 0.14 * (k - j) ** 2;
        if (score < best) { best = score; from = k; }
      }
      next[j] = best + weight;
      back[i * count + j] = from;
    }
    [cost, next] = [next, cost];
  }
  let j = radius;
  for (let k = 0; k < count; k++) if (cost[k]! < cost[j]!) j = k;
  const path = new Array<Pt>(samples.length);
  for (let i = samples.length - 1; i >= 0; i--) {
    const { x, y, nx, ny } = samples[i]!;
    const d = j - radius;
    path[i] = { x: (x + nx * d) / scale, y: (y + ny * d) / scale };
    j = back[i * count + j]!;
  }
  return path;
}
