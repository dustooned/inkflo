import { expect, it } from 'vitest';
import { ICON_BY_LABEL, ICONS, iconFor } from './icons';
import { MARQUEE_SHAPES } from './marquee';

it('maps every label to an icon that exists', () => {
  for (const [label, name] of Object.entries(ICON_BY_LABEL)) expect(ICONS[name], label).toBeTruthy();
});

it('reads labels the way controls show them', () => {
  expect(iconFor('Export ▾')).toBe('export');
  expect(iconFor('Layers…')).toBe('layers');
  expect(iconFor('Eraser: Erase ink')).toBe('eraser');
  expect(iconFor('Speech balloon here')).toBe('speech');
  expect(iconFor('Pick colour here')).toBe('eyedropper');
  expect(iconFor('Something new')).toBeNull();
  for (const shape of MARQUEE_SHAPES) expect(iconFor(shape.label), shape.label).not.toBeNull();
});
