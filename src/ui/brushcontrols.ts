import { h } from './dom';

export function clampToolValue(value: number, min: number, max: number, step: number): number {
  return Math.max(min, Math.min(max, Math.round(value / step) * step));
}

export function brushControl(label: string, unit: string, value: number, min: number, max: number, step: number, onInput: (value: number) => void, commit: () => void, logarithmic = false): HTMLElement {
  const toSlider = (v: number) => logarithmic ? 1000 * Math.log(v / min) / Math.log(max / min) : v;
  const fromSlider = (v: number) => logarithmic ? min * (max / min) ** (v / 1000) : v;
  const number = h('input', { type: 'number', value: Number(value.toFixed(2)), min, max, step, 'aria-label': label + ' in ' + unit });
  const range = h('input', { type: 'range', min: logarithmic ? 0 : min, max: logarithmic ? 1000 : max, step: logarithmic ? 1 : step, value: toSlider(value), 'aria-label': label, 'aria-orientation': 'vertical' });
  const update = (raw: number) => {
    value = Number.isFinite(raw) ? clampToolValue(raw, min, max, step) : value;
    number.value = String(Number(value.toFixed(2)));
    range.setAttribute('aria-valuetext', number.value + ' ' + unit);
    onInput(value);
  };
  range.setAttribute('aria-valuetext', number.value + ' ' + unit);
  range.addEventListener('input', () => update(fromSlider(range.valueAsNumber)));
  range.addEventListener('change', commit);
  number.addEventListener('change', () => {
    update(number.valueAsNumber);
    range.value = String(toSlider(value));
    commit();
  });
  number.addEventListener('keydown', (e) => { if (e.key === 'Enter') number.blur(); });
  return h('div', { class: 'brush-control' }, h('span', {}, label), range, h('label', { class: 'brush-value' }, number, h('small', {}, unit)));
}
