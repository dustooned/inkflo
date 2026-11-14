import { describe, expect, it } from 'vitest';
import { newBook } from '../doc/model';
import { presetCuts } from '../geom/carve';
import { buildManifest, GAME_VERSION, gameReadme, inkScript, yarnScript } from './gameexport';

function book() {
  const b = newBook('Rooftop');
  const p = b.pages[0]!;
  p.cuts = presetCuts(p, 'rows2');
  p.beats = [{ id: 'b1', desc: 'Night roof', lines: ['MAYA (whisper): Look {up}.', 'CAPTION: Midnight.'] }];
  return b;
}
const box = () => ({ x0: 10, y0: 20, x1: 82, y1: 56 });

describe('game package', () => {
  it('builds a versioned manifest in pixels', () => {
    const b = book();
    const p = b.pages[0]!;
    const m = buildManifest(b, [p], 2048, box, ['dialogue.yarn']);
    expect(m.format).toBe('inkflo-game');
    expect(m.version).toBe(GAME_VERSION);
    const pg = m.pages[0]!;
    expect(pg.size.width).toBe(2048);
    expect(pg.size.height).toBe(Math.round(p.heightIn * 2048 / p.widthIn));
    expect(pg.panels).toHaveLength(2);
    expect(pg.panels[0]!.image).toBe('pages/001/panel-01.png');
    expect(pg.panels[0]!.box.x).toBeGreaterThanOrEqual(0);
    expect(pg.panels[0]!.box.width).toBeLessThanOrEqual(2048);
    expect(pg.panels[0]!.lines[0]).toEqual({ speaker: 'MAYA', kind: 'whisper', text: 'Look {up}.' });
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it('writes Yarn with one node per page and panel tags', () => {
    const b = book();
    b.pages.push({ ...structuredClone(b.pages[0]!), id: 'p2' });
    const m = buildManifest(b, b.pages, 1024, box, ['dialogue.yarn']);
    const y = yarnScript(m);
    expect(y).toMatch(/^title: Page1\n---\n<<panel 1>>\nMAYA: Look up\. #whisper #page1_panel1$/m);
    expect(y).toMatch(/^Narrator: Midnight\. #caption #page1_panel1$/m);
    expect(y).toMatch(/<<jump Page2>>\n===/);
    expect(y.match(/^===$/gm)).toHaveLength(2);
  });

  it('writes Ink with knots, escaped text and an END', () => {
    const b = book();
    const m = buildManifest(b, b.pages, 1024, box, ['dialogue.ink']);
    const ink = inkScript(m);
    expect(ink.startsWith('-> page_1')).toBe(true);
    expect(ink).toMatch(/^=== page_1 ===$/m);
    expect(ink).toMatch(/^MAYA: Look \\\{up\\\}\. #panel:1 #whisper$/m);
    expect(ink).toMatch(/^Midnight\. #panel:1 #caption$/m);
    expect(ink.trim().endsWith('-> END')).toBe(true);
  });

  it('falls back to lettering when a panel has no script', () => {
    const b = book();
    const p = b.pages[0]!;
    p.beats = [];
    p.balloons = [{ id: 'l1', speaker: 'Rin', cap: { x: 100, y: 100, text: 'Hi.', style: 'speech', tails: [{ x: 120, y: 180 }] } } as never];
    const m = buildManifest(b, [p], 1000, box, ['dialogue.yarn']);
    const bal = m.pages[0]!.balloons[0]!;
    expect(bal.panel).toBe(1);
    const k = 1000 / p.widthIn / 72;
    expect(bal.box.x).toBeCloseTo(10 * k, 0);
    expect(bal.tails[0]!.y).toBeCloseTo(180 * k, 0);
    expect(yarnScript(m)).toMatch(/Rin: Hi\./);
    expect(gameReadme(m)).toMatch(/Godot/);
  });
});
