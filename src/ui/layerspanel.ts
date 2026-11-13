import type { Studio } from '../app/studio';
import { LAYER_TYPES, newLayer, TYPE_DEFAULTS, type Layer, type LayerGroup, type LayerType, type Page } from '../doc/model';
import type { Panel } from '../geom/carve';
import { groupLabel, insertIndex } from '../geom/groups';
import { askText, confirmDialog, h, seg } from './dom';

/**
 * The Layers panel: Over panels, a group per panel (labelled by its number and beat), and
 * Background. Every change is one undo step (`Studio.editPage` on `groups`). Groups can be
 * multi-selected by clicking their labels with Ctrl/⌘ or Shift; group actions then apply to the
 * selection, or to every panel group with the All panels menu.
 */

export const TYPE_GLYPH: Record<LayerType, string> = { pencil: '✏', ink: '✒', colour: '◐', tone: '▦', reference: '⌗' };

export type LayerTarget = 'auto' | 'layer';
export type LayerScope = 'context' | 'all';
export type LayerView = { kind: 'stack' | 'groups' } | { kind: 'add' | 'layer'; id: string };

export interface LayersPanelOptions {
  studio: Studio;
  page: Page;
  panels: Panel[];
  active: string | null;
  target: LayerTarget;
  scope: LayerScope;
  contextGroup: string | null;
  view: LayerView;
  onTarget(target: LayerTarget): void;
  onScope(scope: LayerScope): void;
  onContext(groupId: string): void;
  onView(view: LayerView): void;
  onSelect(layerId: string | null): void;
  onEditTone?(layerId: string): void;
  refresh(): void;
}

/** Groups selected by label, per page, for the session. */
const selectedGroups = new Map<string, Set<string>>();

export function layersPanel(o: LayersPanelOptions): HTMLElement {
  const { studio, page, panels } = o;
  const sel = selectedGroups.get(page.id) ?? new Set<string>();
  selectedGroups.set(page.id, sel);
  for (const id of sel) if (!page.groups.some((g) => g.id === id)) sel.delete(id);
  const activeGroup = page.groups.find((g) => g.layers.some((l) => l.id === o.active));
  const activeLayer = activeGroup?.layers.find((l) => l.id === o.active);
  const contextGroup = page.groups.find((g) => g.id === o.contextGroup);
  const stack = () => o.onView({ kind: 'stack' });
  const groupName = (g: LayerGroup) => groupLabel(page, panels, g);
  const groupCount = (g: LayerGroup) => g.layers.length + (g.layers.length === 1 ? ' layer' : ' layers');

  /** One undo step that edits groups by id (objects are replaced by snapshots on undo). */
  const edit = (label: string, fn: (groups: LayerGroup[]) => void) => {
    studio.editPage(page, label, ['groups'], (p) => fn(p.groups));
    o.refresh();
  };
  const withLayer = (id: string, fn: (l: Layer, g: LayerGroup) => void) => (groups: LayerGroup[]) => {
    for (const g of groups) {
      const l = g.layers.find((x) => x.id === id);
      if (l) fn(l, g);
    }
  };
  const withGroup = (id: string, fn: (g: LayerGroup) => void) => (groups: LayerGroup[]) => {
    const g = groups.find((x) => x.id === id);
    if (g) fn(g);
  };

  const iconToggle = (on: boolean, glyphOn: string, glyphOff: string, label: string, onClick: () => void) =>
    h('button', { class: 'lt', type: 'button', 'aria-pressed': String(on), 'aria-label': label, title: label, onclick: (e: Event) => { e.stopPropagation(); onClick(); } }, on ? glyphOn : glyphOff);

  function layerMenu(l: Layer, g: LayerGroup): HTMLElement {
    const i = g.layers.findIndex((x) => x.id === l.id);
    const opacity = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: l.opacity, 'aria-label': 'Opacity' });
    opacity.addEventListener('change', () => edit('Layer opacity', withLayer(l.id, (x) => (x.opacity = Number(opacity.value)))));
    const check = (label: string, value: boolean, set: (x: Layer, v: boolean) => void, note?: string) => {
      const box = h('input', { type: 'checkbox', checked: value });
      box.addEventListener('change', () => edit(label, withLayer(l.id, (x) => set(x, box.checked))));
      return h('div', { class: 'row' }, h('label', { title: note ?? '' }, box, label));
    };
    return h('div', { class: 'layer-options' },
      l.screenTone && o.onEditTone ? h('button', { class: 'item', type: 'button', onclick: () => o.onEditTone?.(l.id) }, h('span', {}, '▦'), 'Edit screentone') : null,
      h('div', { class: 'row' }, h('label', {}, 'Opacity', opacity)),
      check('Prints', l.prints, (x, v) => (x.prints = v), 'In print and exports'),
      l.image || l.screenTone ? null : check('Fill reference', l.fillRef, (x, v) => (x.fillRef = v), 'Colour fills stop at this layer’s lines'),
      g.kind === 'panel' ? check('Over frame', l.overFrame, (x, v) => (x.overFrame = v), 'Draw above the borders, unmasked (pop-out)') : null,
      h('div', { class: 'sep' }),
      h('h4', {}, 'Type'),
      (l.screenTone ? ['tone' as const] : LAYER_TYPES).map((t) =>
        h('button', { class: 'item', type: 'button', 'aria-pressed': String(t === l.type), onclick: () => {
          // changing type takes that type's defaults; the user can flip them back
          edit(t === 'ink' && l.type === 'pencil' ? 'Promote pencil to ink' : `Make ${t} layer`, withLayer(l.id, (x) => {
            const d = TYPE_DEFAULTS[t];
            if (x.name === TYPE_DEFAULTS[x.type].name) x.name = d.name;
            x.type = t;
            x.prints = d.prints;
            x.fillRef = d.fillRef;
          }));
        } }, h('span', { 'aria-hidden': 'true' }, TYPE_GLYPH[t]), TYPE_DEFAULTS[t].name)),
      h('div', { class: 'sep' }),
      h('button', { class: 'item', type: 'button', disabled: i <= 0, onclick: () => edit('Move layer up', withGroup(g.id, (x) => x.layers.splice(i - 1, 0, ...x.layers.splice(i, 1)))) }, h('span', {}, '↑'), 'Move up'),
      h('button', { class: 'item', type: 'button', disabled: i >= g.layers.length - 1, onclick: () => edit('Move layer down', withGroup(g.id, (x) => x.layers.splice(i + 1, 0, ...x.layers.splice(i, 1)))) }, h('span', {}, '↓'), 'Move down'),
      h('button', { class: 'item', type: 'button', onclick: async () => {
        const name = await askText('Rename layer', 'Name', l.name, 'Rename');
        if (name !== null && name.trim()) edit('Rename layer', withLayer(l.id, (x) => (x.name = name.trim())));
      } }, h('span', {}, '✎'), 'Rename'),
      h('button', { class: 'item', type: 'button', onclick: async () => {
        const n = l.strokes.length + l.fills.length;
        if ((n || l.image || l.screenTone) && !(await confirmDialog('Delete layer?', `“${l.name}” is removed from the page. Undo brings it back.`, 'Delete'))) return;
        if (o.active === l.id) o.onSelect(null);
        edit('Delete layer', withGroup(g.id, (x) => (x.layers = x.layers.filter((y) => y.id !== l.id))));
        stack();
      } }, h('span', {}, '✕'), 'Delete'),
    );
  }

  function addMenu(g: LayerGroup): HTMLElement {
    return h('div', { class: 'layer-options' },
      LAYER_TYPES.map((t) =>
        h('button', { class: 'item', type: 'button', onclick: () => {
          const layer = newLayer(t);
          edit(`New ${t} layer`, withGroup(g.id, (x) => x.layers.splice(insertIndex(x, t), 0, layer)));
          o.onSelect(layer.id);
          stack();
        } }, h('span', { 'aria-hidden': 'true' }, TYPE_GLYPH[t]), TYPE_DEFAULTS[t].name)));
  }

  /** Apply a group change to the label selection, or to every panel group. */
  function allMenu(): HTMLElement {
    const targets = () => (sel.size ? [...sel] : page.groups.filter((g) => g.kind === 'panel').map((g) => g.id));
    const apply = (label: string, fn: (g: LayerGroup) => void) => {
      const ids = new Set(targets());
      edit(label, (groups) => groups.filter((g) => ids.has(g.id)).forEach(fn));
      stack();
    };
    return h('div', { class: 'layer-options' },
      h('button', { class: 'item', type: 'button', onclick: () => apply('Show groups', (g) => (g.visible = true)) }, h('span', {}, '👁'), 'Show'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Hide groups', (g) => (g.visible = false)) }, h('span', {}, '◌'), 'Hide'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Mask groups', (g) => (g.mask = g.kind === 'panel' ? true : g.mask)) }, h('span', {}, '◫'), 'Mask to panel'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Unmask groups', (g) => (g.mask = false)) }, h('span', {}, '▢'), 'No mask'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Lock groups', (g) => (g.locked = true)) }, h('span', {}, '🔒'), 'Lock'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Unlock groups', (g) => (g.locked = false)) }, h('span', {}, '🔓'), 'Unlock'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Collapse groups', (g) => (g.collapsed = true)) }, h('span', {}, '▸'), 'Collapse'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Expand groups', (g) => (g.collapsed = false)) }, h('span', {}, '▾'), 'Expand'),
      sel.size ? [h('div', { class: 'sep' }), h('button', { class: 'item', type: 'button', onclick: () => { sel.clear(); stack(); } }, h('span', {}, '✕'), 'Clear selection')] : null,
    );
  }

  function subview(title: string, content: HTMLElement): HTMLElement {
    return h('div', { class: 'layer-subview' },
      h('header', { class: 'layer-picker-head' },
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Back to layers', onclick: stack }, '←'),
        h('strong', {}, title)), content);
  }
  if (o.view.kind === 'groups') return subview(sel.size ? 'Selected group actions' : 'Panel group actions', allMenu());
  if (o.view.kind === 'add' || o.view.kind === 'layer') {
    const { id, kind } = o.view;
    if (kind === 'add') {
      const group = page.groups.find((g) => g.id === id);
      if (group) return subview('Add layer · ' + groupName(group), addMenu(group));
    } else {
      const group = page.groups.find((g) => g.layers.some((l) => l.id === id));
      const layer = group?.layers.find((l) => l.id === id);
      if (group && layer) return subview(layer.name, layerMenu(layer, group));
    }
  }

  const groups = o.scope === 'all' ? page.groups : contextGroup ? [contextGroup] : [];
  const list = h('div', { class: 'layers', 'aria-label': 'Layer stack' });
  for (const g of groups) {
    const label = groupName(g);
    const selected = sel.has(g.id);
    const head = h('div', { class: `lgroup${selected ? ' sel' : ''}${g.visible ? '' : ' off'}` },
      h('button', { class: 'lt', type: 'button', 'data-focus': 'collapse-' + g.id, 'aria-expanded': String(!g.collapsed), 'aria-label': g.collapsed ? `Expand ${label}` : `Collapse ${label}`, onclick: () => edit(g.collapsed ? 'Expand group' : 'Collapse group', withGroup(g.id, (x) => (x.collapsed = !x.collapsed))) }, g.collapsed ? '▸' : '▾'),
      h('button', { class: 'lname', type: 'button', 'data-focus': 'group-' + g.id, 'aria-pressed': String(selected), title: 'Click with Ctrl/⌘ or Shift to select several', onclick: (ev: Event) => { const e = ev as MouseEvent;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (sel.has(g.id)) sel.delete(g.id);
          else sel.add(g.id);
        } else {
          const only = sel.size === 1 && sel.has(g.id);
          sel.clear();
          if (!only) sel.add(g.id);
        }
        o.refresh();
      } }, h('span', { class: 'layer-name' }, label), h('small', {}, groupCount(g))),
      g.kind === 'panel' || g.kind === 'gutter' ? iconToggle(g.mask, '◫', '▢', g.mask ? `Unmask ${label}` : g.kind === 'gutter' ? `Keep ${label} out of the panels` : `Mask ${label} to its panel`, () => edit(g.mask ? 'Unmask group' : 'Mask group', withGroup(g.id, (x) => (x.mask = !x.mask)))) : null,
      iconToggle(g.locked, '🔒', '🔓', g.locked ? `Unlock ${label}` : `Lock ${label}`, () => edit(g.locked ? 'Unlock group' : 'Lock group', withGroup(g.id, (x) => (x.locked = !x.locked)))),
      iconToggle(g.visible, '👁', '◌', g.visible ? `Hide ${label}` : `Show ${label}`, () => edit(g.visible ? 'Hide group' : 'Show group', withGroup(g.id, (x) => (x.visible = !x.visible)))),
    );
    const add = h('button', { class: 'lt layer-add', type: 'button', 'aria-label': `Add a layer to ${label}`, title: 'Add layer', onclick: () => o.onView({ kind: 'add', id: g.id }) }, '+');
    head.append(add);
    const card = h('section', { class: 'layer-group-card', 'aria-label': label }, head);
    list.append(card);
    if (g.collapsed) continue;
    if (!g.layers.length && o.scope === 'context') card.append(h('div', { class: 'lempty' }, 'No layers in this group yet.'));
    for (const l of g.layers) {
      const on = o.target === 'layer' && o.active === l.id;
      const more = h('button', { class: 'lt', type: 'button', 'aria-label': `${l.name} options`, title: 'Options', onclick: () => o.onView({ kind: 'layer', id: l.id }) }, '⋯');
      const type = TYPE_DEFAULTS[l.type].name;
      const status = [l.image ? 'Placed image' : l.screenTone ? 'Editable screentone' : l.vector ? 'Vector' : l.name !== type ? type : null, !l.prints ? 'No print' : null, l.overFrame ? 'Over frame' : null].filter(Boolean).join(' · ');
      card.append(
        h('div', { class: `llayer${on ? ' on' : ''}${l.visible ? '' : ' off'}` },
          h('button', { class: 'lname layer-select', type: 'button', 'data-focus': 'layer-' + l.id, 'aria-pressed': String(on),
            title: l.image ? 'Position ' + l.name : on ? 'Use the panel under the pen' : 'Draw on ' + l.name,
            onclick: () => { if (on) o.onTarget('auto'); else o.onSelect(l.id); } },
            h('span', { class: 'ltype', 'data-type': l.type, 'aria-hidden': 'true' }, TYPE_GLYPH[l.type]),
            h('span', { class: 'layer-text' }, h('span', { class: 'layer-name' }, l.name), status ? h('small', {}, status) : null)),
          g.kind === 'panel' ? iconToggle(l.overFrame, '⤒', '⤓', l.overFrame ? `Put ${l.name} back inside the frame` : `Draw ${l.name} over the frame`, () => edit(l.overFrame ? 'Inside frame' : 'Over frame', withLayer(l.id, (x) => (x.overFrame = !x.overFrame)))) : null,
          iconToggle(l.locked, '🔒', '🔓', l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`, () => edit(l.locked ? 'Unlock layer' : 'Lock layer', withLayer(l.id, (x) => (x.locked = !x.locked)))),
          iconToggle(l.visible, '👁', '◌', l.visible ? `Hide ${l.name}` : `Show ${l.name}`, () => edit(l.visible ? 'Hide layer' : 'Show layer', withLayer(l.id, (x) => (x.visible = !x.visible)))),
          more),
      );
    }
  }

  const browse = h('select', { 'aria-label': 'Context group', 'data-focus': 'context-group' },
    page.groups.map((g) => h('option', { value: g.id, selected: g === contextGroup }, groupName(g) + ' · ' + groupCount(g))));
  browse.addEventListener('change', () => o.onContext(browse.value));
  const count = page.groups.reduce((sum, g) => sum + g.layers.length, 0);
  return h('div', { class: 'layer-stack' },
    h('div', { class: 'layer-picker-top' },
      h('header', { class: 'layer-picker-head' },
      h('strong', {}, 'Layers'),
      h('span', { class: 'layer-total' }, count + (count === 1 ? ' layer' : ' layers')),
      h('button', { class: 'btn layer-group-actions', type: 'button', onclick: () => o.onView({ kind: 'groups' }) }, sel.size ? sel.size + ' selected' : 'Group actions')),
      h('div', { class: 'layer-picker-controls' },
      h('div', { class: 'layer-control' }, h('span', {}, 'Draw on'),
        seg<LayerTarget>([{ id: 'auto', label: 'Panel under pen' }, { id: 'layer', label: 'Selected layer' }], o.target, o.onTarget, 'Layer targeting')),
      o.target === 'layer'
        ? h('p', { class: 'layer-target-detail', role: 'status' }, activeLayer && activeGroup ? groupName(activeGroup) + ' / ' + activeLayer.name : 'Choose a layer below.')
        : null,
      h('div', { class: 'layer-control' }, h('span', {}, 'Show'),
        seg<LayerScope>([{ id: 'context', label: 'Context' }, { id: 'all', label: 'All layers' }], o.scope, o.onScope, 'Layer view')),
      o.scope === 'context' ? browse : null)),
    list);
}
