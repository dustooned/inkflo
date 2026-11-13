import type { Studio } from '../app/studio';
import { DEFAULT_SHEET, PT, sheetOf, type Letter, type LetterSheet, type Page } from '../doc/model';
import { applyStyle } from '../engine/lettering/styles';
import { defaultCaption } from '../engine/lettering/spec';
import { drawBalloons } from '../render/page';
import { lettersReady } from '../render/fonts';
import { BUNDLED_FONTS } from '../engine/lettering/fonts';
import { characterStyle, renameSpeaker, speakers } from '../geom/lettering';
import { TARGETS } from '../geom/readability';
import { askText, h } from './dom';

/**
 * The book's lettering style sheet: house sizes in pt, readability limits, default font and
 * character styles. Every change is one undo step on the book.
 */
export function openStyleSheet(studio: Studio, onChange: () => void): void {
  const book = studio.book;
  if (!book) return;

  const commitSheet = (label: string, next: LetterSheet) => {
    const before = structuredClone(book.lettering);
    const after = structuredClone(next);
    studio.run({ label, do: () => (book.lettering = structuredClone(after)), undo: () => (book.lettering = structuredClone(before)) });
    onChange();
    render();
  };

  /**
   * The sheet as lettering will look: Small, Body and Big in the house font, and a balloon for
   * each character style, drawn by the page renderer at the book's page size.
   */
  let previewRevision = 0;
  function preview(sheet: LetterSheet): HTMLElement {
    const page = book!.pages[0];
    const pageW = page?.widthIn ?? 6.625, pageH = page?.heightIn ?? 10.187;
    const samples: Letter[] = (['small', 'body', 'big'] as const).map((size, i) => {
      const cap = defaultCaption((0.2 + 0.3 * i) * pageW * PT, 0.6 * PT, 'speech');
      cap.text = size === 'small' ? 'Small words' : size === 'body' ? 'Body text' : 'BIG!';
      cap.size = size;
      cap.font = sheet.font;
      cap.tails = [];
      return { id: 'sample-' + size, cap };
    });
    const chars = Object.keys(sheet.characters).slice(0, 3);
    chars.forEach((who, i) => {
      const st = characterStyle(sheet, who);
      let cap = defaultCaption((0.2 + 0.3 * i) * pageW * PT, 1.75 * PT, 'speech');
      cap.text = who + '!';
      cap.font = sheet.font;
      cap.tails = [];
      if (st) cap = applyStyle(cap, st);
      samples.push({ id: 'char-' + i, cap });
    });
    const rows = chars.length ? 2 : 1;
    const width = 520, scale = width / pageW;
    const canvas = h('canvas', { class: 'sheet-preview', width, height: Math.round(rows * 1.15 * scale), role: 'img', 'aria-label': 'Preview of the lettering sizes' + (chars.length ? ' and character styles' : '') });
    const id = ++previewRevision;
    void lettersReady(samples.map((l) => l.cap)).then(() => {
      if (id !== previewRevision) return;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#fbf8f1';
      g.fillRect(0, 0, canvas.width, canvas.height);
      drawBalloons(g, { widthIn: pageW, heightIn: pageH, balloons: samples } as unknown as Page, scale, sheet);
    });
    return h('figure', { class: 'sheet-preview-box' }, canvas, h('figcaption', { class: 'note' }, 'Shown at print size relative to your page. Character styles below the sizes.'));
  }

  const body = h('div', { class: 'content' });
  function render(): void {
    const s = sheetOf(book!);
    const ptField = (label: string, value: number, set: (v: number) => LetterSheet) => {
      const input = h('input', { type: 'number', min: 3, max: 96, step: 0.5, value, 'aria-label': label, style: 'width:80px' });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= 3 && v <= 96) commitSheet(`Style sheet: ${label}`, set(v));
      });
      return h('label', { class: 'field' }, label, h('span', {}, input, ' pt'));
    };
    const font = h('select', { 'aria-label': 'House font' }, BUNDLED_FONTS.map((f) => h('option', { value: f.id, selected: f.id === s.font }, `${f.label} — ${f.role}`)));
    font.addEventListener('change', () => commitSheet('Style sheet: font', { ...s, font: font.value }));
    const chars = Object.entries(s.characters);
    const named = speakers(book!);
    body.replaceChildren(
      preview(s),
      h('p', { class: 'note', style: 'margin:0' }, 'Sizes are the printed type size. Balloons follow these unless they have their own scale.'),
      h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px' },
        ptField('Small', s.sizes.small, (v) => ({ ...s, sizes: { ...s.sizes, small: v } })),
        ptField('Body', s.sizes.body, (v) => ({ ...s, sizes: { ...s.sizes, body: v } })),
        ptField('Big', s.sizes.big, (v) => ({ ...s, sizes: { ...s.sizes, big: v } }))),
      h('div', { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:10px' },
        ptField('At risk below', s.warnPt, (v) => ({ ...s, warnPt: v })),
        ptField('Won’t read below', s.minPt, (v) => ({ ...s, minPt: Math.min(v, s.warnPt) }))),
      h('label', { class: 'field' }, 'House font', font),
      h('div', { class: 'stack' }, h('span', { class: 'hint' }, 'Also check lettering at'),
        TARGETS.filter((t) => t.name !== 'Print').map((t) => {
          const box = h('input', { type: 'checkbox', checked: (s.checks ?? []).includes(t.name) });
          box.addEventListener('change', () => {
            const checks = new Set(s.checks ?? []);
            if (box.checked) checks.add(t.name);
            else checks.delete(t.name);
            commitSheet(`Check at ${t.name}`, { ...s, checks: [...checks] });
          });
          return h('label', { class: 'mini' }, box, t.name);
        })),
      h('h3', { style: 'margin:6px 0 0;font-size:13px' }, 'Characters'),
      chars.length
        ? h('div', { class: 'stack' }, chars.map(([who, st]) =>
            h('div', { class: 'option', style: 'align-items:center' },
              h('div', {}, h('b', {}, who), h('p', {}, `${BUNDLED_FONTS.find((f) => f.id === (st.look as { font?: string }).font)?.label ?? 'House font'} · ${(st.look as { style?: string }).style ?? 'speech'}`)),
              h('button', { class: 'btn', type: 'button', onclick: async () => {
                const to = await askText('Rename speaker', 'New name (renames script lines and balloons too)', who, 'Rename');
                if (!to || to.trim().toUpperCase() === who) return;
                const before = { lettering: structuredClone(book!.lettering), pages: book!.pages.map((p) => ({ beats: structuredClone(p.beats), balloons: structuredClone(p.balloons) })) };
                renameSpeaker(book!, who, to);
                const after = { lettering: structuredClone(book!.lettering), pages: book!.pages.map((p) => ({ beats: structuredClone(p.beats), balloons: structuredClone(p.balloons) })) };
                const apply = (x: typeof before) => {
                  book!.lettering = structuredClone(x.lettering);
                  book!.pages.forEach((p, i) => Object.assign(p, structuredClone(x.pages[i]!)));
                };
                studio.run({ label: `Rename ${who}`, do: () => apply(after), undo: () => apply(before) }, true);
                onChange();
                render();
              } }, 'Rename'),
              h('button', { class: 'btn danger', type: 'button', onclick: () => {
                const characters = { ...s.characters };
                delete characters[who];
                commitSheet(`Remove ${who}’s style`, { ...s, characters });
              } }, 'Remove'))))
        : h('p', { class: 'note' }, named.length ? `Speakers in the script: ${named.join(', ')}. Select one of their balloons and choose “Save as character style”.` : 'No speakers yet. Name them in the script (“MAYA: …”).'),
      h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn', type: 'button', onclick: () => commitSheet('Reset style sheet sizes', { ...s, sizes: { ...DEFAULT_SHEET.sizes }, warnPt: DEFAULT_SHEET.warnPt, minPt: DEFAULT_SHEET.minPt }) }, 'Reset sizes')),
    );
  }
  render();
  const d = h('dialog', { 'aria-label': 'Lettering style sheet' },
    h('header', {}, h('h2', {}, 'Lettering style sheet')),
    body,
    h('footer', {}, h('button', { class: 'btn primary', type: 'button', onclick: () => d.close() }, 'Done')));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}
