import './styles/tokens.css';
import './styles/app.css';
import { Studio } from './app/studio';
import { STAGES, type Stage } from './doc/model';
import { renderBook } from './ui/bookview';
import { renderDesk } from './ui/desk';
import { h, toast } from './ui/dom';
import { renderHome } from './ui/home';
import { applyTheme } from './ui/prefs';
import { installAffordances } from './ui/affordances';

/** Hash routes: #home, #book/:id, #desk/:book/:page/:desk (no server needed). */
async function boot(): Promise<void> {
  applyTheme();
  installAffordances();
  const root = document.getElementById('app')!;
  root.replaceChildren(h('p', { style: 'padding:2rem' }, 'Opening your library…'));
  let studio: Studio;
  try {
    studio = await Studio.open();
  } catch (e) {
    root.replaceChildren(h('p', { style: 'padding:2rem' }, `inkflo could not start: ${e instanceof Error ? e.message : String(e)}`));
    return;
  }
  window.addEventListener('inkflo:toast', (e) => toast((e as CustomEvent<string>).detail, 5000));
  (window as unknown as { __inkflo: Studio }).__inkflo = studio;

  let cleanup: (() => void) | null = null;
  let seq = 0;
  const go = (hash: string) => {
    if (location.hash === hash) void route();
    else location.hash = hash;
  };
  async function route(): Promise<void> {
    const my = ++seq;
    cleanup?.();
    cleanup = null;
    const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    try {
      if (parts[0] === 'book' && parts[1]) {
        const off = await renderBook(root, studio, parts[1], go);
        if (my === seq) cleanup = off;
        else off();
        return;
      }
      if (parts[0] === 'desk' && parts[1] && parts[2]) {
        const stage = (STAGES as readonly string[]).includes(parts[3] ?? '') ? (parts[3] as Stage) : 'script';
        const off = await renderDesk(root, studio, parts[1], parts[2], stage, go);
        if (my === seq) cleanup = off;
        else off();
        return;
      }
      await studio.close();
      if (my === seq) await renderHome(root, studio, go);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 5000);
      if (location.hash !== '#home') location.hash = '#home';
    }
  }
  window.addEventListener('hashchange', () => void route());
  await route();
}

void boot();
