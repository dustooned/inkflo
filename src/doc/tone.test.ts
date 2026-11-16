import { expect, it } from 'vitest';
import { newBook, newLayer } from './model';
import { FORMAT, parseBookFile, SCHEMA, stringifyBookFile } from './schema';

it('keeps gradient tones and layers shown as tone in the book file', () => {
  const book = newBook('Tone');
  const g = book.pages[0]!.groups.find((x) => x.kind === 'background')!;
  const tone = newLayer('tone');
  tone.screenTone = { shape: 'dot', frequency: 60, density: 0.2, angle: 45, color: '#191a1f', gradient: { kind: 'radial', from: { x: 1, y: 2 }, to: { x: 3, y: 2 }, stops: [{ at: 0, density: 0 }, { at: 0.5, density: 0.3 }, { at: 1, density: 0.7 }] } };
  const paint = newLayer('colour');
  paint.asTone = { shape: 'square', frequency: 85, angle: 15, color: '#223344' };
  g.layers.push(tone, paint);
  const f = parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }));
  const layers = f.book.pages[0]!.groups.find((x) => x.kind === 'background')!.layers;
  expect(layers.find((l) => l.id === tone.id)!.screenTone!.gradient).toEqual(tone.screenTone.gradient);
  expect(layers.find((l) => l.id === paint.id)!.asTone).toEqual(paint.asTone);
  // a gradient needs two stops
  tone.screenTone.gradient!.stops = [{ at: 0, density: 1 }];
  expect(() => parseBookFile(stringifyBookFile({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} }))).toThrow(/2 to 16 stops/);
});

import { setTones, tonesOf, type ScreenTone } from './model';

const area = (shape: ScreenTone['shape'], density: number): ScreenTone => ({ shape, frequency: 60, density, angle: 45, color: '#191a1f' });

it('holds several tone areas in one layer and keeps old single-tone layers working', () => {
  const layer = newLayer('tone');
  expect(tonesOf(layer)).toEqual([]);
  setTones(layer, [area('dot', 0.2)]);
  // an old file's layer: one tone, no moreTones
  expect(tonesOf(layer)).toHaveLength(1);
  expect('moreTones' in layer).toBe(false);
  setTones(layer, [...tonesOf(layer), area('line', 0.3), area('cross', 0.4)]);
  expect(layer.screenTone!.shape).toBe('dot');
  expect(layer.moreTones!.map((t) => t.shape)).toEqual(['line', 'cross']);
  expect(tonesOf(layer).map((t) => t.shape)).toEqual(['dot', 'line', 'cross']);
  // removing the first area promotes the next one
  const list = tonesOf(layer);
  list.splice(0, 1);
  setTones(layer, list);
  expect(layer.screenTone!.shape).toBe('line');
  expect(layer.moreTones!.map((t) => t.shape)).toEqual(['cross']);
  // removing them all leaves a plain layer
  setTones(layer, []);
  expect(layer.screenTone).toBeUndefined();
  expect(layer.moreTones).toBeUndefined();
});

it('round-trips and validates extra tone areas', () => {
  const book = newBook('Tone');
  const g = book.pages[0]!.groups.find((x) => x.kind === 'background')!;
  const layer = newLayer('tone');
  setTones(layer, [area('dot', 0.2), area('line', 0.3)]);
  g.layers.push(layer);
  const file = () => ({ format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: {} } as const);
  const back = parseBookFile(stringifyBookFile(file())).book.pages[0]!.groups.find((x) => x.kind === 'background')!.layers.find((l) => l.id === layer.id)!;
  expect(tonesOf(back)).toEqual(tonesOf(layer));
  layer.moreTones![0]!.frequency = 0;
  expect(() => parseBookFile(JSON.stringify(file()))).toThrow(/moreTones\[0\]\.frequency/);
});
