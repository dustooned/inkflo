import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHEET, type Letter } from '../doc/model';
import { defaultCaption } from '../engine/lettering/spec';
import { rotateAround } from '../geom/resizebox';
import { hitLetter, letterBodyBox, letterBox } from './caption';

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText: (text: string) => ({ width: text.length * 18 }) }) }) });
});
afterAll(() => vi.unstubAllGlobals());

const page = [DEFAULT_SHEET, 6.625, 10.187] as const;

function rotatedLetter(): Letter {
  return { id: 'speech', rotation: 36, cap: {
    ...defaultCaption(280, 220), text: 'Wait!', minSize: [48, 23], look: { wobble: 0 },
    tails: [{ x: 80, y: 245, join: 'merged', width: 1.2 }],
  } };
}

describe('rotated balloon geometry', () => {
  it('keeps the transform frame on the body even with a long or bent tail', () => {
    const l = rotatedLetter();
    const bare = { ...l, cap: { ...l.cap, tails: [] } };
    const b = letterBodyBox(bare, ...page);
    expect(letterBodyBox(l, ...page)).toEqual(b);
    l.cap.tails[0]!.bend = [190, 180];
    expect(letterBodyBox(l, ...page)).toEqual(b);
    expect(letterBox(l, ...page).x0).toBeCloseTo(80);
  });

  it('hits the painted tail and ignores its old, erroneously rotated position', () => {
    const l = rotatedLetter();
    const onTail = { x: 140, y: 237.5 };
    expect(hitLetter(l, page[0], onTail, page[1], page[2])).toBe(true);
    expect(hitLetter(l, page[0], rotateAround(onTail, l.cap, l.rotation!), page[1], page[2])).toBe(false);
  });
});
