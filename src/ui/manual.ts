/** Open the manual in a new tab, at the chapter for `section` (a desk id or a topic). */
export function openManual(section = 'start'): void {
  window.open(import.meta.env.BASE_URL + 'manual/index.html#' + section, '_blank', 'noopener');
}
