import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Offline support: after the build, writes `sw.js` with a precache list of every emitted file
 * (bundle + public/ files), versioned by their names and sizes. The app is static, so caching every
 * file once is enough to run with no network. Nothing is sent anywhere.
 */
export function offlinePlugin(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'inkflo-offline',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.startsWith('examples/godot-reader'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(String(statSync(join(outDir, f)).size)).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(['./', ...files]));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}
