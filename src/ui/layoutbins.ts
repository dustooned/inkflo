import type { Page, Pt } from '../doc/model';
import { newPage } from '../doc/model';
import { derivePanels, presetCuts } from '../geom/carve';
import { applyPageTemplate, capturePageTemplate, type PageTemplate } from '../geom/pagetemplates';
import { renderThumb } from '../render/page';
import { binPanel } from './binpanel';
import { askText, h, toast } from './dom';
import { readLayoutBins, readTemplates, STANDARD, writeTemplates } from './pagetemplates';

/**
 * Layout bins: the device's saved layouts plus the built-in grids. Tap one to lay out the whole
 * page; drag one onto a panel to split just that panel with it. Saved layouts live on this device
 * (like page templates), so they're there in every book.
 */
type LayoutItem = PageTemplate & { key: string };

export interface LayoutHost {
  page: Page;
  stage: HTMLElement;
  toPage(e: { clientX: number; clientY: number }): Pt;
  /** Lay out the whole page (one undo step). */
  applyPage(t: PageTemplate): void;
  /** Split the panel under `at` (one undo step); false when there is no panel to split. */
  splitPanel(t: PageTemplate, at: Pt): boolean;
}

const keyed = (t: PageTemplate): LayoutItem => ({ ...t, key: 'saved:' + t.name.toLowerCase() });

export function layoutBins(host: LayoutHost) {
  const { page } = host;
  const built: LayoutItem[] = STANDARD.map(([id, name]) => {
    const example = { ...newPage(), widthIn: page.widthIn, heightIn: page.heightIn };
    example.cuts = presetCuts(example, id);
    return { ...capturePageTemplate(example, name), key: 'builtin:' + id };
  });
  const thumbs = new Map<string, HTMLCanvasElement>();

  function place(item: LayoutItem, at: Pt | null): void {
    const panels = derivePanels(page);
    if (at && panels.length > 1) {
      if (!host.splitPanel(item, at)) toast('Drop a layout onto a panel to split it, or tap it to lay out the whole page. Moved panels can’t be split.');
      return;
    }
    host.applyPage(item);
  }

  function saveCurrent(): void {
    void askText('Save this layout to a bin', 'Name', '', 'Save').then((raw) => {
      const name = raw?.trim().slice(0, 72);
      if (!name) return;
      const list = readTemplates();
      const at = list.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
      const bin = panel.bin();
      const t: PageTemplate = { ...capturePageTemplate(page, name), ...(bin && bin !== 'Unsorted' ? { bin } : {}) };
      list.splice(at >= 0 ? at : list.length, at >= 0 ? 1 : 0, t);
      if (!writeTemplates(list)) { toast('This device could not save the layout.'); return; }
      thumbs.delete(keyed(t).key);
      panel.refresh(true);
      panel.say(at >= 0 ? `Replaced “${name}”.` : `Saved “${name}”. Tap it to use it, or drag it onto a panel.`);
    });
  }

  const panel = binPanel<LayoutItem>({
    id: 'layouts', title: 'Layout bins', noun: 'layout',
    read: () => ({ bins: readLayoutBins(), items: readTemplates().map(keyed) }),
    write(_label, next) {
      if (!writeTemplates(next.items.map(({ key: _k, ...t }) => t), next.bins)) toast('This device could not save that change.');
    },
    builtIn: { bin: 'Built-in', items: built },
    thumb(item) {
      let c = thumbs.get(item.key);
      if (!c) {
        const example = { ...newPage(), widthIn: page.widthIn, heightIn: page.heightIn };
        applyPageTemplate(example, item);
        c = renderThumb(example, null, 72);
        c.setAttribute('aria-hidden', 'true');
        thumbs.set(item.key, c);
      }
      const copy = document.createElement('canvas');
      copy.width = c.width; copy.height = c.height;
      copy.style.cssText = c.style.cssText;
      copy.getContext('2d')!.drawImage(c, 0, 0);
      return copy;
    },
    place,
    tip: 'Tap for the whole page · drag onto a panel to split it',
    empty: 'Tap + Save to keep this page’s layout here. Saved layouts are on this device, in every book.',
    menu: (item) => [
      { label: 'Use for the whole page', run: () => host.applyPage(item) },
    ],
    head: () => [h('button', { class: 'btn', type: 'button', title: 'Save this page’s layout into the open bin', onclick: saveCurrent }, '+ Save')],
    remove: (item) => {
      if (!writeTemplates(readTemplates().filter((t) => keyed(t).key !== item.key))) throw new Error('This device could not remove the layout.');
    },
  }, host.stage, host.toPage);

  return { el: panel.el, refresh: () => panel.refresh(), dispose: panel.dispose };
}
