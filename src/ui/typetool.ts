import { newId, type Pt, type TextFrame } from '../doc/model';
import { BUNDLED_FONTS } from '../engine/lettering/fonts';
import { DEFAULT_TYPE, layoutType, TYPE_FACES, TYPE_PRESETS, typeFont, type Measure } from '../render/typeset';
import type { DeskCtx } from './desk';
import { h, seg } from './dom';
import { boxFrame, boxLocal, boxPoint, grabBox, moveBox, pinchBox, resizeOBox, rotateOBox, wrapDegrees, type BoxGrab, type OBox } from '../geom/xformbox';
import { drawTransformBox } from './selectiongesture';

/**
 * The Type tool (Caption desk): frames of set text for text-led pages. Drag on the page to make a
 * frame, drag a frame to move it, drag its corner to resize. The inspector holds the words and
 * every typographic setting, with presets for novel text, titles, poems and picture books.
 */
export function typeTool(ctx: DeskCtx) {
  const { page, studio } = ctx;
  let selectedId: string | null = null;
  let drag: { kind: 'create' | 'box'; grab?: BoxGrab; start: Pt; box?: OBox; before: TextFrame[] | undefined; id: string | null; readout?: { text: string; at: Pt } } | null = null;
  /** A two-finger transform in progress. */
  let pinching: { id: string; box: OBox; before: TextFrame[] | undefined } | null = null;
  const measureCanvas = document.createElement('canvas').getContext('2d')!;
  const measure = (f: TextFrame): Measure => (text, size) => {
    measureCanvas.font = typeFont(f, size);
    const c = measureCanvas as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in c) c.letterSpacing = `${f.tracking / 1000 * size}px`;
    return measureCanvas.measureText(text).width;
  };

  const frames = () => page.texts ?? [];
  const selected = () => frames().find((f) => f.id === selectedId) ?? null;
  /** A frame as an oriented box (inches), turned about its centre by its rotation. */
  const boxOf = (f: TextFrame): OBox => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, w: f.w, h: f.h, a: (f.rotation ?? 0) * Math.PI / 180, fx: 1, fy: 1 });
  const writeBox = (f: TextFrame, b: OBox): void => {
    f.w = b.w; f.h = b.h; f.x = b.cx - b.w / 2; f.y = b.cy - b.h / 2;
    const degrees = Math.round(wrapDegrees(b.a * 180 / Math.PI) * 100) / 100;
    if (degrees) f.rotation = degrees; else delete f.rotation;
  };
  /** Is `p` inside the frame as it is drawn (turned)? */
  const inside = (f: TextFrame, p: Pt) => { const q = boxLocal(boxOf(f), p); return Math.abs(q.x) <= f.w / 2 && Math.abs(q.y) <= f.h / 2; };

  /** Record the change from `before` to the page as it is now, as one undo step. */
  function commit(label: string, before: TextFrame[] | undefined): void {
    const after = structuredClone(page.texts);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    page.texts = structuredClone(before);
    if (!page.texts) delete page.texts;
    studio.editPage(page, label, ['texts'], (p) => {
      if (after?.length) p.texts = after;
      else delete p.texts;
    });
    ctx.chrome();
    ctx.request();
  }

  /** Change the selected frame live (while typing or dragging a slider), then commit once. */
  let liveBefore: TextFrame[] | undefined | null = null;
  function live(patch: Partial<TextFrame>, done: boolean, label: string): void {
    const f = selected();
    if (!f) return;
    if (liveBefore === null) liveBefore = structuredClone(page.texts);
    Object.assign(f, patch);
    ctx.request();
    if (done) {
      const before = liveBefore;
      liveBefore = null;
      commit(label, before);
    }
  }

  function remove(): void {
    const f = selected();
    if (!f) return;
    const before = structuredClone(page.texts);
    page.texts = frames().filter((x) => x.id !== f.id);
    selectedId = null;
    commit('Delete type frame', before);
  }

  function inspector(el: HTMLElement): void {
    const f = selected();
    if (!f) {
      el.append(h('div', { class: 'insp-head' }, h('div', { class: 'ins-title' }, 'Type')),
        h('div', { class: 'sec' }, h('p', { class: 'note' }, 'Drag on the page to make a frame of text, for illustrated novels, picture books, poems or a single-image story. Click a frame to edit it.')));
      return;
    }
    const field = (label: string, value: number, min: number, max: number, step: number, key: keyof TextFrame, unit = '') => {
      const input = h('input', { type: 'number', min, max, step, value: Number(value.toFixed(3)), 'aria-label': label });
      input.addEventListener('change', () => {
        const v = Math.max(min, Math.min(max, input.valueAsNumber));
        if (Number.isFinite(v)) live({ [key]: v } as Partial<TextFrame>, true, 'Type: ' + label.toLowerCase());
      });
      return h('label', { class: 'field' }, label + (unit ? ' (' + unit + ')' : ''), input);
    };
    const range = (label: string, value: number, min: number, max: number, step: number, key: keyof TextFrame, show: (v: number) => string) => {
      const out = h('b', {}, show(value));
      const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
      input.addEventListener('input', () => { out.textContent = show(input.valueAsNumber); live({ [key]: input.valueAsNumber } as Partial<TextFrame>, false, label); });
      input.addEventListener('change', () => live({ [key]: input.valueAsNumber } as Partial<TextFrame>, true, 'Type: ' + label.toLowerCase()));
      return h('label', { class: 'mini type-range' }, label, input, out);
    };
    const text = h('textarea', { class: 'type-text', rows: 7, 'aria-label': 'Text', spellcheck: true }, f.text);
    text.value = f.text;
    text.addEventListener('input', () => live({ text: text.value }, false, 'Edit text'));
    text.addEventListener('change', () => live({ text: text.value }, true, 'Edit text'));
    const font = h('select', { 'aria-label': 'Typeface' },
      h('optgroup', { label: 'Book faces' }, TYPE_FACES.map((t) => h('option', { value: t.id, selected: t.id === f.font }, t.label))),
      h('optgroup', { label: 'Comic and display' }, BUNDLED_FONTS.map((b) => h('option', { value: b.id, selected: b.id === f.font }, b.label))));
    font.addEventListener('change', () => live({ font: font.value }, true, 'Typeface'));
    const colour = h('input', { type: 'color', value: f.color, 'aria-label': 'Text colour' });
    colour.addEventListener('change', () => live({ color: colour.value }, true, 'Text colour'));
    const back = h('input', { type: 'color', value: f.background ?? '#ffffff', 'aria-label': 'Frame background' });
    back.addEventListener('change', () => live({ background: back.value }, true, 'Frame background'));
    const toggle = (label: string, on: boolean, patch: (v: boolean) => Partial<TextFrame>) =>
      h('button', { class: 'btn', type: 'button', 'aria-pressed': String(on), onclick: () => live(patch(!on), true, label) }, label);
    const layout = layoutType(f, 72, measure(f));
    el.append(
      h('div', { class: 'insp-head' }, h('div', { class: 'ins-title' }, 'Type frame'),
        layout.overset ? h('p', { class: 'warnline tight-top' }, 'More text than fits. Enlarge the frame, add a column or reduce the size.') : null),
      h('div', { class: 'sec stack' },
        h('h4', {}, 'Style'),
        h('div', { class: 'type-presets' }, TYPE_PRESETS.map((p) => h('button', { class: 'btn', type: 'button', onclick: () => live(p.style, true, 'Type style: ' + p.label) }, p.label))),
        h('label', { class: 'field' }, 'Text', text),
        h('p', { class: 'note flush' }, 'Each line break starts a new paragraph. An empty line adds space.')),
      h('div', { class: 'sec stack' },
        h('h4', {}, 'Characters'),
        h('label', { class: 'field' }, 'Typeface', font),
        h('div', { class: 'type-grid' }, field('Size', f.size, 4, 300, 0.5, 'size', 'pt'), h('label', { class: 'field' }, 'Colour', colour)),
        range('Leading', f.leading, 0.8, 2.6, 0.05, 'leading', (v) => v.toFixed(2) + '×'),
        range('Tracking', f.tracking, -50, 300, 5, 'tracking', (v) => String(Math.round(v))),
        h('div', { class: 'type-toggles' }, toggle('Bold', f.bold, (v) => ({ bold: v })), toggle('Italic', f.italic, (v) => ({ italic: v }))),
        seg<TextFrame['caps']>([{ id: 'none', label: 'Aa' }, { id: 'all', label: 'AA' }, { id: 'small', label: 'Small caps' }], f.caps, (v) => live({ caps: v }, true, 'Capitals'), 'Capitals')),
      h('div', { class: 'sec stack' },
        h('h4', {}, 'Paragraphs'),
        seg<TextFrame['align']>([{ id: 'left', label: 'Left', icon: 'alignLeft' }, { id: 'center', label: 'Centre', icon: 'alignCenter' }, { id: 'right', label: 'Right', icon: 'alignRight' }, { id: 'justify', label: 'Justify', icon: 'alignJustify' }], f.align, (v) => live({ align: v }, true, 'Alignment'), 'Alignment'),
        seg<TextFrame['valign']>([{ id: 'top', label: 'Top', icon: 'alignTop' }, { id: 'middle', label: 'Middle', icon: 'alignMiddle' }, { id: 'bottom', label: 'Bottom', icon: 'alignBottom' }], f.valign, (v) => live({ valign: v }, true, 'Vertical alignment'), 'Vertical alignment'),
        h('div', { class: 'type-grid' },
          field('First-line indent', f.indent, 0, 10, 0.25, 'indent', 'em'),
          field('Space between', f.paraSpace, 0, 5, 0.1, 'paraSpace', 'em')),
        h('label', { class: 'field' }, 'Drop cap', (() => {
          const s = h('select', { 'aria-label': 'Drop cap' }, [0, 2, 3, 4].map((n) => h('option', { value: n, selected: n === f.dropCap }, n ? n + ' lines' : 'None')));
          s.addEventListener('change', () => live({ dropCap: Number(s.value) }, true, 'Drop cap'));
          return s;
        })())),
      h('div', { class: 'sec stack' },
        h('h4', {}, 'Frame'),
        seg<string>([{ id: '1', label: '1 column' }, { id: '2', label: '2' }, { id: '3', label: '3' }], String(f.columns), (v) => live({ columns: Number(v) }, true, 'Columns'), 'Columns'),
        h('div', { class: 'type-grid' },
          field('Column gap', f.gutter, 0, 2, 0.05, 'gutter', 'in'),
          field('Inset', f.padding, 0, 2, 0.05, 'padding', 'in'),
          field('Left', f.x, -20, 60, 0.05, 'x', 'in'), field('Top', f.y, -20, 60, 0.05, 'y', 'in'),
          field('Width', f.w, 0.4, 60, 0.05, 'w', 'in'), field('Height', f.h, 0.3, 60, 0.05, 'h', 'in'),
          field('Rotation', f.rotation ?? 0, -180, 180, 1, 'rotation', '°')),
        h('div', { class: 'type-toggles' },
          toggle('Background', !!f.background, (v) => ({ background: v ? (back.value || '#ffffff') : null })), f.background ? back : null),
        h('button', { class: 'btn danger', type: 'button', onclick: remove }, 'Delete frame')),
    );
  }

  return {
    selected,
    select(id: string | null) { selectedId = id; },
    inspector,
    remove,
    down(p: Pt, e: Pick<PointerEvent, 'pointerType'> = { pointerType: 'mouse' }): void {
      const sel = selected();
      if (sel) {
        const scale = ctx.scale();
        const grab = grabBox(boxFrame(boxOf(sel), scale), p, scale, { touch: e.pointerType === 'touch' });
        if (grab && grab.kind !== 'move') { drag = { kind: 'box', grab, start: p, box: boxOf(sel), before: structuredClone(page.texts), id: sel.id }; return; }
      }
      const hit = [...frames()].reverse().find((f) => inside(f, p));
      if (hit) {
        selectedId = hit.id;
        drag = { kind: 'box', grab: { kind: 'move' }, start: p, box: boxOf(hit), before: structuredClone(page.texts), id: hit.id };
        ctx.chrome();
        return;
      }
      // a new frame, sized by dragging (or a sensible default on a click)
      const before = structuredClone(page.texts);
      const f: TextFrame = { ...DEFAULT_TYPE, id: newId('tx'), x: p.x, y: p.y, w: 0.01, h: 0.01, text: 'Type your text here. Each line break starts a new paragraph.' };
      page.texts = [...frames(), f];
      selectedId = f.id;
      drag = { kind: 'create', start: p, before, id: f.id };
    },
    move(p: Pt, e: Pick<PointerEvent, 'shiftKey' | 'altKey'> = { shiftKey: false, altKey: false }): void {
      const f = drag && frames().find((x) => x.id === drag!.id);
      if (!drag || !f) return;
      if (drag.kind === 'box' && drag.box && drag.grab) {
        const { box, grab, start } = drag;
        if (grab.kind === 'move') writeBox(f, moveBox(box, { x: p.x - start.x, y: p.y - start.y }, e.shiftKey));
        else if (grab.kind === 'rotate') {
          const r = rotateOBox(box, { x: box.cx, y: box.cy }, start, p, 0, e.shiftKey ? { step: 15, tol: 180 } : null);
          writeBox(f, r.box);
          drag.readout = { text: `${Math.round(r.degrees * 10) / 10}°`, at: p };
        } else if (grab.kind === 'resize') {
          const next = resizeOBox(box, grab.sx, grab.sy, start, p, { uniform: e.shiftKey, centre: e.altKey, min: 0.3 });
          writeBox(f, { ...next, w: Math.max(0.4, next.w) });
          drag.readout = { text: `${next.w.toFixed(2)} × ${next.h.toFixed(2)} in`, at: p };
        }
      } else if (drag.kind === 'create') {
        f.x = Math.min(drag.start.x, p.x); f.y = Math.min(drag.start.y, p.y);
        f.w = Math.abs(p.x - drag.start.x); f.h = Math.abs(p.y - drag.start.y);
      }
      ctx.request();
    },
    /** Two fingers on the selected frame: pinch resizes, twist turns, drift moves. Null ends it (one undo step). */
    pinch(g: { anchor: Pt; to: Pt; scale: number; turn: number } | null): boolean {
      if (!g) {
        const done = pinching;
        pinching = null;
        if (done) { studio.drawing = false; commit('Transform type frame', done.before); }
        return false;
      }
      const f = selected();
      if (!f) return false;
      pinching ??= { id: f.id, box: boxOf(f), before: structuredClone(page.texts) };
      if (pinching.id !== f.id) return false;
      studio.drawing = true;
      const next = pinchBox(pinching.box, g.anchor, { x: g.to.x - g.anchor.x, y: g.to.y - g.anchor.y }, g.scale, g.turn);
      if (next.w >= 0.4 && next.h >= 0.3) writeBox(f, next);
      ctx.request();
      return true;
    },
    /** Arrow keys: move the selected frame (inches), as one undo step. */
    nudge(dx: number, dy: number): boolean {
      const f = selected();
      if (!f) return false;
      const before = structuredClone(page.texts);
      f.x += dx; f.y += dy;
      commit('Nudge type frame', before);
      return true;
    },
    up(cancel: boolean): void {
      const d = drag;
      drag = null;
      if (!d) return;
      if (cancel) { page.texts = d.before; if (!page.texts) delete page.texts; ctx.request(); return; }
      const f = frames().find((x) => x.id === d.id);
      if (d.kind === 'create' && f && (f.w < 0.4 || f.h < 0.3)) {
        // a click: a comfortable frame at the click, kept on the page
        f.w = Math.min(3.5, page.widthIn - 0.5); f.h = 2;
        f.x = Math.max(0.25, Math.min(page.widthIn - f.w - 0.25, d.start.x));
        f.y = Math.max(0.25, Math.min(page.heightIn - f.h - 0.25, d.start.y));
      }
      const label = d.kind === 'create' ? 'Add type frame' : d.grab?.kind === 'move' ? 'Move type frame' : d.grab?.kind === 'rotate' ? 'Rotate type frame' : 'Resize type frame';
      commit(label, d.before);
    },
    overlay(g: CanvasRenderingContext2D, s: number): void {
      g.save();
      for (const f of frames()) {
        const on = f.id === selectedId;
        const box = boxOf(f);
        if (on) drawTransformBox(g, box, { scale: s, readout: drag?.id === f.id ? drag.readout : null });
        else {
          g.setLineDash([4, 4]);
          g.lineWidth = 1;
          g.strokeStyle = 'rgba(47,127,216,.55)';
          g.beginPath();
          ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sy], i) => { const q = boxPoint(box, sx * f.w / 2, sy * f.h / 2); if (i) g.lineTo(q.x * s, q.y * s); else g.moveTo(q.x * s, q.y * s); });
          g.closePath();
          g.stroke();
        }
        // overset: a red plus at the corner, as in page-layout apps
        if (layoutType(f, 72, measure(f)).overset) {
          const c = boxPoint(box, f.w / 2 - 18 / s, f.h / 2 - 18 / s);
          const x = c.x * s, y = c.y * s;
          g.setLineDash([]);
          g.fillStyle = '#c0392b';
          g.fillRect(x - 6, y - 6, 12, 12);
          g.fillStyle = '#fff';
          g.fillRect(x - 4, y - 1, 8, 2);
          g.fillRect(x - 1, y - 4, 2, 8);
        }
      }
      g.restore();
    },
  };
}
