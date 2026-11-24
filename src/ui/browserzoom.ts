/**
 * Keep the browser's own page zoom out of the way: Ctrl/Cmd and + - 0, Ctrl/Cmd and the wheel (a trackpad
 * pinch arrives as one), and Safari's pinch gestures. Zoom belongs to the canvas, which handles these
 * itself; a zoomed browser page would break the layout and the canvas maths. Nothing is stopped from
 * propagating, so the desk still sees the keys. Only on a desk with a canvas: the library, book view and
 * the script desk keep the browser's zoom, so text can still be enlarged there.
 */
const onCanvasDesk = (): boolean => !!document.querySelector('[data-desk]:not([data-desk="script"])');

const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0', 'Add', 'Subtract']);

export function isZoomKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  return ZOOM_KEYS.has(e.key) || ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code);
}

export function installBrowserZoomGuard(target: Document = document): void {
  target.addEventListener('keydown', (e) => { if (isZoomKey(e) && onCanvasDesk()) e.preventDefault(); }, { capture: true });
  target.addEventListener('wheel', (e) => { if ((e.ctrlKey || e.metaKey) && onCanvasDesk()) e.preventDefault(); }, { capture: true, passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) target.addEventListener(type, (e) => { if (onCanvasDesk()) e.preventDefault(); });
}
