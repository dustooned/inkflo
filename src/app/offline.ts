/** Offline support: registers the service worker, tracks "ready offline", and offers install. */

type InstallPrompt = Event & { prompt(): Promise<unknown>; userChoice: Promise<{ outcome: string }> };

export type OfflineState = 'ready' | 'preparing' | 'unavailable';

let installEvent: InstallPrompt | null = null;
let state: OfflineState = 'unavailable';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const offlineState = (): OfflineState => state;
export const canInstall = (): boolean => installEvent !== null;
export const isInstalled = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export function onOfflineChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Show the browser's own install prompt (Chrome, Edge). Resolves true if the student accepted. */
export async function install(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  emit();
  return outcome === 'accepted';
}

export function registerOffline(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallPrompt;
    emit();
  });
  window.addEventListener('appinstalled', () => { installEvent = null; emit(); });
  // Only in a built app, and only where browsers allow it (https or localhost).
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  state = 'preparing';
  navigator.serviceWorker
    .register(import.meta.env.BASE_URL + 'sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { state = 'ready'; emit(); })
    .catch(() => { state = 'unavailable'; emit(); });
}
