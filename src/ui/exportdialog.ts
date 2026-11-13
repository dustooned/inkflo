import type { Studio } from '../app/studio';
import { sheetOf } from '../doc/model';
import { derivePanels } from '../geom/carve';
import { preflightPage } from '../geom/preflight';
import { kindById, printOf } from '../geom/printkinds';
import { exportCbz, exportMotionComic } from '../io/exports';
import { exportLayerFiles, exportPageFiles, exportPrintPdf, exportSpreadsPdf, planPrint, renderSeparation, SEPARATION_LABEL, tone, type FilesOptions, type Paper, type PrintMode, type Separation } from '../io/printexport';
import { exportPsd, psdPlan, type PsdMode } from '../io/psd';
import { DEFAULT_SCROLL_GAP, exportScroll, scrollPreview, type BreakArt, type ScrollOptions } from '../io/scroll';
import { IMAGE_ACCEPT, prepareAsset } from '../io/bookassets';
import { DEFAULT_MOTION, type MotionOptions } from '../io/to2dope';
import { exportTwoInks, inkMix, twoInkProof, type InkPair } from '../io/twoink';
import { letterBox } from '../render/caption';
import { download, h, seg, slug } from './dom';

type Tab = 'print' | 'files' | 'apps' | 'scroll';

const PRINT_MODES: { id: PrintMode; title: string; body: string }[] = [
  { id: 'shop', title: 'Print shop', body: 'A PDF of single pages with bleed and crop marks, trim and bleed boxes set. Blank pages are added if the binding needs them.' },
  { id: 'pod', title: 'Print-on-demand', body: 'An interior PDF: single pages with bleed, no marks (what KDP, IngramSpark and Lulu ask for).' },
  { id: 'booklet', title: 'Home printer booklet', body: 'Pages already in booklet order on Letter or A4, two to a side. Print double-sided, fold, staple. Comes with an instruction page.' },
  { id: 'minizine', title: 'Mini-zine (one sheet)', body: 'All 8 pages on one sheet with fold and cut lines, and how to fold it.' },
];

export interface ExportOpen {
  /** 1-based page the desk has open; the PSD range starts there. */
  page?: number;
}

/** The Export center: Print it (guided) and Export files (everything, by hand). */
export function openExport(studio: Studio, start: Tab = 'files', open: ExportOpen = {}): void {
  const book = studio.book;
  if (!book) return;
  const name = slug(book.title);
  const progress = h('div', { class: 'progress', role: 'status', 'aria-live': 'polite' });
  const buttons: HTMLButtonElement[] = [];
  let exporting = false;
  const busy = (on: boolean) => {
    exporting = on;
    buttons.forEach((b) => (b.disabled = on));
  };
  let tab: Tab = start;

  const run = async (label: string, make: () => Promise<Blob>, file: string) => {
    if (exporting) return;
    busy(true);
    progress.textContent = `${label}…`;
    try {
      await studio.saver.flush();
      const t0 = performance.now();
      const blob = await make();
      download(blob, file);
      progress.textContent = `${label}: ${(blob.size / 1024 / 1024).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s. Saved to your downloads as ${file}.`;
    } catch (e) {
      progress.textContent = `${label} failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy(false);
    }
  };
  const btn = (label: string, onclick: () => void, primary = false) => {
    const b = h('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', disabled: exporting, onclick }, label);
    buttons.push(b);
    return b;
  };
  const select = <T extends string | number>(label: string, options: [T, string][], value: T, set: (v: T) => void) => {
    const s = h('select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: String(v), selected: v === value }, l)));
    s.addEventListener('change', () => set((typeof value === 'number' ? Number(s.value) : s.value) as T));
    return h('label', { class: 'field' }, label, s);
  };
  const check = (label: string, value: boolean, set: (v: boolean) => void) => {
    const c = h('input', { type: 'checkbox', checked: value });
    c.addEventListener('change', () => set(c.checked));
    return h('label', { class: 'mini' }, c, label);
  };

  /** A small render of a page as an export will draw it (the same renderer, at preview size). */
  async function thumb(pageIndex: number, sep: Separation, opts: { background?: 'white' | 'transparent'; colour?: 'colour' | 'grey' | 'hard'; borders?: boolean; art?: boolean } = {}): Promise<HTMLCanvasElement> {
    const page = book!.pages[pageIndex]!;
    const art = opts.art === false ? null : studio.ensureArt(page);
    try {
      if (art) await studio.residency.pin(art);
      const c = await renderSeparation(page, art, 110 / page.widthIn, book!, sep, opts.background ?? 'white', opts.borders ?? true);
      if (opts.colour && sep !== 'all' || opts.colour === 'grey') tone(c, opts.colour ?? 'colour');
      c.classList.add('export-thumb');
      return c;
    } finally { if (art) studio.residency.unpin(art); }
  }

  // ---- Print it

  const pr = { mode: 'shop' as PrintMode, paper: 'letter' as Paper, marks: true };
  function printTab(): HTMLElement {
    const spec = printOf(book!);
    const kind = kindById(spec.kind);
    const plan = planPrint(book!, pr.mode);
    const sheet = sheetOf(book!);
    const issues = book!.pages.flatMap((p, i) => {
      const warnings = preflightPage(book!, p, derivePanels(p), (l) => letterBox(l, sheet, p.widthIn, p.heightIn))
        .filter((c) => c.level === 'warn' && !/No ink/.test(c.text));
      return warnings.length ? [{ page: p, number: i + 1, warnings }] : [];
    });
    const cards = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'How it is printed' },
      PRINT_MODES.map((m) => h('button', { type: 'button', role: 'radio', class: 'option modecard', 'aria-checked': String(m.id === pr.mode), onclick: () => { pr.mode = m.id; render(); } },
        h('div', {}, h('b', {}, m.title), h('p', {}, m.body)))));
    const settings = h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:end' });
    if (pr.mode === 'booklet' || pr.mode === 'minizine') settings.append(select('Paper', [['letter', 'Letter'], ['a4', 'A4']], pr.paper, (v) => (pr.paper = v)));
    if (pr.mode === 'shop') settings.append(check('Crop marks', pr.marks, (v) => (pr.marks = v)));
    const order = h('div', { class: 'order', 'aria-label': 'Page order' },
      plan.order.map((s) => h('span', { class: `chip${s === null ? ' blank' : ''}`, title: s === null ? 'Blank page, added' : `Page ${s + 1}` }, s === null ? 'blank' : String(s + 1))));
    const file = `${name}-${pr.mode === 'shop' ? 'print' : pr.mode === 'pod' ? 'interior' : pr.mode}.pdf`;
    return h('div', { class: 'stack' },
      h('p', { class: 'note', style: 'margin:0' }, `${kind ? kind.label : 'Custom'}: ${book!.pages[0]!.widthIn}″ × ${book!.pages[0]!.heightIn}″, ${spec.bleed}″ bleed. Change it in the Print desk.`),
      cards, settings,
      h('div', {}, h('h4', { class: 'label' }, 'Page order'), order),
      plan.message ? h('p', { class: 'warnline' }, plan.message) : null,
      issues.length
        ? h('details', {}, h('summary', {}, issues.length + (issues.length === 1 ? ' page to review' : ' pages to review')),
          ...issues.map(({ page, number, warnings }) => h('section', { class: 'print-review-page' },
            h('button', { class: 'btn', type: 'button', onclick: () => {
              d.close();
              location.hash = '#desk/' + book!.id + '/' + page.id + '/print';
            } }, 'Review page ' + number),
            h('ul', { class: 'check' }, warnings.map((c) => h('li', { class: 'warn' }, c.text))))))
        : h('p', { class: 'note', style: 'margin:0' }, 'Preflight: nothing to fix.'),
      h('div', { style: 'display:flex;justify-content:flex-end' },
        btn('Make the PDF', () => void run('Print PDF', () => exportPrintPdf(studio, { ...pr }, (m) => (progress.textContent = m)), file), true)),
    );
  }

  // ---- Export files

  const fo: FilesOptions = { format: 'png', seps: ['all'], background: 'white', colour: 'colour', borders: true, range: { from: 1, to: book.pages.length } };
  let dpi = book.dpi;
  const motion: MotionOptions = { ...DEFAULT_MOTION };
  const currentPage = open.page && open.page >= 1 && open.page <= book.pages.length
    ? Math.round(open.page)
    : Math.max(1, book.pages.findIndex((p) => p.id === book.lastPageId) + 1);
  const scroll: ScrollOptions = { range: { from: 1, to: book.pages.length }, gap: DEFAULT_SCROLL_GAP, background: '#ffffff' };
  // Page-break art: a book image between pages (and optionally after the last), kept for the dialog
  const breakSet = { key: '' as string, fit: 'width' as BreakArt['fit'], end: false };
  const breakImages = new Map<string, ImageBitmap>();
  async function breakArt(): Promise<BreakArt | null> {
    if (!breakSet.key) return null;
    let image = breakImages.get(breakSet.key);
    if (!image) {
      const bytes = await studio.store.getAsset(breakSet.key);
      if (!bytes) return null;
      image = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
      breakImages.set(breakSet.key, image);
    }
    return { image, fit: breakSet.fit, end: breakSet.end };
  }
  function scrollTab(): HTMLElement {
    const field = (label: string, value: number, min: number, max: number, apply: (v: number) => void) => {
      const input = h('input', { type: 'number', value, min, max, step: 1, 'aria-label': label });
      input.addEventListener('change', () => {
        const v = Math.round(Math.max(min, Math.min(max, input.valueAsNumber || min)));
        input.value = String(v); apply(v); refreshPreview();
      });
      return h('label', { class: 'field' }, label, input);
    };
    const color = h('input', { type: 'color', value: scroll.background ?? '#ffffff', 'aria-label': 'Scroll background colour' });
    color.addEventListener('change', () => { scroll.background = color.value; refreshPreview(); });
    const preview = h('div', { class: 'scroll-preview', 'aria-live': 'polite' }, h('p', { class: 'note' }, 'Preparing preview…'));
    let revision = 0;
    async function refreshPreview(): Promise<void> {
      const id = ++revision;
      try {
        const canvas = await scrollPreview(studio, { ...scroll, range: { ...scroll.range }, breakArt: await breakArt() }, 140);
        if (id !== revision || !preview.isConnected) return;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Preview of the first pages of the scroll');
        preview.replaceChildren(canvas, h('p', { class: 'note' }, 'First pages as readers will scroll them'));
      } catch (error) {
        if (id === revision) preview.replaceChildren(h('p', { class: 'warnline' }, error instanceof Error ? error.message : String(error)));
      }
    }
    const assets = book!.assets ?? [];
    const artSelect = h('select', { 'aria-label': 'Page-break art' },
      h('option', { value: '' }, 'None (plain gap)'),
      assets.map((a) => h('option', { value: a.key, selected: a.key === breakSet.key }, a.name)));
    artSelect.addEventListener('change', () => { breakSet.key = artSelect.value; render(); });
    const addArt = h('input', { type: 'file', accept: IMAGE_ACCEPT, 'aria-label': 'Add page-break art image' });
    addArt.addEventListener('change', async () => {
      const file = addArt.files?.[0];
      if (!file) return;
      try {
        const { asset, bytes } = await prepareAsset(file);
        await studio.addAssets([asset], new Map([[asset.key, bytes]]));
        breakSet.key = asset.key;
        render();
      } catch (error) { progress.textContent = error instanceof Error ? error.message : String(error); }
    });
    const breakControls = breakSet.key ? h('div', { class: 'spread-links' },
      seg<BreakArt['fit']>([{ id: 'width', label: 'Full width' }, { id: 'natural', label: 'Actual size' }], breakSet.fit, (v) => { breakSet.fit = v; render(); }, 'Break art size'),
      check('Also after the last page', breakSet.end, (v) => { breakSet.end = v; refreshPreview(); })) : null;
    queueMicrotask(() => void refreshPreview());
    return h('div', { class: 'scroll-tab' },
      h('div', { class: 'stack' },
        h('h3', {}, 'Vertical scroll'),
        h('p', { class: 'note' }, 'Stack pages into one episode. The ZIP includes numbered PNG strips, a responsive index.html, and an episode.json for custom sites.'),
        h('div', { class: 'export-app-fields' },
          field('First page', scroll.range.from, 1, book!.pages.length, (v) => (scroll.range.from = v)),
          field('Last page', scroll.range.to, 1, book!.pages.length, (v) => (scroll.range.to = v)),
          field('Space between pages (px)', scroll.gap, 0, 960, (v) => (scroll.gap = v))),
        h('div', { class: 'spread-links' },
          select('Scroll background', [['white', 'White'], ['transparent', 'Transparent PNG'], ['custom', 'Custom colour']], scroll.background === null ? 'transparent' : scroll.background === '#ffffff' ? 'white' : 'custom', (v) => {
            scroll.background = v === 'transparent' ? null : v === 'white' ? '#ffffff' : '#d9e2df'; render();
          }), scroll.background && scroll.background !== '#ffffff' ? color : null),
        h('fieldset', { class: 'break-art' },
          h('legend', {}, 'Page-break art'),
          h('p', { class: 'note' }, 'A divider, footer or “to be continued” banner drawn in the break after each page. It is written into the same strips as the pages, so it scrolls seamlessly on the web.'),
          h('div', { class: 'spread-links' }, h('label', { class: 'field' }, 'Image', artSelect), h('label', { class: 'field' }, 'Add an image', addArt)),
          breakControls),
        btn('Download scroll package', () => void (async () => {
          const art = await breakArt();
          await run('Vertical scroll', () => exportScroll(studio, { ...scroll, range: { ...scroll.range }, breakArt: art }, (m) => (progress.textContent = m)), `${name}-scroll.zip`);
        })(), true)),
      preview);
  }
  const psd = { mode: 'art' as PsdMode, dpi: book.dpi, from: currentPage, to: currentPage };
  function appsTab(): HTMLElement {
    const summary = h('section', { class: 'psd-summary', 'aria-label': 'What will be exported', 'aria-live': 'polite' });
    const plan = () => psdPlan(book!, { from: psd.from, to: psd.to }, psd.mode, psd.dpi, name);
    const refresh = () => {
      const p = plan();
      downloadBtn.disabled = exporting || p.tooLarge || !p.pages.length;
      downloadBtn.textContent = p.pages.length > 1 ? 'Download ZIP of PSDs' : 'Download layered PSD';
      summary.replaceChildren(
        h('dl', {},
          h('dt', {}, 'Pages'), h('dd', {}, p.pagesLabel),
          h('dt', {}, 'Size'), h('dd', {}, p.trimLabel),
          h('dt', {}, 'Pixels'), h('dd', {}, p.pixelsLabel),
          h('dt', {}, 'File'), h('dd', {}, h('code', {}, p.file))),
        h('h4', { class: 'label' }, psd.mode === 'template' ? 'Drawing template contains' : 'Keep artwork contains'),
        h('ul', {}, p.contents.map((c) => h('li', {}, c))));
      if (p.tooLarge) summary.append(h('p', { class: 'warnline' }, 'Too large for browser export at ' + psd.dpi + ' dpi. Choose a lower resolution.'));
      // what the first page will look like in the other app: artwork, or the empty template
      const id = ++psdRevision;
      const first = (p.pages[0] ?? 1) - 1;
      void thumb(first, 'all', { art: psd.mode === 'art' }).then((c) => {
        if (id !== psdRevision || !summary.isConnected) return;
        summary.prepend(h('figure', { class: 'psd-thumb' }, c, h('figcaption', {}, psd.mode === 'template' ? 'Template: layout and lettering' : 'Page ' + (first + 1))));
      });
    };
    let psdRevision = 0;
    const pageInput = (label: string, key: 'from' | 'to') => {
      const input = h('input', { type: 'number', 'aria-label': label, min: 1, max: book!.pages.length, step: 1, value: psd[key] });
      input.addEventListener('change', () => {
        psd[key] = Math.max(1, Math.min(book!.pages.length, Math.round(input.valueAsNumber || currentPage)));
        input.value = String(psd[key]);
        refresh();
      });
      return h('label', { class: 'field' }, label, input);
    };
    const downloadBtn = btn('Download layered PSD', () => {
      const { from, to, mode, dpi: resolution } = psd;
      const p = plan();
      void run('Layered PSD', () => exportPsd(studio, { from, to }, mode, resolution, (m) => (progress.textContent = m)), p.file).then(refresh);
    }, true);
    refresh();
    return h('div', { class: 'stack' },
      h('div', {}, h('h3', {}, 'Export for drawing'), h('p', { class: 'note' }, 'Plan and letter here, then keep drawing in Procreate, Photoshop, Affinity or Clip Studio Paint. One page downloads a layered PSD; a range downloads a ZIP of PSDs.')),
      seg<PsdMode>([{ id: 'art', label: 'Keep artwork' }, { id: 'template', label: 'Drawing template' }], psd.mode, (v) => { psd.mode = v; render(); }, 'PSD contents'),
      h('div', { class: 'export-app-fields' }, pageInput('First page', 'from'), pageInput('Last page', 'to'),
        select('Resolution', [[book!.dpi, book!.dpi + ' dpi (book)'], ...[150, 300, 600].filter((n) => n !== book!.dpi).map((n): [number, string] => [n, n + ' dpi'])], psd.dpi, (v) => { psd.dpi = v; refresh(); })),
      summary,
      h('p', { class: 'note' }, 'In Procreate, use Gallery → Import. In Photoshop, Affinity or Clip Studio Paint, open the PSD as a document. Panel masks are written as group masks; check how your app treats them before relying on clipping.'),
      downloadBtn);
  }
  const inks: InkPair = ['#d49a55', '#243755'];
  function twoInkOptions(from: HTMLInputElement, to: HTMLInputElement): HTMLElement {
    const chart = h('div', { class: 'ink-chart', 'aria-label': 'Ink tint chart' });
    const preview = h('div', { class: 'ink-proof' });
    const levels = [0, 0.25, 0.5, 0.75, 1];
    let revision = 0;
    let timer = 0;
    const fields = inks.map((value, i) => {
      const colour = h('input', { type: 'color', value });
      colour.addEventListener('input', () => { inks[i] = colour.value; update(); });
      return h('label', { class: 'mini' }, colour, i === 0 ? 'Ink 1 · midtones' : 'Ink 2 · shadows');
    });
    const details = h('details', { class: 'option two-ink' },
      h('summary', {}, 'Two-ink print'),
      h('p', {}, 'Convert finished art to two ink densities. The ZIP includes both grayscale plates and an overprint proof at the page range and resolution above.'),
      h('div', { class: 'spread-links' }, fields),
      h('div', { class: 'two-ink-preview' }, h('div', {},
        h('p', {}, 'Tint chart · Ink 1 across, Ink 2 down'), chart), preview),
      btn('Export two-ink plates', () => {
        const pair: InkPair = [...inks];
        const resolution = dpi;
        const range = { ...fo.range! };
        void run('Two-ink plates', () => exportTwoInks(studio, pair, resolution, range, (m) => (progress.textContent = m)), `${name}-two-ink.zip`);
      }));
    function update(): void {
      chart.replaceChildren(h('span', {}),
        ...levels.map((n) => h('span', {}, Math.round(n * 100) + '%')),
        ...levels.flatMap((b) => [h('span', {}, Math.round(b * 100) + '%'), ...levels.map((a) => {
          const label = 'Ink 1 ' + Math.round(a * 100) + '%, ink 2 ' + Math.round(b * 100) + '%';
          return h('span', { class: 'ink-swatch', title: label, 'aria-label': label, style: 'background:rgb(' + inkMix(inks, a, b).join(',') + ')' });
        })]));
      clearTimeout(timer);
      const id = ++revision;
      if (!details.open) return;
      timer = window.setTimeout(async () => {
        const first = Math.min(fo.range!.from, fo.range!.to);
        const index = Math.max(0, Math.min(book!.pages.length - 1, Math.floor(first) - 1));
        const page = book!.pages[index]!;
        try {
          const canvas = await twoInkProof(studio, page, [...inks]);
          if (id !== revision || !details.isConnected) return;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', 'Two-ink proof of page ' + (index + 1));
          preview.replaceChildren(canvas, h('p', {}, 'Page ' + (index + 1) + ' · overprint proof'));
        } catch (error) {
          if (id === revision) preview.textContent = error instanceof Error ? error.message : String(error);
        }
      }, 120);
    }
    details.addEventListener('toggle', update);
    from.addEventListener('change', update);
    to.addEventListener('change', update);
    return details;
  }

  function filesTab(): HTMLElement {
    const sepBoxes = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
      (Object.keys(SEPARATION_LABEL) as Separation[]).map((s) => check(SEPARATION_LABEL[s], fo.seps.includes(s), (on) => {
        fo.seps = on ? [...fo.seps, s] : fo.seps.filter((x) => x !== s);
      })));
    const from = h('input', { type: 'number', min: 1, max: book!.pages.length, value: fo.range!.from, 'aria-label': 'From page', style: 'width:60px' });
    const to = h('input', { type: 'number', min: 1, max: book!.pages.length, value: fo.range!.to, 'aria-label': 'To page', style: 'width:60px' });
    from.addEventListener('change', () => (fo.range = { from: Number(from.value) || 1, to: fo.range!.to }));
    to.addEventListener('change', () => (fo.range = { from: fo.range!.from, to: Number(to.value) || book!.pages.length }));
    const range = h('label', { class: 'field' }, 'Pages', h('span', { class: 'page-range' }, from, h('span', {}, 'to'), to));
    // preview: the first page of the range as each ticked kind of image
    const filesPreview = h('div', { class: 'export-previews', 'aria-live': 'polite' });
    let filesRevision = 0;
    const refreshFiles = () => {
      const id = ++filesRevision;
      const first = Math.max(0, Math.min(book!.pages.length - 1, Math.min(fo.range!.from, fo.range!.to) - 1));
      void Promise.all(fo.seps.slice(0, 5).map(async (sep) => {
        const c = await thumb(first, sep, { background: fo.background, colour: fo.colour, borders: fo.borders });
        return h('figure', {}, c, h('figcaption', {}, SEPARATION_LABEL[sep]));
      })).then((figs) => {
        if (id !== filesRevision) return;
        filesPreview.replaceChildren(...(figs.length ? figs : [h('p', { class: 'note' }, 'Tick at least one kind of page to preview it.')]));
      });
    };
    queueMicrotask(refreshFiles);
    const pageImages = h('div', { class: 'option', style: 'flex-direction:column;align-items:stretch' },
        h('b', {}, 'Page images'),
        h('p', {}, 'Finished pages, or separations for colourists, inkers and letterers: inks only, colours only, pencils only, lettering only. Each kind goes in its own folder.'),
        sepBoxes,
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px' },
          select('Format', [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']], fo.format, (v) => (fo.format = v)),
          select('Resolution', [[book!.dpi, `${book!.dpi} dpi (book)`], ...([150, 72] as const).filter((d) => d !== book!.dpi).map((d): [number, string] => [d, `${d} dpi (screen)`])], dpi, (v) => (dpi = v)),
          select('Separations on', [['white', 'White'], ['transparent', 'Transparent']], fo.background, (v) => (fo.background = v)),
          select('Colour', [['colour', 'Colour'], ['grey', 'Greyscale'], ['hard', 'Inks: hard black']], fo.colour, (v) => (fo.colour = v)),
          range),
        h('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:8px' },
          check('Panel borders on inks', fo.borders, (v) => (fo.borders = v)),
          h('span', { style: 'flex:1' }),
          btn('Export', () => {
            if (!fo.seps.length) {
              progress.textContent = 'Tick at least one kind of page.';
              return;
            }
            void run('Page images', () => exportPageFiles(studio, { ...fo, dpi }, (m) => (progress.textContent = m)), `${name}-pages.zip`);
          }, true)),
        filesPreview);
    // any option change refreshes the preview
    pageImages.addEventListener('change', () => queueMicrotask(refreshFiles));
    return h('div', { class: 'stack' },
      pageImages,
      h('div', { class: 'option' },
        h('div', {}, h('b', {}, 'Every layer separately (.zip)'), h('p', {}, 'Each layer as a transparent, page-sized PNG in page / panel / layer folders, so they stack back up in any app.')),
        btn('Export', () => void run('Layers', () => exportLayerFiles(studio, fo.range, (m) => (progress.textContent = m)), `${name}-layers.zip`))),
      twoInkOptions(from, to),
      h('div', { class: 'option' },
        h('div', {}, h('b', {}, 'Reader spreads (.pdf)'), h('p', {}, `Pages side by side as the reader sees them${printOf(book!).rtl ? ' (right to left)' : ''}, the cover alone. For proofing.`)),
        btn('Export', () => void run('Spreads', () => exportSpreadsPdf(studio, (m) => (progress.textContent = m)), `${name}-spreads.pdf`))),
      h('div', { class: 'option' },
        h('div', {}, h('b', {}, 'Comic archive (.cbz)'), h('p', {}, `Every page at ${book!.dpi} dpi with ComicInfo.xml, for comic readers.`)),
        btn('Export', () => void run('Comic archive', () => exportCbz(studio, (m) => (progress.textContent = m)), `${name}.cbz`))),
      h('div', { class: 'option', style: 'flex-direction:column;align-items:stretch' },
        h('div', { style: 'display:flex;gap:12px;align-items:flex-start' },
          h('div', {}, h('b', {}, 'Motion comic for 2Dope (.2dope)'),
            h('p', {}, 'A 2Dope project: each page a comp with one layer per panel and balloon, and a camera that reads the book panel by panel.')),
          btn('Export', () => void run('Motion comic', () => exportMotionComic(studio, motion, (m) => (progress.textContent = m)), `${name}-motion.2dope`))),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:10px' },
          select('Frame', [['wide', '16:9 video'], ['page', 'Page shape']], motion.frame, (v) => (motion.frame = v)),
          select('Resolution', [[100, '100 dpi'], [150, '150 dpi'], [200, '200 dpi']], motion.dpi, (v) => (motion.dpi = v)),
          select('Per panel', [[1.2, '1.2 s'], [2, '2 s'], [3, '3 s'], [4, '4 s']], motion.panelHold, (v) => (motion.panelHold = v)),
          select('Frame rate', [[12, '12 fps'], [24, '24 fps'], [30, '30 fps']], motion.fps, (v) => (motion.fps = v)),
          select('Balloons', [['live', 'Live captions'], ['image', 'Images']], motion.captions, (v) => (motion.captions = v)))),
      h('div', { class: 'option' },
        h('div', {}, h('b', {}, 'Book file (.inkflo)'), h('p', {}, 'The whole book with every stroke, to back up or open on another device.')),
        btn('Export', () => void run('Book file', () => studio.exportInkflo(), `${name}.inkflo`))),
    );
  }

  const body = h('div', { class: 'content' });
  function render(): void {
    buttons.length = 0;
    body.replaceChildren(
      seg<Tab>([{ id: 'print', label: 'Print it' }, { id: 'files', label: 'Export files' }, { id: 'scroll', label: 'Vertical scroll' }, { id: 'apps', label: 'Export for drawing' }], tab, (v) => { tab = v; render(); }, 'Export center'),
      tab === 'print' ? printTab() : tab === 'apps' ? appsTab() : tab === 'scroll' ? scrollTab() : filesTab(),
      progress,
    );
  }

  const d = h('dialog', { class: 'exportcenter', 'aria-label': 'Export center' },
    h('header', {}, h('h2', {}, `Export “${book.title}”`)),
    body,
    h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Close')),
  );
  d.addEventListener('close', () => { d.remove(); for (const image of breakImages.values()) image.close(); breakImages.clear(); });
  document.body.append(d);
  render();
  d.showModal();
}
