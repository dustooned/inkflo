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
