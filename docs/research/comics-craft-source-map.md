# Comics craft → inkflo feature map

Two craft books were supplied as EPUBs:

| File | Container facts | Text quality |
|---|---|---|
| *Making Comics* (McCloud, 2006) | 274 XHTML, 305 JPEG (24.8 MB) | Page scans with OCR; accuracy notes on many pages read 18–30%, so the text is only usable to **locate** chapters, never to quote |
| *Framed Ink* (Mateu-Mestre, 2010) | 126 XHTML, ~180 KB | OCR with a noisy TOC page but readable body text; usable to enumerate sections |

Both were unzipped and inspected locally at `.rea-work/books/` (gitignored). **No page image and no
passage is committed, quoted or shipped.** This document is our own summary of the *ideas*, written
to drive features.

## The clean-room line

- Taxonomies (transition types, shot scales, word–image relations) are ideas, widely taught and
  widely cited. We express them in our own words, with our own IDs, in
  [craft-taxonomy.json](craft-taxonomy.json).
- No book text, page scans, layouts or exercises enter the repo or the app. The extract directory
  stays local and ignored.
- The app never claims endorsement and never presents a book as a mode. Attribution lives in this
  research note only.
- We do not copy page compositions as templates; the composition guides are geometric, not traced.

## What each source contributes

**Making Comics** — the *choices* behind a panel and the *flow* between them.

| Idea | Where it lands |
|---|---|
| Five per-panel choices: moment, frame, image, word, flow | Script beat prompt + `panel.intent` fields |
| Six transition types (moment, action, subject, scene, aspect, non-sequitur) | `panel.transition`, page rhythm strip, pacing hints |
| Clarity: the reader's eye path, and what can be removed without losing the story | Clarity checks (extend the existing reading-order check) |
| Word–image relations (word-specific, picture-specific, duo, additive, interdependent, parallel, montage) | `panel.wordImage` + a Caption tag |
| World building: how much world is enough | Book bible (places, props, cast) as book assets |
| Tools and career chapters | Publish Kit, portfolio export, class mode |

**Framed Ink** — the *picture*: staging, composition and continuity.

| Idea | Where it lands |
|---|---|
| Shot scale and angle: establishing, wide, full, medium, close, detail, POV, over-shoulder, up, down | `panel.shot` + shot presets in Layout |
| Composition devices: silhouette, negative space, big/medium/small, order vs chaos, angular vs curved, one focal point | Composition checklist in the inspector; silhouette preview |
| Continuity: screen direction, the 180° line, eyeline, keeping geography clear | Continuity check across a page |
| Panel shapes and page choreography; fragmenting a scene | Page templates; rhythm strip |
| Balloons and onomatopoeia as part of the composition | Caption placement hints |
| Character as silhouette; expression and body as mood | Silhouette preview; prompt text in Layout |

## What inkflo already has

From [BUILD-STATUS.md](../BUILD-STATUS.md), so we do not rebuild it:

- Composition guides: centre and diagonals, rabatment, thirds, golden section (Display menu).
- Grid settings with weighted rows/columns, knife snap to guides, downbeat/crossing check.
- Script notecards; reveal/setup pacing warnings; Webtoon screen estimate.
- Reading-order check, copyfit, tails, caption groups.
- Two-ink print and a spread preview.

The gap is **vocabulary** — the app can draw guides but cannot say *what a panel is for*.

## New work, ranked

1. **Panel intent** — five optional fields per panel (moment, frame, image, word, flow), surfaced as
   five short prompts in Script and a chip row in Layout. Not free text homework: one line each,
   skippable.
2. **Transition type + rhythm strip** — tag each panel's transition to the previous one; draw the
   page's rhythm as a bar under the page (a run of six `action` panels is visible at a glance).
3. **Clarity checks** (extend, do not replace) — text repeating the picture, a balloon read before
   its speaker, an unresolved tail, panels whose eye path fights the reading order.
4. **Composition checklist + silhouette preview** — a one-click view that fills the panel art black
   so the shape can be judged; checklist items are hints, never blockers.
5. **Continuity check** — screen direction across consecutive panels, with a "this cut flips it"
   flag the artist can dismiss.
6. **Word–image relation** — one chip in Caption per panel; drives a lettering hint ("the caption
   already says this").
7. **Study lens** — label a reference page's transitions and shots, export a breakdown sheet. This
   is the teaching surface; it analyses, it does not reproduce.

## Heuristics we can honestly implement

These are cheap and explainable; each is a **hint**, never an auto-fix.

| Check | Signal |
|---|---|
| Transition rhythm | Runs of one transition id; suggest a change after 3+ |
| Balloon before speaker | Balloon box vs the panel that first names the speaker |
| Tail resolution | Tail endpoint vs character art bounding boxes |
| Text repeats picture | Token overlap between caption and the beat's description |
| Screen direction | Subject facing left/right across a cut, from silhouette centroid offset |
| Focal point | Luminance centroid vs thirds intersections |
| Silhouette | Render art to black; count separated shapes and edge clarity |
| Reveal distance | Existing reveal/setup link; distance in pages |

## Data model

Schema 5, all optional, absent means "not set":

```ts
type TransitionId = "moment" | "action" | "subject" | "scene" | "aspect" | "nonSequitur";
type ShotId = "establishing" | "wide" | "full" | "medium" | "close" | "detail"
            | "pov" | "overShoulder" | "up" | "down";
type WordImageId = "wordSpecific" | "pictureSpecific" | "duo" | "intersecting"
                 | "interdependent" | "parallel" | "montage";

interface PanelMeta {
  intent?: { moment?: string; frame?: string; image?: string; word?: string; flow?: string };
  transition?: TransitionId;   // to the previous panel in reading order
  shot?: ShotId;
  wordImage?: WordImageId;
}
```

Store on the panel once layout exists; before that, on the beat. Migration: schema-4 pages open with
`meta` undefined and nothing changes.

## Build order

| Step | Slice | Done when |
|---|---|---|
| M7a | Fields + rhythm strip | A page shows its transition rhythm; fields survive reload |
| M7b | Clarity checks | The four checks run on a real page and every flag is dismissible |
| M7c | Silhouette + composition | One click shows the page as shapes; checklist is advisory |
| M7d | Continuity | A flipped cut is flagged, with a dismiss |
| M7e | Study lens | A reference page can be labelled and exported as a breakdown sheet |

## What not to do

- Do not OCR the books into the app, ship their images, or build a "McCloud mode".
- Do not turn craft hints into export blockers; a comic can break every rule and be right.
- Do not present a single book's taxonomy as the only one; the enums are ours and editable.
