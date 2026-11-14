import { download, h, slug } from './dom';

/**
 * A small code editor shared by Script and Layout: a transparent textarea over a highlighted
 * layer, line numbers, plain-language problems with click-to-line, and live callbacks. The
 * caller owns parsing; this only shows tokens and errors.
 */
export interface CodeLine { tokens: { kind: string; text: string }[]; error?: string }

export function codeEditor(o: {
  label: string;
  parse: (text: string) => { lines: CodeLine[]; errors: { line: number; message: string }[] };
  /** Called 250 ms after typing stops. */
  onLive: (text: string) => void;
  /** Called after a 1.5 s pause or when the editor loses focus: close the undo step. */
  onSettle: (text: string) => void;
  minHeight?: number;
}) {
  const input = h('textarea', { class: 'script-code-input', spellcheck: false, 'aria-label': o.label, autocapitalize: 'off', autocomplete: 'off' });
  const shade = h('pre', { class: 'script-code-shade', 'aria-hidden': 'true' });
  const problems = h('ul', { class: 'script-code-problems', 'aria-live': 'polite' });
  const editor = h('div', { class: 'script-code-editor' }, shade, input);
  if (o.minHeight) { editor.style.minHeight = o.minHeight + 'px'; input.style.minHeight = o.minHeight + 'px'; input.style.height = o.minHeight + 'px'; }
  let liveTimer = 0, settleTimer = 0;

  function paint(): void {
    const parsed = o.parse(input.value);
    shade.replaceChildren(...parsed.lines.map((l, i) => h('div', { class: 'cl' + (l.error ? ' bad' : '') },
      h('span', { class: 'ln' }, String(i + 1)), ...l.tokens.map((t) => h('span', { class: 't-' + t.kind }, t.text)), '\n')));
    problems.replaceChildren(...parsed.errors.map((e) => h('li', {}, h('button', { type: 'button', onclick: () => jump(e.line) }, 'Line ' + e.line), ' ', e.message)));
    sync();
  }
  function sync(): void { shade.scrollTop = input.scrollTop; shade.scrollLeft = input.scrollLeft; }
  function jump(line: number): void {
    const rows = input.value.split('\n');
    const at = rows.slice(0, line - 1).reduce((n, r) => n + r.length + 1, 0);
    input.focus();
    input.setSelectionRange(at, at + (rows[line - 1]?.length ?? 0));
  }
  const flush = () => { clearTimeout(liveTimer); clearTimeout(settleTimer); o.onLive(input.value); o.onSettle(input.value); };
  input.addEventListener('input', () => {
    paint();
    clearTimeout(liveTimer);
    clearTimeout(settleTimer);
    liveTimer = window.setTimeout(() => o.onLive(input.value), 250);
    settleTimer = window.setTimeout(() => { o.onLive(input.value); o.onSettle(input.value); }, 1500);
  });
  input.addEventListener('scroll', sync);
  input.addEventListener('blur', flush);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); input.dispatchEvent(new Event('input')); }
  });
  return {
    editor, problems, input,
    /** Replace the text (from the document), unless the student is typing in it. */
    setText(text: string): void { if (document.activeElement !== input) { input.value = text; paint(); } },
    text: () => input.value,
    focused: () => document.activeElement === input,
    paint, flush,
  };
}

/** Copy and download buttons for a JSON export (for game engines and custom readers). */
export function jsonButtons(title: string, data: () => unknown, label = 'Page data (JSON)'): HTMLElement {
  const status = h('small', { class: 'note', 'aria-live': 'polite' });
  const text = () => JSON.stringify(data(), null, 2);
  return h('div', { class: 'json-export' },
    h('h4', {}, label),
    h('p', { class: 'note', style: 'margin:0' }, 'Panel shapes in reading order with each panel’s lines, for game engines, visual novels and custom readers.'),
    h('div', { class: 'type-toggles' },
      h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text()); status.textContent = 'Copied.'; } catch { status.textContent = 'Copy was blocked; use Download.'; } } }, 'Copy JSON'),
      h('button', { class: 'btn', type: 'button', onclick: () => download(new Blob([text()], { type: 'application/json' }), slug(title) + '.json') }, 'Download')),
    status);
}
