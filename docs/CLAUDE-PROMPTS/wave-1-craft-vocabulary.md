# Claude Code task — Wave 1: craft vocabulary

Copy everything below the line into Claude Code, in this repo, as one task.

---

## Task

Add the first wave of craft metadata to inkflo: per-panel **intent**, **transition**, **facing** and
**word–image relation**; per-beat **kind**; and three read-only views that use them — a **rhythm
strip**, a **read-back list**, and **text density**.

This is vocabulary, not automation. Nothing here guesses, scores or blocks. Every field is optional,
every default is "unset", and the app must work exactly as it does today when none of it is filled
in.

Read in this order before writing code:

1. `CLAUDE.md` — repo rules (short).
2. `docs/BUILD-STATUS.md` — what exists. Find the real module names; do not trust the paths in this
   prompt over the code.
3. `docs/research/craft-features.md` — features 1, 2, 3, 5, 6, 8, 10 and their anti-features.
4. `docs/research/craft-taxonomy.json` — the exact enum ids and labels. Use these ids verbatim.
5. The code: `src/doc/model.ts`, `src/doc/schema.ts`, `src/app/studio.ts`, `src/ui/desk.ts`,
   `src/ui/dialogue.ts`, `src/ui/composition.ts`, `src/geom/readability.ts`.

Follow the patterns you find. If a concept already exists (a "downbeat" panel, a reveal/setup link, a
beat card, an inspector section, a popover), **extend it**; do not add a parallel system. If two
concepts would collide (for example a beat kind `reveal` next to the existing reveal/setup link),
stop and report the collision instead of inventing a third concept.

---

## Data model

Add to the panel type (and to the beat for `kind` and the pre-layout `intent`). All optional.

```ts
type TransitionId = "moment" | "action" | "subject" | "scene" | "aspect" | "nonSequitur";
type ShotId = "establishing" | "wide" | "full" | "medium" | "close" | "detail"
            | "pov" | "overShoulder" | "up" | "down";          // defined now, used in Wave 2
type WordImageId = "wordSpecific" | "pictureSpecific" | "duo" | "intersecting"
                 | "interdependent" | "parallel" | "montage";
type BeatKind = "establish" | "reaction" | "action" | "pause" | "reveal";
type Facing = "left" | "right" | "none";

interface PanelMeta {
  intent?: { moment?: string; frame?: string; image?: string; word?: string; flow?: string };
  transition?: TransitionId;   // to the previous panel in reading order; undefined on the first
  facing?: Facing;
  wordImage?: WordImageId;
  shot?: ShotId;               // stored now, no UI beyond the chip
}

// on the beat
interface BeatMeta { kind?: BeatKind; }
```

**Schema policy:** `src/doc/schema.ts` states that an additive change needs no bump and a breaking
change does. Adding optional fields is additive. Follow the file's own rule; do not bump the schema
number unless the code's validation requires it. Old books must open unchanged, and a book with no
metadata must serialise exactly as before (no empty objects written for unset fields).

---

## Tasks

Do them in order. Run `npm test`, `npx tsc --noEmit` and `npx vite build` after each task. Stop and
report after T4 before starting the views.

### T1 — Panel intent (feature 1)

- Script desk: under each beat card, a collapsed "Five choices" section with five one-line inputs
  (`Moment`, `Frame`, `Image`, `Word`, `Flow`). Placeholder text explains the question, not the
  answer: "Which instant?", "How close, from where?", "What is drawn?", "What do words add?",
  "Where does the eye go next?".
- Layout inspector: when a panel is selected, a row of five dots. Filled = that choice has text.
  Clicking a dot opens a small popover with that one input for the panel.
- Written on the beat before layout exists; when the Script → Layout action runs (it currently
  carves one panel per beat — find its real name in `src/ui/dialogue.ts` or `src/ui/desk.ts`), the
  panel inherits its beat's intent. Never overwrite a panel's intent once it has its own.
- Empty is valid and shows no dot. No prompt, modal or nag ever appears.

**Done when:** text typed in Script appears on the panel after Send to Layout; editing on the panel
persists across reload; an untouched book serialises without `intent`.

### T2 — Transition (feature 2)

- Layout inspector: a chip row — `—`, then the six types, in taxonomy order. `—` means unset.
- The value describes the link **to the previous panel** in reading order. The first panel shows no
  chip (or a disabled one) and stores nothing.
- Show the same chip on the read-back row (T6). Do not auto-guess from geometry.

**Done when:** setting and clearing a transition persists; reordering panels keeps each panel's
value attached to the panel, not to the position.

### T3 — Beat kind (feature 3)

- Script beat card: a chip row for `establish / reaction / action / pause / reveal` plus unset.
- Layout: the panel group label may show the beat's kind as text; no new chrome.
- If the app already has a "downbeat" or "reveal/setup" concept that covers one of these, map that
  value onto it rather than duplicating; note the mapping in your report.

**Done when:** the chip persists and the read-back shows it.

### T4 — Facing and word–image (features 5 and 6)

- Layout inspector: `Facing` chip row — left / right / none (unset allowed).
- Caption inspector: `Words & pictures` chip row with the seven relations plus unset.
- Both are stored on the panel. Neither drives any check in this wave.

**Done when:** both persist and appear in the read-back.

### T5 — Read-back list (feature 8)

- A toggle in the Layout desk (a `Read` button in the context bar or the Display menu — follow how
  existing views toggle) that replaces the canvas with a vertical list, one row per panel:
  `# · shot (if set) · transition (if set) · beat kind (if set) · words (first line, truncated) ·
  five intent dots`.
- Clicking a row selects that panel and returns to the canvas.
- With no metadata the list still renders, showing `—` where a value is unset.

**Done when:** the list reflects edits live and never shows fabricated values.

### T6 — Text density (feature 10)

- Caption inspector: words in the selected panel and words on the page.
- A soft cap by format (page vs webtoon) with a neutral indicator at the cap and a stronger one
  above it. Advisory: it never changes the lettering or blocks export.
- Count words from the actual balloon/caption text, not the script.

**Done when:** the count updates as text changes and matches a hand count on a page.

### T7 — Rhythm strip (feature 7, the payoff)

- Under the page in Layout: one segment per panel in reading order, equal width, coloured by
  transition. Unset is a neutral sand tone. First panel is neutral.
- Runs of **three or more** consecutive identical transitions get a thin bracket or underline.
- Hover shows the type name; click selects the panel and focuses the transition chips.
- It must not intercept canvas gestures: only the strip itself is clickable.
- Colours: six distinct tones derived from the existing tokens; ensure contrast on both themes
  (Light and Night desk). Put them in `src/styles/tokens.css`, not inline.
- Hide or collapse in Focus/Simple chrome if the existing chrome modes hide secondary bars; follow
  the established pattern.

**Done when:** segment count equals panel count, order matches reading order, editing a transition
updates the strip immediately, and a page with no transitions shows a neutral strip with no bracket.

---

## Tests

- **Unit:** metadata round-trips through the schema (set, save, load, unset); unset fields are not
  serialised as empty objects; transition run detection returns the right runs for a known sequence;
  word counting ignores punctuation-only tokens.
- **Browser:** set one value of each kind, reload, assert persistence; rhythm strip segment count;
  read-back rows; density numbers. Use the existing browser test pattern.
- **Regression:** a book with no metadata renders and exports byte-identically in behaviour to
  before (no new empty keys in `book.json`).

---

## Guardrails

- No new dependencies. No framework. No changes to the drawing engine, brushes, residency or export
  formats.
- Every chip change is one undoable command; undo restores the previous value.
- Keep the inspector and popover patterns already in `src/ui/`.
- Do not rename or remove existing exports; additive only.
- Do not add onboarding, tooltips that auto-open, or empty-state prompts.
- Do not auto-fill any field from geometry, text or AI.

## Report back

Update `docs/BUILD-STATUS.md` with a dated section: what was added, the exact module names, the
checks run (`npm test` count, typecheck, build) and what was **not** verified (for example: the
strip only looked at in one theme). List the files changed. If any concept collided with an existing
one, say which and what you chose.

**Definition of done:** all eight items above behave as specified; a book with no metadata is
unchanged; the strip and list are driven only by explicit data; tests and build pass.
