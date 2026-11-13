import { newId, type Pt, type TextFrame } from '../doc/model';
import { BUNDLED_FONTS } from '../engine/lettering/fonts';
import { DEFAULT_TYPE, layoutType, TYPE_FACES, TYPE_PRESETS, typeFont, type Measure } from '../render/typeset';
import type { DeskCtx } from './desk';
import { h, seg } from './dom';

/**
 * The Type tool (Caption desk): frames of set text for text-led pages. Drag on the page to make a
 * frame, drag a frame to move it, drag its corner to resize. The inspector holds the words and
 * every typographic setting, with presets for novel text, titles, poems and picture books.
 */
export function typeTool(ctx: DeskCtx) {
  const { page, studio } = ctx;
  let selectedId: string | null = null;
  let drag: { kind: 'create' | 'move' | 'resize'; start: Pt; before: TextFrame[] | undefined; id: string | null } | null = null;
  const measureCanvas = document.createElement('canvas').getContext('2d')!;
  const measure = (f: TextFrame): Measure => (text, size) => {
    measureCanvas.font = typeFont(f, size);
    const c = measureCanvas as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in c) c.letterSpacing = `${f.tracking / 1000 * size}px`;
    return measureCanvas.measureText(text).width;
  };

  const frames = () => page.texts ?? [];
  const selected = () => frames().find((f) => f.id === selectedId) ?? null;
  const handleAt = (f: TextFrame, p: Pt) => Math.hypot(p.x - (f.x + f.w), p.y - (f.y + f.h)) < 12 / ctx.scale();
  const inside = (f: TextFrame, p: Pt) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h;

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
        layout.overset ? h('p', { class: 'warnline', style: 'margin:4px 0 0' }, 'More text than fits. Enlarge the frame, add a column or reduce the size.') : null),
      h('div', { class: 'sec stack' },
        h('h4', {}, 'Style'),
        h('div', { class: 'type-presets' }, TYPE_PRESETS.map((p) => h('button', { class: 'btn', type: 'button', onclick: () => live(p.style, true, 'Type style: ' + p.label) }, p.label))),
        h('label', { class: 'field' }, 'Text', text),
        h('p', { class: 'note', style: 'margin:0' }, 'Each line break starts a new paragraph. An empty line adds space.')),
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
        seg<TextFrame['align']>([{ id: 'left', label: 'Left' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Right' }, { id: 'justify', label: 'Justify' }], f.align, (v) => live({ align: v }, true, 'Alignment'), 'Alignment'),
        seg<TextFrame['valign']>([{ id: 'top', label: 'Top' }, { id: 'middle', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }], f.valign, (v) => live({ valign: v }, true, 'Vertical alignment'), 'Vertical alignment'),
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
    down(p: Pt): void {
      const sel = selected();
      if (sel && handleAt(sel, p)) { drag = { kind: 'resize', start: p, before: structuredClone(page.texts), id: sel.id }; return; }
      const hit = [...frames()].reverse().find((f) => inside(f, p));
      if (hit) {
        selectedId = hit.id;
        drag = { kind: 'move', start: p, before: structuredClone(page.texts), id: hit.id };
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
    move(p: Pt): void {
      const f = drag && frames().find((x) => x.id === drag!.id);
      if (!drag || !f) return;
      const b = drag.before?.find((x) => x.id === f.id);
      if (drag.kind === 'move' && b) { f.x = b.x + p.x - drag.start.x; f.y = b.y + p.y - drag.start.y; }
      else if (drag.kind === 'resize' && b) { f.w = Math.max(0.4, b.w + p.x - drag.start.x); f.h = Math.max(0.3, b.h + p.y - drag.start.y); }
      else if (drag.kind === 'create') {
        f.x = Math.min(drag.start.x, p.x); f.y = Math.min(drag.start.y, p.y);
        f.w = Math.abs(p.x - drag.start.x); f.h = Math.abs(p.y - drag.start.y);
      }
      ctx.request();
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
      commit(d.kind === 'create' ? 'Add type frame' : d.kind === 'move' ? 'Move type frame' : 'Resize type frame', d.before);
    },
    overlay(g: CanvasRenderingContext2D, s: number): void {
      g.save();
      for (const f of frames()) {
        const on = f.id === selectedId;
        g.setLineDash(on ? [] : [4, 4]);
        g.lineWidth = on ? 1.5 : 1;
        g.strokeStyle = on ? '#2f7fd8' : 'rgba(47,127,216,.55)';
        g.strokeRect(f.x * s, f.y * s, f.w * s, f.h * s);
        if (on) {
          g.fillStyle = '#fff';
          g.fillRect((f.x + f.w) * s - 5, (f.y + f.h) * s - 5, 10, 10);
          g.strokeRect((f.x + f.w) * s - 5, (f.y + f.h) * s - 5, 10, 10);
        }
        // overset: a red plus at the corner, as in page-layout apps
        if (layoutType(f, 72, measure(f)).overset) {
          const x = (f.x + f.w) * s - 18, y = (f.y + f.h) * s - 18;
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
