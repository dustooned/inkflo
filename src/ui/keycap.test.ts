import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { gesturePrefs } from '../app/gestureprefs';
import { keyText, titleWithKey } from './keycap';

afterEach(() => gesturePrefs.reset());

it('shows the live binding and nothing for a key that is off, unknown or not a key', () => {
  expect(keyText('key.undo')).toMatch(/^(Ctrl|Cmd)\+Z$/);
  expect(titleWithKey('Undo', 'key.undo')).toMatch(/^Undo \((Ctrl|Cmd)\+Z\)$/);
  gesturePrefs.set('key.fit', { spec: 'Alt+F' });
  expect(keyText('key.fit')).toBe('Alt+F');
  gesturePrefs.set('key.fit', { enabled: false });
  expect(keyText('key.fit')).toBeUndefined();
  expect(titleWithKey('Fit page', 'key.fit')).toBe('Fit page');
  expect(keyText('key.teleport')).toBeUndefined();
  expect(keyText('touch.undo')).toBeUndefined();
});

it('shows the first alternate that is still on', () => {
  expect(keyText('key.redo', 'key.redo.alt')).toMatch(/^(Ctrl|Cmd)\+Shift\+Z$/);
  gesturePrefs.set('key.redo', { enabled: false });
  expect(keyText('key.redo', 'key.redo.alt')).toMatch(/^(Ctrl|Cmd)\+Y$/);
  gesturePrefs.set('key.redo.alt', { enabled: false });
  expect(keyText('key.redo', 'key.redo.alt')).toBeUndefined();
});

it('every KeyCap id used by the UI is a key row in the registry', () => {
  const root = join(__dirname);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path);
    }
  };
  walk(root);
  const ids = new Set<string>();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:keyText|keyCap|titleWithKey|keyId)\W+[^'"`]*?['"`](key\.[\w.]+)['"`](?:,\s*['"`](key\.[\w.]+)['"`])?/g)) { ids.add(m[1]!); if (m[2]) ids.add(m[2]); }
  }
  expect(ids.size).toBeGreaterThan(5);
  for (const id of ids) expect(gesturePrefs.get(id)?.input, id).toBe('key');
});

it('no menu or tooltip types a shortcut by hand', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/(keycap|gesturecontrols)\.ts$/.test(name)) {
        readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
          if (/['"`][^'"`]*\b(Ctrl|Cmd)\+[A-Z0-9]/.test(line)) offenders.push(`${name}:${i + 1}`);
        });
      }
    }
  };
  walk(__dirname);
  expect(offenders).toEqual([]);
});
