import type { Studio } from '../app/studio';
import { newId, PT, sheetOf, type Letter, type Pt, type SavedBalloon } from '../doc/model';
import type { BalloonStyle } from '../engine/lettering/spec';
import { uniqueBin } from '../geom/bins';
import { newLetter } from '../geom/lettering';
import { balloonSwatch } from './balloonswatch';
import { binPanel } from './binpanel';
import { askText, h } from './dom';

/**
 * Balloon bins (Caption): balloons saved from the page with their shape, style, tails and words,
 * plus the six starter kinds. Tap to drop one in the middle of the page, or drag it where it goes.
 */
export interface BalloonHost {
  studio: Studio;
  stage: HTMLElement;
  toPage(e: { clientX: number; clientY: number }): Pt;
  /** The selected balloon and any joined to it, or null. */
  selected(): Letter[] | null;
  /** Put copies of these letters on the page, centred on `at` (inches) or the page middle. */
  place(letters: Letter[], at: Pt | null, label: string): void;
  pageSize(): { w: number; h: number };
}

const STARTERS: [BalloonStyle, string, string][] = [
  ['speech', 'Speech', 'Hey!'], ['thought', 'Thought', 'Hmm…'], ['shout', 'Shout', 'NOW!'],
  ['whisper', 'Whisper', 'psst…'], ['box', 'Caption box', 'Meanwhile…'], ['sfx', 'Sound effect', 'KRAK!'],
];

/** A saved copy: no script link and no automatic-placement flags; the words and speaker stay. */
export function balloonForKit(letters: readonly Letter[], name: string, bin?: string): SavedBalloon {
  return {
    key: newId('bk'), name: name.trim().slice(0, 120) || 'Balloon', ...(bin ? { bin } : {}),
    letters: letters.map((l) => {
      const { src: _s, generated: _g, keptScriptLine: _k, ...rest } = structuredClone(l);
      return rest;
    }),
  };
}

/** The centre of a group of letters, in inches. */
export const lettersCentre = (letters: readonly Letter[]): Pt => {
  const xs = letters.map((l) => l.cap.x), ys = letters.map((l) => l.cap.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2 / PT, y: (Math.min(...ys) + Math.max(...ys)) / 2 / PT };
};

export function balloonBins(host: BalloonHost) {
  const { studio } = host;
  const book = () => studio.book!;
  const kit = () => book().balloonKit ?? { items: [] };
  const starters: SavedBalloon[] = STARTERS.map(([style, name, text]) => {
    const l = newLetter(book(), { x: 0, y: 0 }, style);
    l.cap = { ...l.cap, text };
    delete l.speaker;
    return { key: 'starter:' + style, name, letters: [l] };
  });

  function saveSelected(): void {
    const letters = host.selected();
    if (!letters) { panel.say('Select a balloon on the page first.'); return; }
    const words = letters.map((l) => l.cap.text).join(' ').replace(/\s+/g, ' ').trim();
    void askText('Save balloon to bin', 'Name', (letters[0]!.speaker ? letters[0]!.speaker + ': ' : '') + (words.slice(0, 40) || 'Balloon'), 'Save').then((name) => {
      if (name === null) return;
      const k = kit();
      const item = balloonForKit(letters, name, panel.bin() === 'Unsorted' ? undefined : panel.bin());
      write('Save balloon to bin', { bins: k.bins ?? [], items: [...k.items, item] });
      panel.refresh(true);
      panel.say(`Saved “${item.name}”. Drag it onto any page.`);
    });
  }

  function write(label: string, next: { bins: string[]; items: SavedBalloon[] }): void {
    const b = book();
    const before = b.balloonKit;
    const after = next.items.length || next.bins.length ? { ...(next.bins.length ? { bins: next.bins } : {}), items: next.items } : undefined;
    const apply = (v: typeof before) => { if (v) b.balloonKit = v; else delete b.balloonKit; };
    studio.run({ label, do: () => apply(after), undo: () => apply(before) });
  }

  const panel = binPanel<SavedBalloon>({
    id: 'balloons', title: 'Balloon bins', noun: 'balloon',
    read: () => kit(),
    write,
    builtIn: { bin: 'Starters', items: starters },
    thumb(item) {
      const { w, h: hh } = host.pageSize();
      return balloonSwatch(item.letters[0]!.cap, sheetOf(book()), w, hh, 72, 52);
    },
    place: (item, at) => host.place(item.letters, at, 'Place ' + item.name),
    tip: 'Tap to place · drag onto the page or a bin',
    empty: 'Select a balloon and tap Save to keep it here, with its shape, style and words.',
    menu: (item, built) => [
      { label: 'Place in the middle', run: () => host.place(item.letters, null, 'Place ' + item.name) },
      ...(built ? [{ label: 'Copy to my bins', run: () => {
        const k = kit();
        write('Copy balloon to bin', { bins: k.bins ?? [], items: [...k.items, balloonForKit(item.letters, item.name, panel.bin() === 'Unsorted' ? undefined : panel.bin())] });
        panel.refresh(true);
      } }] : []),
    ],
    head: () => [h('button', { class: 'btn', type: 'button', title: 'Keep the selected balloon in the open bin', disabled: !host.selected(), onclick: saveSelected }, '+ Save')],
    remove: (item) => { const k = kit(); write('Remove saved balloon', { bins: k.bins ?? [], items: k.items.filter((i) => i.key !== item.key) }); },
    extra: () => String(!!host.selected()),
  }, host.stage, host.toPage);

  return { el: panel.el, refresh: () => panel.refresh(), dispose: panel.dispose, uniqueName: (n: string) => uniqueBin(kit().bins ?? [], n) };
}
