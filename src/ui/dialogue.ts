import { newId, sheetOf, type Beat } from '../doc/model';
import { assignDialoguePanel, assignDialoguePreset, bindDialogue, dialoguePanel, letterForLine, parseLine, reconcileDialogue, scriptRevision, speakerKey, speakers } from '../geom/lettering';
import type { DeskCtx } from './desk';
import { h } from './dom';

/** The same dialogue and panel assignments are editable in Script and Caption. */
export function openDialogue(ctx: DeskCtx, onLocate?: (id: string) => void): void {
  const { studio, book, page } = ctx;
  const body = h('div', { class: 'content dialogue-body' });
  const count = h('span', { class: 'note', role: 'status' });
  const placeButton = h('button', { class: 'btn primary', type: 'button', onclick: () => save('Place script lettering', () => {}, true) }, 'Place missing lettering');
  const updateCount = () => {
    const panels = ctx.panels();
    let waiting = 0;
    let ready = 0;
    for (const b of page.beats) b.lines.forEach((raw, i) => {
      if (!parseLine(raw).text || b.dialogue?.[i]?.omit || letterForLine(page, b, i)) return;
      if (dialoguePanel(page, panels, b, i)) ready++;
      else waiting++;
    });
    placeButton.disabled = !ready;
    count.textContent = ready + (ready === 1 ? ' line to place' : ' lines to place') + (waiting ? ' · ' + waiting + ' need a panel' : '');
  };
  const save = (label: string, change: () => void, place = false) => {
    studio.editPage(page, label, ['beats', 'balloons', 'autoLetter'], () => {
      change();
      reconcileDialogue(book, page, ctx.panels(), place || page.autoLetter === true);
    });
    ctx.chrome();
    ctx.request();
    render();
  };
  const action = (label: string, onclick: () => void, attrs = {}) => h('button', { class: 'btn', type: 'button', onclick, ...attrs }, label);

  function rows(beat: Beat, beatIndex: number): HTMLElement {
    const panels = ctx.panels();
    const presets = sheetOf(book).presets ?? {};
    const items = beat.lines.map((raw, i) => {
      const line = beat.dialogue?.[i];
      const panel = dialoguePanel(page, panels, beat, i);
      const key = 'Beat ' + (beatIndex + 1) + ', line ' + (i + 1);
      const words = h('textarea', { rows: 1, placeholder: 'MAYA: Dialogue', 'aria-label': key + ' dialogue', 'data-dialogue': beat.id + '/' + i });
      words.value = raw;
      const status = h('span', { class: 'note' });
      const locate = action('Select balloon', () => {
        const l = letterForLine(page, beat, i);
        if (l && onLocate) { d.close(); onLocate(l.id); }
      });
      const updateRow = () => {
        const l = letterForLine(page, beat, i);
        status.textContent = line?.omit ? 'Skipped' : l ? scriptRevision(page, l) ? 'Wording to review' : 'Lettered' : panel ? 'Panel ' + (panel.index + 1) : 'Needs a panel';
        locate.hidden = !l || !onLocate;
      };
      updateRow();
      words.addEventListener('change', () => {
        // Keep the row in place while the user tabs from its text to its panel or preset.
        studio.editPage(page, 'Edit dialogue', ['beats', 'balloons'], () => {
          bindDialogue(page, beat);
          beat.lines[i] = words.value.trim();
          reconcileDialogue(book, page, ctx.panels());
        });
        ctx.request();
        updateRow();
        updateCount();
      });
      const panelSelect = h('select', { 'aria-label': key + ' panel' },
        h('option', { value: '' }, 'Follow beat order'),
        panels.map((p) => h('option', { value: p.index, selected: !!line?.panel && p === panel }, 'Panel ' + (p.index + 1))));
      panelSelect.addEventListener('change', () => save('Assign dialogue panel', () =>
        assignDialoguePanel(page, panels, beat, i, panelSelect.value === '' ? null : panels[Number(panelSelect.value)] ?? null)));
      const presetSelect = h('select', { 'aria-label': key + ' preset' },
        h('option', { value: '' }, 'Speaker / script default'),
        Object.entries(presets).map(([id, preset]) => h('option', { value: id, selected: line?.preset === id }, preset.name)));
      presetSelect.addEventListener('change', () => save('Assign lettering preset', () =>
        assignDialoguePreset(book, page, beat, i, presetSelect.value || undefined)));
      const move = (to: number) => save('Move dialogue line', () => {
        const meta = bindDialogue(page, beat);
        beat.lines.splice(to, 0, beat.lines.splice(i, 1)[0]!);
        meta.splice(to, 0, meta.splice(i, 1)[0]!);
      });
      return h('div', { class: 'dialogue-row' },
        words,
        h('div', { class: 'dialogue-assignments' },
          h('label', { class: 'field' }, 'Panel', panelSelect), h('label', { class: 'field' }, 'Preset', presetSelect)),
        h('div', { class: 'dialogue-row-actions' },
          status, locate,
          line?.omit ? action('Use in lettering', () => save('Restore dialogue', () => { delete bindDialogue(page, beat)[i]!.omit; })) : null,
          action('↑', () => move(i - 1), { 'aria-label': 'Move ' + key + ' up', disabled: i === 0 }),
          action('↓', () => move(i + 1), { 'aria-label': 'Move ' + key + ' down', disabled: i + 1 === beat.lines.length }),
          action('×', () => save('Remove dialogue line', () => {
            bindDialogue(page, beat).splice(i, 1);
            beat.lines.splice(i, 1);
          }), { 'aria-label': 'Remove ' + key })));
    });
    return h('section', { class: 'dialogue-beat' },
      h('h3', {}, 'Beat ' + (beatIndex + 1) + (beat.desc ? ' · ' + beat.desc : '')),
      items,
      action('Add line', () => {
        const i = beat.lines.length;
        save('Add dialogue line', () => {
          bindDialogue(page, beat).push({ id: newId('dl') });
          beat.lines.push('');
        });
        body.querySelector<HTMLTextAreaElement>('[data-dialogue="' + CSS.escape(beat.id + '/' + i) + '"]')?.focus();
      }));
  }

  function speakerPresets(): HTMLElement | null {
    const names = speakers(book);
    const presets = Object.values(sheetOf(book).presets ?? {});
    if (!names.length || !presets.length) return null;
    const speaker = h('select', { 'aria-label': 'Preset speaker' }, names.map((name) => h('option', { value: name }, name)));
    const preset = h('select', { 'aria-label': 'Speaker lettering preset' }, presets.map((style) => h('option', { value: style.id }, style.name)));
    const hint = h('span', { class: 'note', role: 'status' });
    const update = () => {
      const assigned = sheetOf(book).characters[speakerKey(speaker.value)];
      hint.textContent = assigned ? speaker.value + ' uses ' + assigned.name + ' for new lettering.' : speaker.value + ' uses the book defaults.';
      if (assigned && presets.some((style) => style.id === assigned.id)) preset.value = assigned.id;
    };
    speaker.addEventListener('change', update);
    update();
    return h('details', { class: 'dialogue-speaker-presets' },
      h('summary', {}, 'Auto-assign a preset by speaker'),
      h('div', { class: 'dialogue-assignments' },
        h('label', { class: 'field' }, 'Speaker', speaker),
        h('label', { class: 'field' }, 'Preset', preset)),
      h('div', { class: 'dialogue-row-actions' }, hint,
        action('Assign to speaker', () => {
          const style = presets.find((p) => p.id === preset.value);
          if (!style) return;
          const before = structuredClone(book.lettering);
          const current = sheetOf(book);
          const after = { ...current, characters: { ...current.characters, [speakerKey(speaker.value)]: style } };
          studio.run({ label: 'Assign speaker preset', do: () => (book.lettering = structuredClone(after)), undo: () => (book.lettering = structuredClone(before)) });
          update();
          ctx.chrome();
        })));
  }

  function render(): void {
    const auto = h('input', { type: 'checkbox', checked: page.autoLetter === true });
    auto.addEventListener('change', () => save('Auto-letter page', () => {
      if (auto.checked) page.autoLetter = true;
      else delete page.autoLetter;
    }));
    updateCount();
    const speakerRules = speakerPresets();
    body.replaceChildren(h('div', { class: 'dialogue-toolbar' },
      h('label', { class: 'mini' }, auto, 'Auto-letter this page'),
      count, placeButton),
    ...(speakerRules ? [speakerRules] : []),
    ...page.beats.map(rows),
    page.beats.length ? h('p', { class: 'note' }, 'Use one line per balloon. Name speakers with “MAYA: …”, or use “CAPTION: …” and “SFX: …”. Refine the starter placement on the page.') :
      h('p', { class: 'note' }, 'Add beats in the Script desk to start lettering this page.'));
  }

  const d = h('dialog', { class: 'dialogue-dialog', 'aria-label': 'Script dialogue' },
    h('header', {}, h('h2', {}, 'Script dialogue')), body, h('footer', {}, action('Done', () => d.close())));
  d.addEventListener('close', () => { d.remove(); ctx.chrome(); ctx.request(); });
  document.body.append(d);
  render();
  d.showModal();
}
