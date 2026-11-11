import type { Studio } from '../app/studio';
import { LAYER_TYPES, newLayer, TYPE_DEFAULTS, type Layer, type LayerGroup, type LayerType, type Page } from '../doc/model';
import type { Panel } from '../geom/carve';
import { groupLabel, insertIndex } from '../geom/groups';
import { askText, confirmDialog, h } from './dom';
import { closePopover, popover } from './popover';

/**
 * The Layers panel: Over panels, a group per panel (labelled by its number and beat), and
 * Background. Every change is one undo step (`Studio.editPage` on `groups`). Groups can be
 * multi-selected by clicking their labels with Ctrl/⌘ or Shift; group actions then apply to the
 * selection, or to every panel group with the All panels menu.
 */

export const TYPE_GLYPH: Record<LayerType, string> = { pencil: '✏', ink: '✒', colour: '◐', tone: '▦', reference: '⌗' };

export interface LayersPanelOptions {
  studio: Studio;
  page: Page;
  panels: Panel[];
  active: string | null;
  onSelect(layerId: string | null): void;
  refresh(): void;
}

/** Groups selected by label, per page, for the session. */
const selectedGroups = new Map<string, Set<string>>();

export function layersPanel(o: LayersPanelOptions): HTMLElement {
  const { studio, page, panels } = o;
  const sel = selectedGroups.get(page.id) ?? new Set<string>();
  selectedGroups.set(page.id, sel);

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

  function layerMenu(anchor: HTMLElement, l: Layer, g: LayerGroup): void {
    const i = g.layers.findIndex((x) => x.id === l.id);
    const opacity = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: l.opacity, 'aria-label': 'Opacity' });
    opacity.addEventListener('change', () => edit('Layer opacity', withLayer(l.id, (x) => (x.opacity = Number(opacity.value)))));
    const check = (label: string, value: boolean, set: (x: Layer, v: boolean) => void, note?: string) => {
      const box = h('input', { type: 'checkbox', checked: value });
      box.addEventListener('change', () => edit(label, withLayer(l.id, (x) => set(x, box.checked))));
      return h('div', { class: 'row' }, h('label', { title: note ?? '' }, box, label));
    };
    popover(anchor, h('div', { style: 'width:240px' },
      h('h4', {}, l.name),
      h('div', { class: 'row' }, h('label', {}, 'Opacity', opacity)),
      check('Prints', l.prints, (x, v) => (x.prints = v), 'In print and exports'),
      check('Fill reference', l.fillRef, (x, v) => (x.fillRef = v), 'Colour fills stop at this layer’s lines'),
      g.kind === 'panel' ? check('Over frame', l.overFrame, (x, v) => (x.overFrame = v), 'Draw above the borders, unmasked (pop-out)') : null,
      h('div', { class: 'sep' }),
      h('h4', {}, 'Type'),
      LAYER_TYPES.map((t) =>
        h('button', { class: 'item', type: 'button', role: 'menuitemradio', 'aria-checked': String(t === l.type), onclick: () => {
          closePopover();
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
      h('button', { class: 'item', type: 'button', disabled: i <= 0, onclick: () => { closePopover(); edit('Move layer up', withGroup(g.id, (x) => x.layers.splice(i - 1, 0, ...x.layers.splice(i, 1)))); } }, h('span', {}, '↑'), 'Move up'),
      h('button', { class: 'item', type: 'button', disabled: i >= g.layers.length - 1, onclick: () => { closePopover(); edit('Move layer down', withGroup(g.id, (x) => x.layers.splice(i + 1, 0, ...x.layers.splice(i, 1)))); } }, h('span', {}, '↓'), 'Move down'),
      h('button', { class: 'item', type: 'button', onclick: async () => {
        closePopover();
        const name = await askText('Rename layer', 'Name', l.name, 'Rename');
        if (name !== null && name.trim()) edit('Rename layer', withLayer(l.id, (x) => (x.name = name.trim())));
      } }, h('span', {}, '✎'), 'Rename'),
      h('button', { class: 'item', type: 'button', onclick: async () => {
        closePopover();
        const n = l.strokes.length + l.fills.length;
        if (n && !(await confirmDialog('Delete layer?', `“${l.name}” and its ${n} marks go away. Undo brings them back.`, 'Delete'))) return;
        if (o.active === l.id) o.onSelect(null);
        edit('Delete layer', withGroup(g.id, (x) => (x.layers = x.layers.filter((y) => y.id !== l.id))));
      } }, h('span', {}, '✕'), 'Delete'),
    ), 'left', `${l.name} options`);
  }

  function addMenu(anchor: HTMLElement, g: LayerGroup): void {
    popover(anchor, h('div', { role: 'menu', 'aria-label': 'Add layer' },
      h('h4', {}, 'Add layer'),
      LAYER_TYPES.map((t) =>
        h('button', { class: 'item', type: 'button', role: 'menuitem', onclick: () => {
          closePopover();
          const layer = newLayer(t);
          edit(`New ${t} layer`, withGroup(g.id, (x) => x.layers.splice(insertIndex(x, t), 0, layer)));
          o.onSelect(layer.id);
        } }, h('span', { 'aria-hidden': 'true' }, TYPE_GLYPH[t]), TYPE_DEFAULTS[t].name))), 'left', 'Add layer');
  }

  /** Apply a group change to the label selection, or to every panel group. */
  function allMenu(anchor: HTMLElement): void {
    const targets = () => (sel.size ? [...sel] : page.groups.filter((g) => g.kind === 'panel').map((g) => g.id));
    const apply = (label: string, fn: (g: LayerGroup) => void) => {
      closePopover();
      const ids = new Set(targets());
      edit(label, (groups) => groups.filter((g) => ids.has(g.id)).forEach(fn));
    };
    popover(anchor, h('div', { role: 'menu', 'aria-label': 'Group actions' },
      h('h4', {}, sel.size ? `${sel.size} selected group${sel.size === 1 ? '' : 's'}` : 'All panels'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Show groups', (g) => (g.visible = true)) }, h('span', {}, '👁'), 'Show'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Hide groups', (g) => (g.visible = false)) }, h('span', {}, '◌'), 'Hide'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Mask groups', (g) => (g.mask = g.kind === 'panel' ? true : g.mask)) }, h('span', {}, '◫'), 'Mask to panel'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Unmask groups', (g) => (g.mask = false)) }, h('span', {}, '▢'), 'No mask'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Lock groups', (g) => (g.locked = true)) }, h('span', {}, '🔒'), 'Lock'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Unlock groups', (g) => (g.locked = false)) }, h('span', {}, '🔓'), 'Unlock'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Collapse groups', (g) => (g.collapsed = true)) }, h('span', {}, '▸'), 'Collapse'),
      h('button', { class: 'item', type: 'button', onclick: () => apply('Expand groups', (g) => (g.collapsed = false)) }, h('span', {}, '▾'), 'Expand'),
      sel.size ? [h('div', { class: 'sep' }), h('button', { class: 'item', type: 'button', onclick: () => { sel.clear(); closePopover(); o.refresh(); } }, h('span', {}, '✕'), 'Clear selection')] : null,
    ), 'left', 'Group actions');
  }

  const list = h('div', { class: 'layers', role: 'tree', 'aria-label': 'Layers' });
  for (const g of page.groups) {
    const label = groupLabel(page, panels, g);
    const selected = sel.has(g.id);
    const head = h('div', { class: `lgroup${selected ? ' sel' : ''}${g.visible ? '' : ' off'}`, role: 'treeitem', 'aria-expanded': String(!g.collapsed), 'aria-selected': String(selected) },
      h('button', { class: 'lt', type: 'button', 'aria-label': g.collapsed ? `Expand ${label}` : `Collapse ${label}`, onclick: () => edit(g.collapsed ? 'Expand group' : 'Collapse group', withGroup(g.id, (x) => (x.collapsed = !x.collapsed))) }, g.collapsed ? '▸' : '▾'),
      h('button', { class: 'lname', type: 'button', title: 'Click with Ctrl/⌘ or Shift to select several', onclick: (ev: Event) => { const e = ev as MouseEvent;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (sel.has(g.id)) sel.delete(g.id);
          else sel.add(g.id);
        } else {
          const only = sel.size === 1 && sel.has(g.id);
          sel.clear();
          if (!only) sel.add(g.id);
        }
        o.refresh();
      } }, label, h('small', {}, g.layers.length ? ` ${g.layers.length}` : '')),
      g.kind === 'panel' || g.kind === 'gutter' ? iconToggle(g.mask, '◫', '▢', g.mask ? `Unmask ${label}` : g.kind === 'gutter' ? `Keep ${label} out of the panels` : `Mask ${label} to its panel`, () => edit(g.mask ? 'Unmask group' : 'Mask group', withGroup(g.id, (x) => (x.mask = !x.mask)))) : null,
      iconToggle(g.locked, '🔒', '🔓', g.locked ? `Unlock ${label}` : `Lock ${label}`, () => edit(g.locked ? 'Unlock group' : 'Lock group', withGroup(g.id, (x) => (x.locked = !x.locked)))),
      iconToggle(g.visible, '👁', '◌', g.visible ? `Hide ${label}` : `Show ${label}`, () => edit(g.visible ? 'Hide group' : 'Show group', withGroup(g.id, (x) => (x.visible = !x.visible)))),
    );
    const add = h('button', { class: 'lt', type: 'button', 'aria-label': `Add a layer to ${label}`, title: 'Add layer' }, '+');
    add.addEventListener('click', () => addMenu(add, g));
    head.append(add);
    list.append(head);
    if (g.collapsed) continue;
    if (!g.layers.length) list.append(h('div', { class: 'lempty' }, g.kind === 'panel' ? 'Draw here and its layers appear' : g.kind === 'gutter' ? 'Draw in the gutters (set borders to 0 for borderless panels)' : 'Empty'));
    for (const l of g.layers) {
      const on = o.active === l.id;
      const more = h('button', { class: 'lt', type: 'button', 'aria-label': `${l.name} options`, title: 'Options' }, '⋯');
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        layerMenu(more, l, g);
      });
      list.append(
        h('div', { class: `llayer${on ? ' on' : ''}${l.visible ? '' : ' off'}`, role: 'treeitem', 'aria-selected': String(on) },
          h('button', { class: 'lname', type: 'button', title: on ? 'Selected: brushes draw here when Target is “Selected layer”. Click again to go back to “Panel under pen”.' : 'Draw on this layer', onclick: () => o.onSelect(on ? null : l.id) },
            h('span', { class: 'ltype', 'aria-hidden': 'true' }, TYPE_GLYPH[l.type]), l.name,
            l.prints ? null : h('small', { title: 'Does not print' }, ' · no print'),
            l.overFrame ? h('small', { title: 'Over frame' }, ' · ⤒') : null),
          g.kind === 'panel' ? iconToggle(l.overFrame, '⤒', '⤓', l.overFrame ? `Put ${l.name} back inside the frame` : `Draw ${l.name} over the frame`, () => edit(l.overFrame ? 'Inside frame' : 'Over frame', withLayer(l.id, (x) => (x.overFrame = !x.overFrame)))) : null,
          iconToggle(l.locked, '🔒', '🔓', l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`, () => edit(l.locked ? 'Unlock layer' : 'Lock layer', withLayer(l.id, (x) => (x.locked = !x.locked)))),
          iconToggle(l.visible, '👁', '◌', l.visible ? `Hide ${l.name}` : `Show ${l.name}`, () => edit(l.visible ? 'Hide layer' : 'Show layer', withLayer(l.id, (x) => (x.visible = !x.visible)))),
          more),
      );
    }
  }

  const all = h('button', { class: 'btn', type: 'button', style: 'min-height:26px;padding:3px 9px' }, sel.size ? `${sel.size} selected ▾` : 'All panels ▾');
  all.addEventListener('click', () => allMenu(all));
  return h('div', { class: 'sec layerssec' },
    h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' }, h('h4', { style: 'margin:0;flex:1' }, 'Layers'), all),
    list,
    h('p', { class: 'note' }, '◫ masks a panel’s art to its shape. ⤒ lifts a layer over the frame. Ctrl-click group names to select several.'));
}
