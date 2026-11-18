import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** Rule hygiene for the stylesheet (the last polish pass): these should stay true. */
const css = readFileSync(join(__dirname, 'app.css'), 'utf8');

it('app.css has no !important', () => {
  expect(css.match(/!important/g) ?? []).toEqual([]);
});

it('every transition sits inside the no-preference motion block', () => {
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const outside = (css.slice(0, start) + css.slice(end)).match(/[^-\w]transition(-[a-z]+)?\s*:/g) ?? [];
  expect(outside).toEqual([]);
});

it('sizes and radii come from the tokens, not literals', () => {
  expect(css.match(/font-size:\s*[0-9]/g) ?? []).toEqual([]);
  expect(css.match(/border-radius:\s*[0-9]/g) ?? []).toEqual([]);
});
