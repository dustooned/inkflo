import type { Beat, Pt } from '../doc/model';
import { h } from './dom';

type Card = NonNullable<Beat['card']>;

function paint(canvas: HTMLCanvasElement, card: Card): void {
  const g = canvas.getContext('2d')!;
  const { width: w, height: hgt } = canvas;
  g.clearRect(0, 0, w, hgt);
  g.fillStyle = '#263347';
  g.strokeStyle = g.fillStyle;
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const points of card.strokes) {
    if (!points.length) continue;
    const a = points[0]!;
    g.beginPath();
    if (points.length === 1) {
      g.arc(a.x * w, a.y * hgt, 1.25, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    g.moveTo(a.x * w, a.y * hgt);
    for (const p of points.slice(1)) g.lineTo(p.x * w, p.y * hgt);
    g.stroke();
  }
}

export function cardCanvas(card: Card, interactive = false): HTMLCanvasElement {
  const canvas = h('canvas', {
    class: interactive ? 'card-sketch editable' : 'card-sketch',
    width: 480,
    height: Math.round(480 / card.ratio),
    role: 'img',
    'aria-label': interactive ? 'Draw a thumbnail sketch with a pointer' : 'Thumbnail sketch',
  });
  paint(canvas, card);
  return canvas;
}

export function sketchCard(card: Card, save: (card: Card) => void): void {
  const draft = structuredClone(card);
  const canvas = cardCanvas(draft, true);
  const ratio = h('input', { type: 'number', min: 0.25, max: 4, step: 'any', value: draft.ratio, 'aria-label': 'Sketch width divided by height', required: true });
  const status = h('p', { class: 'note', role: 'status' });
  let drawing: { id: number; points: Pt[] } | null = null;
  const point = (e: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  function addPoints(e: PointerEvent): void {
    if (!drawing || drawing.id !== e.pointerId) return;
    const samples = e.getCoalescedEvents?.();
    for (const event of samples?.length ? samples : [e]) {
      const p = point(event);
      const last = drawing.points.at(-1)!;
      if (drawing.points.length < 512 && Math.hypot(last.x - p.x, last.y - p.y) >= 0.001) drawing.points.push(p);
    }
    paint(canvas, draft);
  }
  const resize = () => {
    if (!ratio.reportValidity()) return false;
    draft.ratio = ratio.valueAsNumber;
    canvas.height = Math.round(canvas.width / draft.ratio);
    paint(canvas, draft);
    return true;
  };
  ratio.addEventListener('change', resize);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drawing) return;
    if (draft.strokes.length >= 100) {
      status.textContent = 'This card holds 100 strokes. Undo a stroke or clear the card to keep drawing.';
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drawing = { id: e.pointerId, points: [point(e)] };
    draft.strokes.push(drawing.points);
    paint(canvas, draft);
  });
  canvas.addEventListener('pointermove', addPoints);
  canvas.addEventListener('lostpointercapture', () => { drawing = null; });
  canvas.addEventListener('pointerup', (e) => { addPoints(e); drawing = null; });
  canvas.addEventListener('pointercancel', () => { drawing = null; });
  const action = (label: string, onclick: () => void) => h('button', { class: 'btn', type: 'button', onclick }, label);
  const d = h('dialog', { class: 'sketch-dialog', 'aria-label': 'Sketch beat' },
    h('header', {}, h('h2', {}, 'Sketch beat')),
    h('div', { class: 'content stack' },
      h('label', { class: 'mini' }, 'Width ÷ height', ratio), canvas, status,
      h('div', { class: 'spread-links' },
        action('Undo stroke', () => { draft.strokes.pop(); status.textContent = ''; paint(canvas, draft); }),
        action('Clear sketch', () => { draft.strokes = []; status.textContent = ''; paint(canvas, draft); }))),
    h('footer', {}, action('Cancel', () => d.close()), action('Save sketch', () => {
      if (!resize()) return;
      d.close();
      save(draft);
    })));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}
