import { fromInches, kindById, PRINT_KINDS, SIZE_UNITS, sizeProblem, toInches, type KindGroup, type SizeUnit } from '../geom/printkinds';
import { h } from './dom';

export interface SizeValue {
  /** Inches. */
  w: number;
  h: number;
  /** The preset whose size this is exactly, or null for a custom size. */
  kind: string | null;
  /** Plain-words reason this size cannot be used, or null. */
  problem: string | null;
}

/**
 * Page size chooser: start from a preset or type your own width and height (in, mm or cm).
 * Choosing a preset fills the boxes; editing a box makes it Custom.
 */
export function sizePicker(opts: { w: number; h: number; dpi: number; onChange?: (v: SizeValue) => void }): { el: HTMLElement; value: () => SizeValue } {
  let unit: SizeUnit = 'in';
  let wIn = opts.w;
  let hIn = opts.h;
  const exact = (): string | null => PRINT_KINDS.find((k) => Math.abs(k.w - wIn) < 1e-3 && Math.abs(k.h - hIn) < 1e-3)?.id ?? null;

  const groups = new Map<KindGroup, typeof PRINT_KINDS>();
  for (const k of PRINT_KINDS) groups.set(k.group, [...(groups.get(k.group) ?? []), k]);
  const preset = h('select', { 'aria-label': 'Start from a preset' },
    h('option', { value: 'custom' }, 'Custom size'),
    [...groups.entries()].map(([g, ks]) => h('optgroup', { label: g }, ks.map((k) => h('option', { value: k.id }, k.label)))));
  const wBox = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': 'Width', style: 'width:84px' });
  const hBox = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': 'Height', style: 'width:84px' });
  const unitSel = h('select', { 'aria-label': 'Unit' }, SIZE_UNITS.map((u) => h('option', { value: u.id }, u.label)));
  const swap = h('button', { class: 'btn', type: 'button', title: 'Swap width and height (portrait / landscape)', 'aria-label': 'Swap width and height' }, '⇄');
  const readout = h('p', { class: 'note', role: 'status' });

  const value = (): SizeValue => ({ w: wIn, h: hIn, kind: exact(), problem: sizeProblem(wIn, hIn, opts.dpi) });
  const paint = (fillBoxes: boolean) => {
    if (fillBoxes) {
      wBox.value = String(fromInches(wIn, unit));
      hBox.value = String(fromInches(hIn, unit));
    }
    preset.value = exact() ?? 'custom';
    const v = value();
    readout.textContent = v.problem ?? `${fromInches(wIn, 'in')} × ${fromInches(hIn, 'in')} in  ·  ${fromInches(wIn, 'mm')} × ${fromInches(hIn, 'mm')} mm  ·  ${Math.round(wIn * opts.dpi)} × ${Math.round(hIn * opts.dpi)} px at ${opts.dpi} dpi`;
    readout.classList.toggle('warn', !!v.problem);
    opts.onChange?.(v);
  };
  preset.addEventListener('change', () => {
    const k = kindById(preset.value);
    if (k) { wIn = k.w; hIn = k.h; }
    paint(true);
  });
  const typed = () => {
    const w = Number(wBox.value);
    const hh = Number(hBox.value);
    wIn = w > 0 ? toInches(w, unit) : 0;
    hIn = hh > 0 ? toInches(hh, unit) : 0;
    paint(false);
  };
  wBox.addEventListener('input', typed);
  hBox.addEventListener('input', typed);
  unitSel.addEventListener('change', () => { unit = unitSel.value as SizeUnit; paint(true); });
  swap.addEventListener('click', () => { [wIn, hIn] = [hIn, wIn]; paint(true); });
  paint(true);

  const el = h('div', { class: 'stack' },
    h('label', { class: 'field' }, 'Start from', preset),
    h('div', { class: 'field' }, 'Width × height', h('span', {}, wBox, ' × ', hBox, ' ', unitSel, ' ', swap)),
    readout);
  return { el, value };
}
