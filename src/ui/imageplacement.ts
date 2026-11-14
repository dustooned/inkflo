import { askToReduce } from './reducechoice';
import { findLayer, newLayer, type BookAsset, type LayerGroup, type PlacedImage, type Pt } from '../doc/model';
import { mapPanelPoint, panelAt } from '../geom/carve';
import { invert, type Mat } from '../engine/core/selxform';
import { groupAt, groupLabel, insertIndex, panelForGroup } from '../geom/groups';
import { fitImage, hitsImage, imageDpi, imagePoint, type PlacementBox } from '../geom/placement';
import { decodePngInto, makeCanvas } from '../io/canvasops';
import { IMAGE_ACCEPT, ImportCancelled, readAssetImage } from '../io/bookassets';
import { touchLayer } from '../draw/residency';
import { cleanCutout, toImageUnits } from '../geom/collage';
import { createMarquee } from './marquee';
import type { DeskCtx } from './desk';
import { h, toast } from './dom';

export function imagePlacement(ctx: DeskCtx, selected: () => string | null, select: (id: string) => void) {
  const { page, art, studio } = ctx;
  let drag: { id: string; start: Pt; before: PlacedImage; next: PlacedImage; resize: boolean; inverse: Mat | null } | null = null;

  const box = (group: LayerGroup): PlacementBox => {
    const panel = panelForGroup(ctx.panels(), group);
    return (panel?.source ?? panel)?.bbox ?? { x0: 0, y0: 0, x1: page.widthIn, y1: page.heightIn };
  };
  const matrixForGroup = (group: LayerGroup) => panelForGroup(ctx.panels(), group)?.transform?.matrix;
  const inverseForGroup = (group: LayerGroup) => { const m = matrixForGroup(group); return m ? invert(m) : null; };

  const get = () => {
    const id = selected();
    const found = id ? findLayer(page, id) : null;
    return found?.layer.image ? { ...found, image: found.layer.image } : null;
  };

  // Collage: draw around the part of the selected image to keep.
  let cutting = false;
  let cutPoint: Pt | null = null;
  const marquee = createMarquee(ctx, (poly) => {
    cutting = false;
    const item = get();
    if (!item) return;
    const inverse = inverseForGroup(item.group);
    const cutout = cleanCutout(poly.map((q) => toImageUnits(item.image, mapPanelPoint(q, inverse))));
    if (!cutout) { toast('Draw a larger outline around the part to keep.'); return; }
    commit(item.layer.id, { ...item.image, cutout }, 'Cut out piece');
    ctx.hint('Piece cut out. Tear its edge or add a paper border in the inspector.', { timeout: 3500 });
  });
  const startCut = () => {
    cutting = !cutting;
    marquee.clear();
    if (cutting) ctx.hint('Draw around the part of the image to keep. Esc cancels.');
    ctx.chrome();
    ctx.request();
  };

  function duplicatePiece(): void {
    const item = get();
    if (!item) return;
    const { layer, group, image } = item;
    const source = art.planes[layer.id];
    if (!source?.width) { toast('This image is not loaded yet. Try again in a moment.'); return; }
    const copy = newLayer(layer.type);
    copy.name = layer.name + ' copy';
    copy.fillRef = false;
    copy.image = { ...image, ...(image.cutout ? { cutout: image.cutout.map((q) => ({ ...q })) } : {}), x: image.x + 0.2, y: image.y + 0.2 };
    const canvas = makeCanvas(source.width, source.height);
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    art.planes[copy.id] = canvas;
    art.planeSizes[copy.id] = { width: canvas.width, height: canvas.height };
    touchLayer(art, copy.id);
    studio.editPage(page, 'Duplicate piece', ['groups'], (p) => {
      const g = p.groups.find((x) => x.id === group.id);
      if (!g) return;
      const at = g.layers.findIndex((l) => l.id === layer.id);
      g.layers.splice(Math.max(0, at), 0, copy);
    });
    select(copy.id);
  }

  const commit = (id: string, image: PlacedImage, label = 'Position image') => {
    const current = findLayer(page, id);
    if (!current?.layer.image || current.layer.locked || current.group.locked) return;
    if (JSON.stringify(current.layer.image) === JSON.stringify(image)) return;
    studio.editPage(page, label, ['groups'], (p) => {
      const target = findLayer(p, id);
      if (target) target.layer.image = { ...image };
    });
    ctx.chrome();
    ctx.request();
  };

  function open(asset?: BookAsset): void {
    const panels = ctx.panels();
    const groups = page.groups.filter((g) => (g.kind === 'background' || g.kind === 'panel') && g.visible && !g.locked);
    if (!groups.length) { toast('Unlock or show a page or panel group to import an image.'); return; }
    const file = h('input', { type: 'file', accept: IMAGE_ACCEPT, required: !asset, 'aria-label': 'Image file' });
    const role = h('select', { 'aria-label': 'Use image as' }, h('option', { value: 'art' }, 'Artwork'), h('option', { value: 'reference' }, 'Reference'));
    const dest = h('select', { 'aria-label': 'Place image in' },
      groups.filter((g) => g.kind === 'background').concat(groups.filter((g) => g.kind === 'panel')).map((g) =>
        h('option', { value: g.id }, g.kind === 'background' ? 'Full page' : groupLabel(page, panels, g))));
    const status = h('p', { class: 'note', role: 'status' });
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Place image');
    const form = h('form', {}, h('header', {}, h('h2', {}, 'Place an image')),
      h('div', { class: 'content' },
        asset ? h('p', {}, asset.name) : h('label', { class: 'field' }, 'PNG, JPEG or WebP', file),
        h('label', { class: 'field' }, 'Use as', role),
        h('label', { class: 'field' }, 'Place in', dest),
        h('p', { class: 'note' }, 'Artwork sits under lettering. Reference images stay on screen during drawing.'),
        status),
      h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Cancel'), submit));
    const d = h('dialog', { 'aria-label': 'Place an image' }, form);
    d.addEventListener('close', () => d.remove());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = file.files?.[0];
      if ((!f && !asset) || submit.disabled) return;
      const groupId = dest.value;
      const reference = role.value === 'reference';
      submit.disabled = true;
      status.textContent = 'Reading image…';
      try {
        let canvas: HTMLCanvasElement;
        let reduced = false;
        if (asset) {
          const bytes = await studio.store.getAsset(asset.key);
          if (!bytes) throw new Error('This asset’s image is missing.');
          canvas = makeCanvas(asset.width, asset.height);
          await decodePngInto(canvas, bytes);
        } else ({ canvas, reduced } = await readAssetImage(f!, askToReduce));
        if (!d.open) return;
        if (!ctx.stage.isConnected || studio.book !== ctx.book || !ctx.book.pages.includes(page)) { d.close(); return; }
        const group = page.groups.find((g) => g.id === groupId && g.visible && !g.locked);
        if (!group) throw new Error('That group is unavailable. Choose another destination.');
        const layer = newLayer(reference ? 'reference' : 'colour');
        layer.name = asset?.name ?? f!.name.replace(/\.[^.]+$/, '');
        layer.fillRef = false;
        layer.image = fitImage({ x: 0, y: 0, width: 1, height: 1, rotation: 0, pixelWidth: canvas.width, pixelHeight: canvas.height }, box(group));
        art.planes[layer.id] = canvas;
        art.planeSizes[layer.id] = { width: canvas.width, height: canvas.height };
        touchLayer(art, layer.id);
        studio.editPage(page, 'Import image', ['groups'], (p) => {
          const g = p.groups.find((item) => item.id === groupId)!;
          g.layers.splice(insertIndex(g, layer.type), 0, layer);
        });
        d.close();
        select(layer.id);
        const dpi = imageDpi(layer.image!);
        toast((reduced ? 'Image placed as a working copy of ' + canvas.width + ' × ' + canvas.height + ' px (your original is unchanged).' : 'Image placed: ' + canvas.width + ' × ' + canvas.height + ' px.')
          + ' ' + dpi + ' dpi at this size' + (dpi < ctx.book.dpi ? ', below the book’s ' + ctx.book.dpi + ' dpi.' : '.'), 5000);
      } catch (e) {
        status.textContent = e instanceof ImportCancelled ? e.message : e instanceof Error ? 'Could not place this image. ' + e.message : 'Could not place this image.';
      } finally {
        submit.disabled = false;
      }
    });
    document.body.append(d);
    d.showModal();
  }

  /**
   * Place a book asset straight onto the page (bins: tap or drag and drop). Dropped at a point it
   * goes in the panel under that point, centred there; otherwise in the selected panel's group, or
   * the page. One undo step.
   */
  async function placeAsset(asset: BookAsset, at: Pt | null, reference = false): Promise<boolean> {
    const panels = ctx.panels();
    // a drop just off the page lands at its edge
    if (at) at = { x: Math.max(0, Math.min(page.widthIn, at.x)), y: Math.max(0, Math.min(page.heightIn, at.y)) };
    let group = at ? groupAt(page, panels, at) : (contextGroup() ?? page.groups.find((g) => g.kind === 'background')!);
    if (group.kind !== 'panel' && group.kind !== 'background') group = page.groups.find((g) => g.kind === 'background')!;
    if (!group.visible || group.locked) { toast(`${group.kind === 'panel' ? 'That panel' : 'The page'} is hidden or locked. Show or unlock it in Layers to place images there.`); return false; }
    const bytes = await studio.store.getAsset(asset.key);
    if (!bytes) { toast('This asset’s image is missing.'); return false; }
    const canvas = makeCanvas(asset.width, asset.height);
    await decodePngInto(canvas, bytes);
    if (!ctx.stage.isConnected || studio.book !== ctx.book || !ctx.book.pages.includes(page)) return false;
    const layer = newLayer(reference ? 'reference' : 'colour');
    layer.name = asset.name;
    layer.fillRef = false;
    const b = box(group);
    // fit within 70% of the panel so it reads as a placed piece, then centre on the drop point
    const inset = { x0: b.x0 + (b.x1 - b.x0) * 0.15, y0: b.y0 + (b.y1 - b.y0) * 0.15, x1: b.x1 - (b.x1 - b.x0) * 0.15, y1: b.y1 - (b.y1 - b.y0) * 0.15 };
    const fitted = fitImage({ x: 0, y: 0, width: 1, height: 1, rotation: 0, pixelWidth: canvas.width, pixelHeight: canvas.height }, inset);
    const centre = at ? mapPanelPoint(at, inverseForGroup(group)) : null;
    layer.image = centre ? { ...fitted, x: centre.x, y: centre.y } : fitted;
    art.planes[layer.id] = canvas;
    art.planeSizes[layer.id] = { width: canvas.width, height: canvas.height };
    touchLayer(art, layer.id);
    const groupId = group.id;
    studio.editPage(page, 'Place ' + asset.name, ['groups'], (p) => {
      const g = p.groups.find((item) => item.id === groupId);
      if (g) g.layers.splice(insertIndex(g, layer.type), 0, layer);
    });
    select(layer.id);
    ctx.chrome();
    ctx.request();
    return true;
  }
  const contextGroup = () => { const id = selected(); return id ? findLayer(page, id)?.group ?? null : null; };

  function options(): HTMLElement {
    const item = get();
    if (!item) return h('div', { class: 'sec' }, h('h4', {}, 'Image placement'),
      h('p', { class: 'note' }, 'Select an imported image on the page or in Layers.'),
      h('button', { class: 'btn', type: 'button', onclick: () => open() }, 'Place an image'));
    const { layer, group, image } = item;
    const locked = layer.locked || group.locked;
    const field = (label: string, value: number, min: number, max: number, update: (value: number) => Partial<PlacedImage>) => {
      const input = h('input', { type: 'number', step: 'any', min, max, value: Number(value.toFixed(3)), 'aria-label': label, disabled: locked });
      input.addEventListener('change', () => {
        if (!Number.isFinite(input.valueAsNumber) || !input.checkValidity()) { input.value = String(Number(value.toFixed(3))); return; }
        commit(layer.id, { ...image, ...update(input.valueAsNumber) });
      });
      return h('label', { class: 'field' }, label, input);
    };
    const credit = h('input', { value: image.credit ?? '', maxlength: 180, 'aria-label': 'Image credit', disabled: locked });
    credit.addEventListener('change', () => commit(layer.id, { ...image, credit: credit.value.trim() || undefined }, 'Edit image credit'));
    const span = Math.max(page.widthIn, page.heightIn);
    return h('div', { class: 'sec image-inspector' }, h('h4', {}, layer.name),
      imageDpi(image) < ctx.book.dpi
        ? h('p', { class: 'warnline' }, image.pixelWidth + ' × ' + image.pixelHeight + ' px · ' + imageDpi(image) + ' dpi at placed size, below this book’s ' + ctx.book.dpi + ' dpi. It may print soft; place it smaller or use a larger source.')
        : h('p', { class: 'note' }, image.pixelWidth + ' × ' + image.pixelHeight + ' px · ' + imageDpi(image) + ' dpi at placed size'),
      h('div', { class: 'image-placement-actions' }, ...[false, true].map((fill) =>
        h('button', { class: 'btn', type: 'button', disabled: locked, onclick: () => commit(layer.id, fitImage(image, box(group), fill), fill ? 'Fill image area' : 'Fit image area') }, fill ? 'Fill area' : 'Fit inside'))),
      h('div', { class: 'image-fields' },
        field('Centre X (in)', image.x, -span * 4, span * 5, (x) => ({ x })),
        field('Centre Y (in)', image.y, -span * 4, span * 5, (y) => ({ y })),
        field('Width (in)', image.width, 0.01, span * 12, (width) => ({ width, height: image.height * width / image.width })),
        field('Rotation (°)', image.rotation, -360, 360, (rotation) => ({ rotation }))),
      h('label', { class: 'field' }, 'Credit', credit),
      collageControls(layer.id, image, locked));
  }

  function collageControls(id: string, image: PlacedImage, locked: boolean): HTMLElement {
    const range = (label: string, value: number, max: number, step: number, unit: string, apply: (v: number) => Partial<PlacedImage>, undoLabel: string) => {
      const input = h('input', { type: 'range', min: 0, max, step, value, disabled: locked, 'aria-label': label });
      const out = h('b', {}, value.toFixed(step < 1 ? 2 : 0) + unit);
      input.addEventListener('input', () => (out.textContent = input.valueAsNumber.toFixed(step < 1 ? 2 : 0) + unit));
      input.addEventListener('change', () => commit(id, { ...image, ...apply(input.valueAsNumber) }, undoLabel));
      return h('label', { class: 'mini collage-range' }, label, input, out);
    };
    const edge = image.edge ?? { width: 0, color: '#ffffff' };
    const colour = h('input', { type: 'color', value: edge.color, disabled: locked, 'aria-label': 'Paper edge colour' });
    colour.addEventListener('change', () => commit(id, { ...image, edge: { width: edge.width || 0.04, color: colour.value } }, 'Paper edge colour'));
    return h('div', { class: 'collage' },
      h('h4', {}, 'Collage'),
      h('p', { class: 'note' }, 'Cut out part of the image, tear its edge, give it a paper border, and duplicate pieces to paste up a zine page. The original image stays whole.'),
      h('div', { class: 'image-placement-actions' },
        h('button', { class: 'btn', type: 'button', disabled: locked, 'aria-pressed': String(cutting), onclick: startCut }, cutting ? 'Drawing the cut…' : 'Cut out piece'),
        h('button', { class: 'btn', type: 'button', disabled: locked || !image.cutout, onclick: () => { const { cutout: _c, torn: _t, ...rest } = image; commit(id, rest, 'Reset cut'); } }, 'Reset cut'),
        h('button', { class: 'btn', type: 'button', disabled: locked, onclick: duplicatePiece }, 'Duplicate piece')),
      image.cutout ? range('Torn edge', Math.round((image.torn ?? 0) * 100), 100, 1, '%', (v) => ({ torn: v / 100 }), 'Torn edge') : null,
      image.cutout ? h('div', { class: 'collage-edge' },
        range('Paper edge', edge.width, 0.2, 0.01, '″', (v) => (v > 0 ? { edge: { width: v, color: edge.color } } : { edge: undefined }), 'Paper edge'), colour) : null);
  }

  const handle = (image: PlacedImage) => imagePoint(image, image.width / 2, image.height / 2);
  /** The selected image (with its cut) as a clipboard piece, its centre on the page. */
  function clipboard(): { name: string; canvas: HTMLCanvasElement; image: PlacedImage; centre: Pt } | null {
    const item = get();
    const source = item && art.planes[item.layer.id];
    if (!item || !source?.width) return null;
    const canvas = makeCanvas(source.width, source.height);
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    const centre = mapPanelPoint({ x: item.image.x, y: item.image.y }, matrixForGroup(item.group) ?? null);
    return { name: item.layer.name, canvas, image: structuredClone(item.image), centre };
  }

  return {
    open, options, clipboard, placeAsset,
    start(p: Pt) {
      if (cutting) { cutPoint = p; marquee.down(p, 'freehand'); return; }
      let item = get();
      let resize = false;
      if (item && item.layer.visible && item.group.visible) {
        const at = mapPanelPoint(handle(item.image), matrixForGroup(item.group) ?? null);
        resize = Math.hypot(at.x - p.x, at.y - p.y) < 14 / ctx.scale();
      }
      if (!resize && (!item || !item.layer.visible || !item.group.visible || !hitsImage(item.image, mapPanelPoint(p, inverseForGroup(item.group))))) {
        const panels = ctx.panels();
        const hit = page.groups.filter((g) => g.visible && (!g.anchor || !g.mask || panelForGroup(panels, g) === panelAt(panels, p)))
          .flatMap((g) => g.layers.filter((l) => l.visible && l.image && hitsImage(l.image, mapPanelPoint(p, inverseForGroup(g))))).at(0);
        if (!hit) return;
        select(hit.id);
        item = get();
      }
      if (!item || item.layer.locked || item.group.locked) return;
      const inverse = inverseForGroup(item.group);
      drag = { id: item.layer.id, start: mapPanelPoint(p, inverse), before: { ...item.image }, next: { ...item.image }, resize, inverse };
    },
    move(p: Pt) {
      if (cutting) { cutPoint = p; marquee.move(p); ctx.request(); return; }
      if (!drag) return;
      p = mapPanelPoint(p, drag.inverse);
      const { before, start, resize } = drag;
      if (resize) {
        const end = handle(before);
        const dx = end.x - before.x;
        const dy = end.y - before.y;
        const raw = 1 + ((p.x - start.x) * dx + (p.y - start.y) * dy) / (dx * dx + dy * dy);
        const scale = Math.min(12 * Math.max(page.widthIn, page.heightIn) / before.width, Math.max(0.01 / before.width, raw));
        drag.next = { ...before, width: before.width * scale, height: before.height * scale };
      } else {
        drag.next = { ...before, x: before.x + p.x - start.x, y: before.y + p.y - start.y };
      }
    },
    end(cancel: boolean) {
      if (cutting && marquee.active()) {
        if (cancel) { cutting = false; marquee.clear(); ctx.chrome(); } else marquee.up(cutPoint!, false);
        return;
      }
      if (cutting && cancel) { cutting = false; ctx.chrome(); return; }
      if (!drag) return;
      const { id, next } = drag;
      drag = null;
      if (!cancel) commit(id, next);
    },
    preview: () => drag ? { id: drag.id, image: drag.next } : undefined,
    overlay(g: CanvasRenderingContext2D, s: number) {
      const item = get();
      if (!item || !item.layer.visible || !item.group.visible) return;
      const image = drag?.next ?? item.image;
      const w = image.width / 2, hgt = image.height / 2;
      const matrix = matrixForGroup(item.group) ?? null;
      const points = [imagePoint(image, -w, -hgt), imagePoint(image, w, -hgt), imagePoint(image, w, hgt), imagePoint(image, -w, hgt)].map((p) => mapPanelPoint(p, matrix));
      g.save();
      g.lineWidth = 2;
      g.strokeStyle = '#2686af';
      g.setLineDash([5, 4]);
      g.beginPath();
      points.forEach((p, i) => i ? g.lineTo(p.x * s, p.y * s) : g.moveTo(p.x * s, p.y * s));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      const p = points[2]!;
      g.fillStyle = '#fff';
      g.fillRect(p.x * s - 5, p.y * s - 5, 10, 10);
      g.strokeRect(p.x * s - 5, p.y * s - 5, 10, 10);
      if (cutting) {
        g.strokeStyle = '#d24f2a';
        g.lineWidth = 2;
        g.setLineDash([6, 4]);
        marquee.overlay(g, s);
      }
      g.restore();
    },
  };
}
