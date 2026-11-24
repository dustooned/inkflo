import { expect, it } from 'vitest';
import { isZoomKey } from './browserzoom';

const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; code: string }> = {}) =>
  ({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, ...mods });

it('recognises the browser zoom shortcuts on every platform and layout', () => {
  for (const k of ['+', '=', '-', '_', '0']) expect(isZoomKey(key(k, { ctrlKey: true })), k).toBe(true);
  expect(isZoomKey(key('=', { metaKey: true }))).toBe(true);
  // shifted or non-US layouts report the physical key
  expect(isZoomKey(key('Dead', { ctrlKey: true, code: 'Equal' }))).toBe(true);
  expect(isZoomKey(key('Unidentified', { ctrlKey: true, code: 'NumpadAdd' }))).toBe(true);
});

it('leaves everything else alone', () => {
  expect(isZoomKey(key('=', {}))).toBe(false);
  expect(isZoomKey(key('z', { ctrlKey: true }))).toBe(false);
  expect(isZoomKey(key('-', { ctrlKey: true, altKey: true }))).toBe(false);
});
