import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET, groupOf, newBook, newGroup, newLayer, newPage, PT, type Layer } from './model';
import { defaultCaption, readCaption } from '../engine/lettering/spec';
import { captureStyle } from '../engine/lettering/styles';
import { assetsOf, FORMAT, parseBookFile, SCHEMA, SchemaError, stringifyBookFile, V1_LAYER, type BookFile } from './schema';

function file(): BookFile {
  const book = newBook('Test', 'A. Author', 1000);
  const page = book.pages[0]!;
  page.cuts.push({ id: 'c1', mode: 'panel', pts: [{ x: 0, y: 5 }, { x: 6.6, y: 5 }], extended: [{ x: 0, y: 5 }, { x: 6.625, y: 5 }] });
  page.beats.push({ id: 'b1', desc: 'Rooftop, night.', lines: ['MAYA: Too late.'] });
  const cap = readCaption({ ...defaultCaption(144, 72, 'speech'), text: 'Too late.', tails: [{ x: 180, y: 144, join: 'merged', width: 1.2 }] });
  page.balloons.push({ id: 'l1', cap, src: { beat: 'b1', line: 0 }, speaker: 'MAYA' });
  book.lettering = { ...DEFAULT_SHEET, sizes: { small: 7, body: 9.5, big: 16 } };
  const panel = newGroup('panel', { x: 3, y: 2 });
  const pencil: Layer = { ...newLayer('pencil', 'lp'), strokes: [{ pts: [{ x: 1, y: 1 }, { x: 2, y: 1.5 }], w: 0.02, brushId: 'pencil-hb', seed: 7 }] };
  const ink: Layer = { ...newLayer('ink', 'li'), overFrame: true, strokes: [{ pts: [{ x: 1, y: 1 }, { x: 2, y: 1.5 }, { x: 3, y: 1 }], pressure: [0.2, 0.9, 0.4], w: 0.03, brushId: 'g-pen', seed: 42 }] };
  const colour: Layer = { ...newLayer('colour', 'lc'), fills: [{ at: { x: 2, y: 2 }, color: '#B8432F', gap: 0.02 }] };
  panel.layers.push(pencil, ink, colour);
  page.groups.splice(1, 0, panel);
  return { format: FORMAT, schema: SCHEMA, savedBy: 'test', book, art: { [page.id]: { li: 'assets/a.png', lc: 'assets/b.png' } } };
}

const ink = (f: BookFile) => f.book.pages[0]!.groups[1]!.layers[1]!;

describe('book.json', () => {
  it('retains unused book assets as storage references and rejects invalid keys', () => {
    const f = file();
    const key = 'assets/8ppw6wtu-mz.png';
    f.book.assets = [{ key, name: 'Reference', width: 320, height: 160 }];
    const restored = parseBookFile(stringifyBookFile(f));
    expect(restored.book.assets).toEqual(f.book.assets);
    expect(assetsOf(restored)).toContain(key);
    f.book.assets[0]!.key = '../reference.png';
    expect(() => stringifyBookFile(f)).toThrow(/book.assets/);
  });
  it('keeps trim borders, actual knife gestures, raster symmetry and adjustments on reopen', () => {
    const f = file();
    const p = f.book.pages[0]!;
    p.layout = { gutter: 0.2, border: 0.05, curve: 2, edgeBorder: true };
    p.cuts[0]!.bounded = true;
    ink(f).strokes[0]!.symmetry = { mode: 'quadrant', cx: 3, cy: 5 };
    ink(f).pixelTransforms = [{ kind: 'adjustment', hue: 25, sat: -20, bright: 5, blur: 0.03, strokes: 1, fills: 0 }];
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
  });
  it('round-trips a procedural screentone and its lasso mask', () => {
    const f = file();
    const layer = newLayer('tone');
    layer.screenTone = { shape: 'diamond', frequency: 60, density: 0.25, angle: 45, color: '#191a1f', region: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }] };
    f.book.pages[0]!.groups[1]!.layers.push(layer);
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
    layer.screenTone.frequency = 0;
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/screenTone.frequency/);
  });
  it('round-trips a continuation balloon and rejects missing parents', () => {
    const f = file();
    const page = f.book.pages[0]!;
    page.balloons.push({ id: 'part-2', cap: defaultCaption(144, 100), continuation: { after: 'l1', join: 'separate' } });
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
    page.balloons[1]!.continuation!.after = 'missing';
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/continuation/);
  });
  it('round-trips smudge and transform operations together', () => {
    const f = file();
    ink(f).pixelTransforms = [
      { kind: 'smudge', points: [{ x: 1, y: 1, pressure: 0.2 }, { x: 2, y: 1, pressure: 0.9 }], size: 0.2, strength: 0.6, strokes: 1, fills: 0 },
      { polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], matrix: [1, 0, 0, 1, 0.5, 2], strokes: 1, fills: 0 },
    ];
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
  });
  it('retains pixel transforms and checks their place in the paint history', () => {
    const f = file();
    const op = { polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], matrix: [1, 0, 0, 1, 0.5, 2] as const, strokes: 1, fills: 0 };
    const layer = ink(f);
    layer.pixelTransforms = [{ ...op, matrix: [...op.matrix] }];
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
    layer.pixelTransforms.push({ ...op, matrix: [...op.matrix], strokes: 0 });
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/pixelTransforms\[1\]\.strokes/);
  });
  it('retains coloured strokes and rotated captions in a saved book', () => {
    const f = file();
    ink(f).strokes[0]!.color = '#3f6c9e';
    f.book.pages[0]!.balloons[0]!.rotation = -20;
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
  });
  it('round-trips a book exactly', () => {
    const f = file();
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
    expect(assetsOf(f)).toEqual(new Set(['assets/a.png', 'assets/b.png']));
  });

  it('round-trips book and page grids, downbeat anchors, reveal links and card sketches', () => {
    const f = file();
    const page = f.book.pages[0]!;
    f.book.fixedGrid = { columns: [1, 2], rows: [1, 1, 3], gutter: 0.16 };
    page.grid = { columns: [1], rows: [3, 1], gutter: 0.2 };
    page.downbeat = { x: 0.9, y: 0.9 };
    page.beats.push({ id: 'b2', desc: 'The reveal', lines: [], reveal: { pageId: page.id, beatId: 'b1' }, card: { ratio: 1.25, strokes: [[{ x: 0.2, y: 0.3 }]] } });
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
    page.grid.gutter = 5;
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/grid.gutter/);
  });

  it('opens schema 3 books with their original art and lettering', () => {
    const f = { ...file(), schema: 3 };
    expect(parseBookFile(JSON.stringify(f))).toEqual({ ...f, schema: SCHEMA });
  });

  it('keeps panel assignments, named presets and automatic lettering in schema 5', () => {
    const f = file();
    const p = f.book.pages[0]!;
    p.autoLetter = true;
    p.beats[0]!.dialogue = [{ id: 'line-1', panel: { x: 0.7, y: 0.35 }, preset: 'house-voice' }];
    p.balloons[0]!.src!.lineId = 'line-1';
    p.balloons[0]!.generated = true;
    f.book.lettering!.presets = { 'house-voice': captureStyle(p.balloons[0]!.cap, 'house-voice', 'House voice') };
    ink(f).strokes[0]!.opacity = 0.42;
    const restored = parseBookFile(stringifyBookFile(f));
    expect(restored.book.pages[0]!.beats[0]!.dialogue).toEqual(p.beats[0]!.dialogue);
    expect(restored.book.pages[0]!.balloons[0]!.src).toEqual(p.balloons[0]!.src);
    expect(restored.book.lettering!.presets!['house-voice']!.name).toBe('House voice');
    expect(restored.book.pages[0]!.autoLetter).toBe(true);
    expect(restored.book.pages[0]!.balloons[0]!.generated).toBe(true);
    expect(ink(restored).strokes[0]!.opacity).toBe(0.42);
  });

  it('keeps imported source dimensions and placement apart from the page bitmap', () => {
    const f = file();
    const page = f.book.pages[0]!;
    const art = groupOf(page, 'background');
    const image = { x: 1, y: 2, width: 2.5, height: 1.25, rotation: -12, pixelWidth: 1200, pixelHeight: 600, credit: 'Guest art' };
    art.layers.push({ ...newLayer('colour', 'scan'), image });
    f.art[page.id]!.scan = 'assets/scan.png';
    const restored = parseBookFile(stringifyBookFile(f));
    expect(groupOf(restored.book.pages[0]!, 'background').layers[0]!.image).toEqual(image);
    expect(restored.art[page.id]!.scan).toBe('assets/scan.png');
  });

  it('refuses a file from a newer schema instead of half-reading it', () => {
    const f = { ...file(), schema: SCHEMA + 1 };
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/newer inkflo/);
  });

  it('refuses something that is not an inkflo book', () => {
    expect(() => parseBookFile('{"format":"2dope"}')).toThrow(SchemaError);
    expect(() => parseBookFile('not json')).toThrow(/not valid JSON/);
  });

  it('names the bad field', () => {
    const f = file();
    (f.book.pages[0]!.cuts[0] as { mode: string }).mode = 'diagonal';
    expect(() => parseBookFile(JSON.stringify(f))).toThrow('book.pages[0].cuts[0].mode');
    const g = file();
    g.book.pages[0]!.cuts[0]!.pts = [{ x: 1, y: 1 }];
    expect(() => parseBookFile(JSON.stringify(g))).toThrow(/two points/);
  });

  it('keeps layers, their switches, strokes and fills exactly', () => {
    const back = parseBookFile(stringifyBookFile(file())).book.pages[0]!;
    const g = back.groups[1]!;
    expect(g.kind).toBe('panel');
    expect(g.mask).toBe(true);
    expect(g.layers.map((l) => [l.type, l.prints, l.fillRef])).toEqual([['pencil', false, false], ['ink', true, true], ['colour', true, false]]);
    expect(g.layers[1]!.overFrame).toBe(true);
    expect(g.layers[1]!.strokes[0]!.pressure).toEqual([0.2, 0.9, 0.4]);
    expect(g.layers[2]!.fills[0]!.color).toBe('#B8432F');
  });

  it('always has Over-panels and Background groups', () => {
    const f = file();
    f.book.pages[0]!.groups = f.book.pages[0]!.groups.filter((g) => g.kind === 'panel');
    const back = parseBookFile(JSON.stringify(f)).book.pages[0]!;
    expect(back.groups[0]!.kind).toBe('over');
    expect(back.groups.at(-1)!.kind).toBe('background');
  });

  it('refuses duplicate layer ids and panel groups without an anchor', () => {
    const f = file();
    ink(f).id = 'lp';
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/two layers or groups with id lp/);
    const g = file();
    delete g.book.pages[0]!.groups[1]!.anchor;
    expect(() => parseBookFile(JSON.stringify(g))).toThrow(/anchor/);
  });

  it('names the bad stroke field', () => {
    const cases: [(f: BookFile) => void, string | RegExp][] = [
      [(f) => (ink(f).strokes[0]!.pressure = [0.5]), /one value per point \(3\)/],
      [(f) => (ink(f).strokes[0]!.pressure = [0.5, 1.5, 0.5]), 'book.pages[0].groups[1].layers[1].strokes[0].pressure[1]'],
      [(f) => (ink(f).strokes[0]!.pts = []), /at least one point/],
      [(f) => (ink(f).strokes[0]!.w = 0), 'book.pages[0].groups[1].layers[1].strokes[0].w'],
      [(f) => (ink(f).opacity = 2), 'layers[1].opacity'],
      [(f) => ((ink(f) as { type: string }).type = 'glitter'), 'layers[1].type'],
    ];
    for (const [breakIt, msg] of cases) {
      const f = file();
      breakIt(f);
      expect(() => parseBookFile(JSON.stringify(f))).toThrow(msg);
    }
  });

  it('drops bitmap keys for deleted layers and pages', () => {
    const f = file();
    f.art[f.book.pages[0]!.id]!.gone = 'assets/x.png';
    f.art.nopage = { li: 'assets/y.png' };
    const back = parseBookFile(JSON.stringify(f));
    expect(back.art[f.book.pages[0]!.id]!.gone).toBeUndefined();
    expect(back.art.nopage).toBeUndefined();
  });

  it('refuses duplicate page ids', () => {
    const f = file();
    f.book.pages.push({ ...newPage(), id: f.book.pages[0]!.id });
    expect(() => parseBookFile(JSON.stringify(f))).toThrow(/two pages/);
  });

  it('drops a stale last-page pointer rather than failing', () => {
    const f = file();
    f.book.lastPageId = 'gone';
    expect(parseBookFile(JSON.stringify(f)).book.lastPageId).toBeUndefined();
  });

  it('never writes an invalid file', () => {
    const f = file();
    (f.book as { dpi: number }).dpi = -1;
    expect(() => stringifyBookFile(f)).toThrow('book.dpi');
  });

  it('does not store derived geometry', () => {
    const json = stringifyBookFile(file());
    expect(json).not.toMatch(/"panels"|"gutters"|"thumb"|"bbox"/);
  });
});

describe('schema 1 → 2 migration', () => {
  /** A schema-1 book: page-wide passes in `page.art`, pass bitmaps in `art`. */
  function v1(): unknown {
    const book = newBook('Old', '', 1000) as unknown as { pages: Record<string, unknown>[] };
    const page = book.pages[0]!;
    delete page.groups;
    page.art = {
      pencil: [{ pts: [{ x: 1, y: 1 }], w: 0.02, brushId: 'pencil-hb', seed: 1 }],
      ink: [{ pts: [{ x: 1, y: 1 }, { x: 2, y: 2 }], w: 0.03, brushId: 'g-pen', seed: 2, clip: true }],
      flats: {},
      fills: [{ at: { x: 1.5, y: 1.2 }, color: '#C8553D', gap: 0.02 }],
    };
    return { format: FORMAT, schema: 1, savedBy: 'inkflo 0.0.1', book, art: { [page.id as string]: { pencil: null, ink: 'assets/i.png', colour: 'assets/c.png' } } };
  }

  it('moves the passes into Background layers, keeping strokes, fills and bitmaps', () => {
    const raw = v1() as { book: { pages: { id: string }[] } };
    const id = raw.book.pages[0]!.id;
    const f = parseBookFile(JSON.stringify(raw));
    expect(f.schema).toBe(SCHEMA); // migrated all the way to the current schema
    const page = f.book.pages[0]!;
    const bg = groupOf(page, 'background');
    expect(bg.layers.map((l) => l.type)).toEqual(['pencil', 'ink', 'colour']);
    expect(bg.layers[1]!.strokes[0]!.clip).toBe(true);
    expect(bg.layers[2]!.fills[0]!.color).toBe('#C8553D');
    expect(f.art[id]).toEqual({ [V1_LAYER.pencil(id)]: null, [V1_LAYER.ink(id)]: 'assets/i.png', [V1_LAYER.colour(id)]: 'assets/c.png' });
    // and it saves as schema 2 and reads back the same
    expect(parseBookFile(stringifyBookFile(f))).toEqual(f);
  });
});

describe('schema 2 → 3: balloons become live captions', () => {
  it('keeps place, size, words, tail and script link, in points', () => {
    const f = file() as unknown as { schema: number; book: { pages: { balloons: unknown[] }[] } };
    f.schema = 2;
    f.book.pages[0]!.balloons = [{ id: 'old', x: 2, y: 1, rx: 1, ry: 0.5, text: 'Too late.', tail: { x: 2.5, y: 2 }, style: 'speech', src: { beat: 'b1', line: 0 } },
      { id: 'cap', x: 3, y: 4, rx: 1.2, ry: 0.4, text: 'Midnight.', style: 'caption' }];
    const back = parseBookFile(JSON.stringify(f)).book.pages[0]!.balloons;
    expect(back[0]!.cap.x).toBe(2 * PT);
    expect(back[0]!.cap.y).toBe(1 * PT);
    expect(back[0]!.cap.text).toBe('Too late.');
    expect(back[0]!.cap.tails[0]).toMatchObject({ x: 2.5 * PT, y: 2 * PT });
    expect(back[0]!.cap.minSize![0]).toBeCloseTo(PT * 0.85, 5);
    expect(back[0]!.src).toEqual({ beat: 'b1', line: 0 });
    expect(back[1]!.cap.style).toBe('box');
    expect(back[1]!.cap.tails).toEqual([]);
  });

  it('keeps the style sheet and character styles', () => {
    const f = file();
    const back = parseBookFile(stringifyBookFile(f));
    expect(back.book.lettering!.sizes.body).toBe(9.5);
    expect(back.book.pages[0]!.balloons[0]!.speaker).toBe('MAYA');
  });
});
