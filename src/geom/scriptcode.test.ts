import { describe, expect, it } from 'vitest';
import { formatScriptCode, parseScriptCode } from './scriptcode';

describe('script code', () => {
  const src = [
    '# page one',
    'PANEL 1: Wide shot. Mina runs for the last train.',
    '> Rain on the platform.',
    'MINA: Hold that door!',
    'MINA (whisper): Please…',
    '',
    'PANEL 2: Close-up. A hand catches the door.',
    'CAPTION: For once, she was right on time.',
    'SFX: KLANG',
  ].join('\n');

  it('reads panels, descriptions and every kind of line', () => {
    const p = parseScriptCode(src);
    expect(p.errors).toEqual([]);
    expect(p.beats).toEqual([
      { desc: 'Wide shot. Mina runs for the last train.\nRain on the platform.', lines: ['MINA: Hold that door!', 'MINA (whisper): Please…'] },
      { desc: 'Close-up. A hand catches the door.', lines: ['CAPTION: For once, she was right on time.', 'SFX: KLANG'] },
    ]);
    const kinds = p.lines.map((l) => l.tokens.map((t) => t.kind).filter((k) => k !== 'text'));
    expect(kinds[0]).toEqual(['comment']);
    expect(kinds[1]).toEqual(['panel', 'desc']);
    expect(kinds[4]).toEqual(['speaker', 'manner']);
    expect(kinds[7]).toEqual(['caption']);
    expect(kinds[8]).toEqual(['sfx']);
  });

  it('round-trips its own output and keeps every character on screen', () => {
    const beats = parseScriptCode(src).beats;
    expect(parseScriptCode(formatScriptCode(beats)).beats).toEqual(beats);
    for (const [i, line] of parseScriptCode(src).lines.entries()) expect(line.tokens.map((t) => t.text).join('')).toBe(src.split('\n')[i]);
  });

  it('accepts lowercase, P and unnumbered panels, and line breaks inside a balloon', () => {
    const p = parseScriptCode('panel: Rooftop\np: Street\nMAYA: one\\ntwo');
    expect(p.beats.map((b) => b.desc)).toEqual(['Rooftop', 'Street']);
    expect(p.beats[1]!.lines).toEqual(['MAYA: one\ntwo']);
  });

  it('explains mistakes in plain words', () => {
    const p = parseScriptCode('MINA: Too early\nPANEL 3: First\nMAYA:');
    expect(p.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(p.errors[0]!.message).toMatch(/before the first PANEL/);
    expect(p.errors[1]!.message).toMatch(/renumbered/);
    expect(p.errors[2]!.message).toMatch(/no words/);
    expect(p.beats).toHaveLength(1);
  });

  it('does not take ordinary words starting with p for a panel', () => {
    const p = parseScriptCode('PANEL 1: x\nPlease hold the door');
    expect(p.beats).toHaveLength(1);
    expect(p.beats[0]!.lines).toEqual(['Please hold the door']);
  });
});
