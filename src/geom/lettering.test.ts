import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET, newBook, newPage, PT, type Book, type Letter, type Page } from '../doc/model';
import { derivePanels, panelAt, presetCuts } from './carve';
import { applyScriptWording, assignDialoguePanel, bindDialogue, centreIn, dialogueText, letterForLine, lineFor, linesFromDialogueText, newLetter, nextFreeLine, omitDialogue, parseLine, readingOrderIssues, reconcileDialogue, scriptRevision, renameSpeaker, replaceDialogue, speakers, syncLettersFromScript, syncScriptFromLetter, withCharacterStyle } from './lettering';
import { preflightPage } from './preflight';
import { applyFix, contrast, readability, readabilityAll, safeFixes, snapScale, TARGETS } from './readability';
import { comicInfo } from '../io/exports';
import { balloonGroup, balloonPaintOrder, firstBalloon } from './captiongroup';

function page(): Page {
  const p = newPage(0);
  p.cuts = presetCuts(p, 'grid4'); // 4 panels: TL, TR, BL, BR
  p.beats = ['a', 'b', 'c', 'd'].map((id) => ({ id, desc: id, lines: ['MAYA: One.', 'JO: Two.'] }));
  return p;
}

function bookWith(p: Page): Book {
  const b = newBook('T');
  b.pages = [p];
  return b;
}

/** A letter at a point given in inches, linked to a script line. */
const at = (book: Book, p: Page, xIn: number, yIn: number, beat: string, line: number): Letter => {
  const b = p.beats.find((x) => x.id === beat)!;
  return newLetter(book, { x: xIn * PT, y: yIn * PT }, 'speech', { beat: b, index: line });
};

describe('script lines', () => {
  it('keeps continuation words in one script line and restores its split on script edits', () => {
    const p = page(), book = bookWith(p);
    const root = at(book, p, 1, 1, 'a', 0);
    const next = newLetter(book, { x: 72, y: 110 }, 'speech');
    next.continuation = { after: root.id, join: 'stack' };
    next.cap.text = 'Then two.';
    p.balloons = [root, next];
    expect(firstBalloon(p.balloons, next)).toBe(root);
    expect(balloonPaintOrder(balloonGroup(p.balloons, root))).toEqual([next, root]);
    expect(syncScriptFromLetter(p, root)).toBe(true);
    expect(p.beats[0]!.lines[0]).toBe('MAYA: One. Then two.');
    p.beats[0]!.lines[0] = 'MAYA: First. Now three words.';
    expect(syncLettersFromScript(p)).toBe(true);
    expect(p.balloons.map((l) => l.cap.text)).toEqual(['First.', 'Now three words.']);
  });
  it('reads speakers, captions, sound effects and how a line is said', () => {
    expect(parseLine('MAYA: Too late.')).toEqual({ speaker: 'MAYA', text: 'Too late.', style: 'speech' });
    expect(parseLine('CAPTION: Midnight.')).toEqual({ speaker: null, text: 'Midnight.', style: 'box' });
    expect(parseLine('SFX: KRAK')).toEqual({ speaker: null, text: 'KRAK', style: 'sfx' });
    expect(parseLine('JO (whisper): Shh.')).toEqual({ speaker: 'JO', text: 'Shh.', style: 'whisper' });
    expect(parseLine('JO (shouting): RUN!').style).toBe('shout');
    expect(parseLine('Just words.')).toEqual({ speaker: null, text: 'Just words.', style: 'speech' });
  });

  it('a letter made from a line reads back as the same line', () => {
    const p = page();
    p.beats[0]!.lines = ['JO (whisper): Shh.', 'CAPTION: Later.', 'SFX: BLAM'];
    const book = bookWith(p);
    for (let i = 0; i < 3; i++) {
      const l = at(book, p, 1, 1, 'a', i);
      expect(lineFor(l)).toBe(p.beats[0]!.lines[i]);
    }
  });

  it('hands out the next unlettered line of a beat', () => {
    const p = page();
    const book = bookWith(p);
    expect(nextFreeLine(p, p.beats[0]!)).toBe(0);
    p.balloons.push(at(book, p, 1, 1, 'a', 0));
    expect(nextFreeLine(p, p.beats[0]!)).toBe(1);
    p.balloons.push(at(book, p, 2, 1, 'a', 1));
    expect(nextFreeLine(p, p.beats[0]!)).toBeNull();
  });
});

describe('script ↔ lettering sync', () => {
  it('preserves legacy balloon links and placement when dialogue is inserted or reordered', () => {
    const p = page();
    const book = bookWith(p);
    const a = p.beats[0]!;
    const manual = at(book, p, 1.5, 1.5, 'a', 1);
    p.balloons.push(manual);
    replaceDialogue(p, a, ['NEW: Intro.', 'JO: Two.', 'MAYA: One.']);
    reconcileDialogue(book, p, derivePanels(p), true);
    expect(letterForLine(p, a, 1)?.id).toBe(manual.id);
    expect(manual.cap.x).toBe(1.5 * PT);
    expect(manual.cap.text).toBe('Two.');
    expect(letterForLine(p, a, 0)?.cap.text).toBe('Intro.');
    expect(p.balloons).toHaveLength(9);
    a.lines[1] = 'JO: Revised.';
    reconcileDialogue(book, p, derivePanels(p));
    expect(manual.cap.text).toBe('Two.');
    expect(scriptRevision(p, manual)?.next.text).toBe('Revised.');
    const old = structuredClone(manual.cap);
    expect(applyScriptWording(p, manual)).toBe(true);
    expect(manual.cap).toEqual({ ...old, text: 'Revised.' });
  });

  it('keeps a reviewed script revision until the line changes again', () => {
    const p = page();
    const book = bookWith(p);
    const a = p.beats[0]!;
    const l = at(book, p, 1, 1, 'a', 0);
    p.balloons.push(l);
    a.lines[0] = 'MAYA: Revised.';
    l.keptScriptLine = scriptRevision(p, l)!.raw;
    reconcileDialogue(book, p, derivePanels(p));
    expect(scriptRevision(p, l)).toBeUndefined();
    expect(l.cap.text).toBe('One.');
    a.lines[0] = 'MAYA: Revised again.';
    reconcileDialogue(book, p, derivePanels(p));
    expect(scriptRevision(p, l)?.next.text).toBe('Revised again.');
  });

  it('moves a balloon when reassigned, and keeps a skipped line from coming back', () => {
    const p = page();
    const book = bookWith(p);
    const panels = derivePanels(p);
    p.autoLetter = true;
    reconcileDialogue(book, p, panels);
    const a = p.beats[0]!;
    const first = letterForLine(p, a, 0)!;
    first.cap.fill = '#ffeecc';
    assignDialoguePanel(p, panels, a, 0, panels[3]!);
    expect(panelAt(panels, centreIn(first))).toBe(panels[3]);
    expect(first.cap.fill).toBe('#ffeecc');
    expect(readingOrderIssues(p, panels).filter((x) => x.balloon.id === first.id && /sits/.test(x.message))).toEqual([]);
    omitDialogue(p, first);
    p.balloons = p.balloons.filter((x) => x !== first);
    reconcileDialogue(book, p, panels);
    expect(letterForLine(p, a, 0)).toBeUndefined();
  });

  it('removes a generated balloon for deleted dialogue but preserves a refined balloon as free text', () => {
    const p = page();
    const book = bookWith(p);
    const panels = derivePanels(p);
    reconcileDialogue(book, p, panels, true);
    const a = p.beats[0]!;
    const first = letterForLine(p, a, 0)!;
    const second = letterForLine(p, a, 1)!;
    delete second.generated;
    bindDialogue(p, a).splice(0, 2);
    a.lines = [];
    reconcileDialogue(book, p, panels);
    expect(p.balloons).not.toContain(first);
    expect(p.balloons).toContain(second);
    expect(second.src).toBeUndefined();
  });

  it('round-trips explicit line breaks in one balloon through the beat text editor', () => {
    const lines = ['MAYA: First\nSecond', 'Keep \\n literally'];
    expect(linesFromDialogueText(dialogueText(lines))).toEqual(lines);
    expect(parseLine(lines[0]!)).toEqual({ speaker: 'MAYA', text: 'First\nSecond', style: 'speech' });
  });
  it('editing a script line updates its balloon; editing the balloon updates the line', () => {
    const p = page();
    const book = bookWith(p);
    const l = at(book, p, 1, 1, 'a', 0);
    p.balloons.push(l);
    p.beats[0]!.lines[0] = 'MAYA: Changed in the script.';
    expect(syncLettersFromScript(p)).toBe(true);
    expect(l.cap.text).toBe('Changed in the script.');
    l.cap = { ...l.cap, text: 'Changed on the page.' };
    expect(syncScriptFromLetter(p, l)).toBe(true);
    expect(p.beats[0]!.lines[0]).toBe('MAYA: Changed on the page.');
    expect(syncLettersFromScript(p)).toBe(false); // already in step
  });

  it('renaming a speaker renames script lines, balloons and the character style', () => {
    const p = page();
    const book = bookWith(p);
    const l = at(book, p, 1, 1, 'a', 0);
    p.balloons.push(l);
    book.lettering = withCharacterStyle(DEFAULT_SHEET, 'MAYA', { ...l.cap, font: 'patrick-hand' });
    renameSpeaker(book, 'maya', 'Mai');
    expect(p.beats[0]!.lines[0]).toBe('Mai: One.');
    expect(l.speaker).toBe('Mai');
    expect(Object.keys(book.lettering!.characters)).toEqual(['MAI']);
    expect(speakers(book)).toEqual(['Mai', 'JO']);
  });

  it('new balloons for a speaker take their character style', () => {
    const p = page();
    const book = bookWith(p);
    const first = at(book, p, 1, 1, 'a', 0);
    book.lettering = withCharacterStyle(DEFAULT_SHEET, 'MAYA', { ...first.cap, font: 'patrick-hand', fill: '#ffeecc' });
    const next = at(book, p, 1, 2, 'b', 0);
    expect(next.speaker).toBe('MAYA');
    expect(next.cap.font).toBe('patrick-hand');
    expect(next.cap.fill).toBe('#ffeecc');
    expect(at(book, p, 1, 2, 'b', 1).cap.font).toBe(DEFAULT_SHEET.font); // JO has none
  });
});

describe('reading order check', () => {
  it('passes balloons placed in script order', () => {
    const p = page();
    const book = bookWith(p);
    p.balloons = [at(book, p, 1, 1, 'a', 0), at(book, p, 2.5, 1.5, 'a', 1), at(book, p, 4.5, 1, 'b', 0)];
    expect(readingOrderIssues(p, derivePanels(p))).toEqual([]);
  });

  it('flags a balloon the eye reaches before an earlier line, and a line in the wrong panel', () => {
    const p = page();
    const book = bookWith(p);
    const late = at(book, p, 1, 1, 'a', 1);
    const early = at(book, p, 2.5, 2, 'a', 0);
    p.balloons = [late, early];
    expect(readingOrderIssues(p, derivePanels(p)).map((i) => i.balloon.id)).toEqual([early.id]);
    p.balloons = [at(book, p, 1, 8, 'a', 0)];
    expect(readingOrderIssues(p, derivePanels(p))[0]!.message).toMatch(/panel 1 sits in panel 3/);
  });
});

describe('readable lettering', () => {
  const book = newBook('T');
  const letter = (patch: Partial<Letter['cap']> = {}, extra: Partial<Letter> = {}): Letter => {
    const l = newLetter(book, { x: 100, y: 100 }, 'speech');
    l.cap = { ...l.cap, ...patch };
    return { ...l, ...extra };
  };

  it('body text at the house size reads well in print', () => {
    expect(readability(letter(), DEFAULT_SHEET).level).toBe('good');
  });

  it('judges size at real print size, with limits from the style sheet', () => {
    const tiny = letter({ size: 'small', scale: 0.8 }); // 7.5 × 0.8 = 6 pt
    const r = readability(tiny, DEFAULT_SHEET);
    expect(r.level).toBe('bad');
    expect(r.issues[0]!.fix).toBe('enlarge');
    expect(readability(letter({ size: 'small' }), DEFAULT_SHEET).level).toBe('risk'); // 7.5 pt < 8
  });

  it('checks every output: body text fine in print can be at risk at digest size', () => {
    const l = letter({ size: 'small', scale: 1.15 }); // 8.6 pt print
    expect(readabilityAll(l, DEFAULT_SHEET).byTarget).toHaveLength(1); // print only by default
    const all = readabilityAll(l, { ...DEFAULT_SHEET, checks: ['Digest (5 × 7.5 in)'] });
    expect(all.byTarget.find((t) => t.target === TARGETS[0])!.r.level).toBe('good');
    expect(all.byTarget.find((t) => t.target === TARGETS[1])!.r.level).not.toBe('good');
  });

  it('small on purpose is left alone', () => {
    expect(readability(letter({ size: 'small', scale: 0.6 }, { smallOk: true }), DEFAULT_SHEET).issues.filter((i) => i.fix === 'enlarge')).toEqual([]);
  });

  it('flags low contrast and hairline borders, and fixes them', () => {
    const grey = letter({ textColor: '#999999', fill: '#aaaaaa' });
    expect(contrast('#111111', '#ffffff')).toBeGreaterThan(15);
    expect(readability(grey, DEFAULT_SHEET).level).toBe('bad');
    const fixed = applyFix(grey.cap, DEFAULT_SHEET, 'contrast');
    expect(readability({ ...grey, cap: fixed }, DEFAULT_SHEET).issues.some((i) => i.fix === 'contrast')).toBe(false);
    const thin = letter({ inkWidth: 0.01 });
    expect(readability(thin, DEFAULT_SHEET).issues.map((i) => i.fix)).toContain('thicken');
    expect(readability({ ...thin, cap: applyFix(thin.cap, DEFAULT_SHEET, 'thicken') }, DEFAULT_SHEET).issues.map((i) => i.fix)).not.toContain('thicken');
  });

  it('a sound effect without an outline is at risk; the fix adds one', () => {
    const sfx = newLetter(book, { x: 50, y: 50 }, 'sfx');
    sfx.cap = { ...sfx.cap, textOutline: null };
    expect(safeFixes(sfx, DEFAULT_SHEET)).toContain('backing');
    expect(applyFix(sfx.cap, DEFAULT_SHEET, 'backing').textOutline).not.toBeNull();
  });

  it('sizes snap to steps and never below the minimum with Keep readable', () => {
    const c = letter({ size: 'small' }).cap;
    expect(snapScale(c, DEFAULT_SHEET, 1.12, false)).toBe(1.15);
    expect(snapScale(c, DEFAULT_SHEET, 0.5, true)).toBeCloseTo(DEFAULT_SHEET.minPt / 7.5, 3);
    expect(snapScale(c, DEFAULT_SHEET, 1.12, false, true)).toBe(1.12); // Alt: free
  });
});

describe('print preflight', () => {
  it('lists what to fix', () => {
    const p = page();
    const book = bookWith(p);
    p.balloons = [{ ...at(book, p, 0.1, 0.1, 'a', 0) }];
    const box = (l: Letter) => ({ x0: l.cap.x - 20, y0: l.cap.y - 10, x1: l.cap.x + 20, y1: l.cap.y + 10 });
    const warns = preflightPage(book, p, derivePanels(p), box).filter((c) => c.level === 'warn').map((c) => c.text).join(' | ');
    expect(warns).toMatch(/No ink/);
    expect(warns).toMatch(/safe area/);
    expect(warns).toMatch(/7 script lines not lettered/);
  });
});

describe('comic archive', () => {
  it('writes ComicInfo.xml with escaped metadata', () => {
    const b = newBook('Cats & <Dogs>', 'D.');
    const x = comicInfo(b);
    expect(x).toContain('<Title>Cats &amp; &lt;Dogs&gt;</Title>');
    expect(x).toContain('<PageCount>1</PageCount>');
    expect(x).toContain('Type="FrontCover"');
  });
});
