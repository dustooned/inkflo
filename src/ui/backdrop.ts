/**
 * The board around the page (Procreate-style): a quiet grid or dot field that pans and zooms with
 * the page, a soft vignette, and the page's shadow. Screen only; never in any export.
 */

export interface BackdropView {
  /** Stage size in CSS px. */
  width: number;
  height: number;
  /** Page origin on the stage (CSS px) and px per inch. */
  ox: number;
  oy: number;
  s: number;
  pageW: number;
  pageH: number;
  transparent?: boolean;
}

export interface BackdropStyle {
  board: string;
  grid: string;
  vignetteColor: string;
  shadow: string;
  kind: 'grid' | 'dots' | 'plain';
  /** 0–1 */
  strength: number;
  brightness: number;
  vignette: boolean;
}

/**
 * Grid spacing on screen: a quarter inch of page, doubled or halved so lines stay 14–56 px apart
 * at any zoom. Anchored to the page corner, so the grid moves with the page.
 */
export function gridStep(s: number): number {
  let step = 0.25 * s;
  while (step < 14) step *= 2;
  while (step > 56) step /= 2;
  return step;
}

export function drawBackdrop(g: CanvasRenderingContext2D, v: BackdropView, st: BackdropStyle): void {
  g.save();
  const mix = Math.abs(st.brightness);
  g.fillStyle = st.board;
  g.fillRect(0, 0, v.width, v.height);
  if (mix) {
    g.fillStyle = st.brightness > 0 ? '#fff' : '#000';
    g.globalAlpha = mix;
    g.fillRect(0, 0, v.width, v.height);
    g.globalAlpha = 1;
  }

  if (st.kind !== 'plain') {
    const step = gridStep(v.s);
    const major = step * 4;
    const x0 = (((v.ox % step) + step) % step) - step;
    const y0 = (((v.oy % step) + step) % step) - step;
    const isMajor = (pos: number, origin: number) => Math.abs(((pos - origin) / major) - Math.round((pos - origin) / major)) < 1e-3;
    const gridColor = mix > 0.3 ? (st.brightness > 0 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)') : st.grid;
    g.globalAlpha = st.strength;
    if (st.kind === 'grid') {
      g.lineWidth = 1;
      for (const pass of [false, true]) {
        g.strokeStyle = gridColor;
        g.globalAlpha = st.strength * (pass ? 1 : 0.55);
        g.beginPath();
        for (let x = x0; x <= v.width + step; x += step) {
          if (isMajor(x, v.ox) !== pass) continue;
          const px = Math.round(x) + 0.5;
          g.moveTo(px, 0);
          g.lineTo(px, v.height);
        }
        for (let y = y0; y <= v.height + step; y += step) {
          if (isMajor(y, v.oy) !== pass) continue;
          const py = Math.round(y) + 0.5;
          g.moveTo(0, py);
          g.lineTo(v.width, py);
        }
        g.stroke();
      }
    } else {
      g.fillStyle = gridColor;
      for (let x = x0; x <= v.width + step; x += step) {
        for (let y = y0; y <= v.height + step; y += step) {
          const r = isMajor(x, v.ox) && isMajor(y, v.oy) ? 1.8 : 1.1;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
  }

  if (st.vignette) {
    const cx = v.width / 2;
    const cy = v.height / 2;
    const rad = Math.hypot(cx, cy);
    const grad = g.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, st.vignetteColor);
    g.fillStyle = grad;
    g.fillRect(0, 0, v.width, v.height);
  }

  // the page's own shadow (the page paints over the rectangle itself)
  if (!v.transparent) {
    g.shadowColor = st.shadow;
    g.shadowBlur = 28;
    g.shadowOffsetY = 12;
    g.fillStyle = '#fff';
    g.fillRect(v.ox, v.oy, v.pageW * v.s, v.pageH * v.s);
  }
  g.restore();
}
