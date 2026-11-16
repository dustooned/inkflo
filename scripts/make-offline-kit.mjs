// Builds the classroom offline kit: dist/ plus launchers and a student README, zipped.
// Usage: npm run package:offline   (runs after `npm run build`)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync('dist/index.html')) throw new Error('Run `npm run build` first.');
const out = 'dist-offline/inkflo-offline';
rmSync('dist-offline', { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('dist', out, { recursive: true, filter: (p) => !p.split('\\').join('/').includes('examples/godot-reader') });
cpSync('scripts/offline-kit', out, { recursive: true });
execFileSync('tar', ['-a', '-c', '-f', 'inkflo-offline.zip', 'inkflo-offline'], { cwd: 'dist-offline', stdio: 'inherit' });
console.log('Wrote dist-offline/inkflo-offline.zip');
