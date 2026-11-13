import { findLayer, newLayer, type BookAsset, type LayerGroup, type PlacedImage, type Pt } from '../doc/model';
import { panelAt } from '../geom/carve';
import { groupLabel, insertIndex } from '../geom/groups';
import { fitImage, hitsImage, imageDpi, imagePoint, type PlacementBox } from '../geom/placement';
import { decodePngInto, makeCanvas } from '../io/canvasops';
import { IMAGE_ACCEPT, readAssetImage } from '../io/bookassets';
import { touchLayer } from '../draw/residency';
import type { DeskCtx } from './desk';
import { h, toast } from './dom';

export function imagePlacement(ctx: DeskCtx, selected: () => string | null, select: (id: string) => void) {
  const { page, art, studio } = ctx;
  let drag: { id: string; start: Pt; before: PlacedImage; next: PlacedImage; resize: boolean } | null = null;

  const box = (group: LayerGroup): PlacementBox =>
    (group.anchor ? panelAt(ctx.panels(), group.anchor)?.bbox : null) ?? { x0: 0, y0: 0, x1: page.widthIn, y1: page.heightIn };

  const get = () => {
    const id = selected();
    const found = id ? findLayer(page, id) : null;
    return found?.layer.image ? { ...found, image: found.layer.image } : null;
  };

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
        } else ({ canvas, reduced } = await readAssetImage(f!));
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
        toast(reduced ? 'Image placed. The large source was reduced to ' + canvas.width + ' × ' + canvas.height + ' pixels.' : 'Image placed.');
      } catch (e) {
        status.textContent = e instanceof Error ? 'Could not place this image. ' + e.message : 'Could not place this image.';
      } finally {
        submit.disabled = false;
      }
    });
    document.body.append(d);
    d.showModal();
  }

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
      h('p', { class: 'note' }, image.pixelWidth + ' × ' + image.pixelHeight + ' px · ' + imageDpi(image) + ' dpi at placed size'),
      h('div', { class: 'image-placement-actions' }, ...[false, true].map((fill) =>
        h('button', { class: 'btn', type: 'button', disabled: locked, onclick: () => commit(layer.id, fitImage(image, box(group), fill), fill ? 'Fill image area' : 'Fit image area') }, fill ? 'Fill area' : 'Fit inside'))),
      h('div', { class: 'image-fields' },
        field('Centre X (in)', image.x, -span * 4, span * 5, (x) => ({ x })),
        field('Centre Y (in)', image.y, -span * 4, span * 5, (y) => ({ y })),
        field('Width (in)', image.width, 0.01, span * 12, (width) => ({ width, height: image.height * width / image.width })),
        field('Rotation (°)', image.rotation, -360, 360, (rotation) => ({ rotation }))),
      h('label', { class: 'field' }, 'Credit', credit));
  }

  const handle = (image: PlacedImage) => imagePoint(image, image.width / 2, image.height / 2);
  return {
    open, options,
    start(p: Pt) {
      let item = get();
      let resize = false;
      if (item && item.layer.visible && item.group.visible) {
        const at = handle(item.image);
        resize = Math.hypot(at.x - p.x, at.y - p.y) < 14 / ctx.scale();
      }
      if (!resize && (!item || !item.layer.visible || !item.group.visible || !hitsImage(item.image, p))) {
        const panels = ctx.panels();
        const hit = page.groups.filter((g) => g.visible && (!g.anchor || !g.mask || panelAt(panels, g.anchor) === panelAt(panels, p)))
          .flatMap((g) => g.layers).find((l) => l.visible && l.image && hitsImage(l.image, p));
        if (!hit) return;
        select(hit.id);
        item = get();
      }
      if (!item || item.layer.locked || item.group.locked) return;
      drag = { id: item.layer.id, start: p, before: { ...item.image }, next: { ...item.image }, resize };
    },
    move(p: Pt) {
      if (!drag) return;
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
      const points = [imagePoint(image, -w, -hgt), imagePoint(image, w, -hgt), imagePoint(image, w, hgt), imagePoint(image, -w, hgt)];
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
      g.restore();
    },
  };
}
