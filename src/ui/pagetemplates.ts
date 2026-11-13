import type { Page } from '../doc/model';
import { newPage } from '../doc/model';
import { derivePanels, presetCuts, type Preset } from '../geom/carve';
import { applyPageTemplate, capturePageTemplate, type PageTemplate } from '../geom/pagetemplates';
import { renderThumb } from '../render/page';
import { askText, confirmDialog, h, toast } from './dom';

const KEY = 'inkflo.page-templates.v1';
const STANDARD: [Preset, string][] = [
  ['splash', 'Splash'], ['rows2', 'Two rows'], ['tier3', 'Three tiers'],
  ['grid4', 'Four panels'], ['grid6', 'Six panels'], ['grid9', 'Nine panels'],
];

function readTemplates(): PageTemplate[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((entry: PageTemplate) => {
      if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || !Array.isArray(entry.cuts) || !entry.layout) return false;
      const range = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max;
      const { gutter, border, curve } = entry.layout;
      if (!range(gutter, 2) || !range(border, 0.5) || !range(curve, 5) || !Number.isInteger(curve)) return false;
      if (entry.downbeat && (!range(entry.downbeat.x, 1) || !range(entry.downbeat.y, 1))) return false;
      if (entry.grid) {
        const valid = (weights: number[]) => Array.isArray(weights) && weights.length >= 1 && weights.length <= 12 &&
          weights.every((n) => Number.isFinite(n) && n >= 0.01 && n <= 100);
        if (!valid(entry.grid.columns) || !valid(entry.grid.rows) || !range(entry.grid.gutter, 0.6)) return false;
      }
      const points = (value: unknown) => Array.isArray(value) && value.length >= 2 && value.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      return entry.cuts.every((c) => c && (c.mode === 'panel' || c.mode === 'across') && points(c.pts) && (!c.extended || points(c.extended)) && (!c.handles || (points(c.handles) && c.handles.length === 2)));
    });
  } catch {
    return [];
  }
}

export function openPageTemplates(page: Page, apply: (template: PageTemplate) => void, editing: boolean): void {
  let saved = readTemplates();
  const built = STANDARD.map(([id, name]) => {
    const example = { ...newPage(), widthIn: page.widthIn, heightIn: page.heightIn };
    example.cuts = presetCuts(example, id);
    return capturePageTemplate(example, name);
  });
  const gallery = h('div', { class: 'content' });
  const d = h('dialog', { class: 'template-dialog', 'aria-label': 'Page templates' },
    h('header', {}, h('h2', {}, editing ? 'Page templates' : 'New page from template')),
    gallery,
    h('footer', {},
      editing ? h('button', { class: 'btn', type: 'button', onclick: () => void save() }, 'Save this layout') : null,
      h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close')));

  async function save(): Promise<void> {
    const name = (await askText('Save this layout', 'Template name', '', 'Save'))?.trim().slice(0, 72);
    if (!name) return;
    const existing = saved.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0 && !(await confirmDialog('Replace the saved template?', 'Pages already using it keep their own layout.', 'Replace'))) return;
    const next = [...saved];
    next.splice(existing >= 0 ? existing : next.length, existing >= 0 ? 1 : 0, capturePageTemplate(page, name));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      saved = next;
      render();
      toast('Template saved on this device.');
    } catch {
      toast('This device could not save the template.');
    }
  }

  function cards(list: PageTemplate[], removable = false): HTMLElement {
    return h('div', { class: 'template-grid' }, list.map((template, index) => {
      const example = { ...newPage(), widthIn: page.widthIn, heightIn: page.heightIn };
      applyPageTemplate(example, template);
      const preview = renderThumb(example, null, 132);
      preview.setAttribute('aria-hidden', 'true');
      const count = derivePanels(example).length;
      return h('div', { class: 'template-card' },
        h('button', { type: 'button', 'aria-label': 'Use ' + template.name, onclick: async () => {
          if (editing && page.cuts.length && !(await confirmDialog('Replace this page layout?', 'The new layout changes the cuts and panel style. Undo restores the previous layout.', 'Use template'))) return;
          d.close();
          apply(template);
        } }, preview, h('strong', {}, template.name), h('small', {}, count + (count === 1 ? ' panel' : ' panels'))),
        removable ? h('button', { type: 'button', class: 'template-remove', 'aria-label': 'Remove template ' + template.name, onclick: async () => {
          if (!(await confirmDialog('Remove this template?', 'Pages made with it keep their layout.', 'Remove'))) return;
          const next = saved.filter((_, i) => i !== index);
          try {
            localStorage.setItem(KEY, JSON.stringify(next));
            saved = next;
            render();
          } catch {
            toast('This device could not remove the template.');
          }
        } }, '×') : null);
    }));
  }

  function render(): void {
    gallery.replaceChildren(
      h('h3', {}, 'Saved layouts'),
      saved.length ? cards(saved, true) : h('p', { class: 'note' }, 'Save a custom layout from the Layout desk to reuse it here.'),
      h('h3', {}, 'Built-in layouts'),
      cards(built),
    );
  }
  d.addEventListener('close', () => d.remove());
  render();
  document.body.append(d);
  d.showModal();
}
