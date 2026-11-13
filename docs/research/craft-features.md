# Craft features — the implementable list

What the two craft books actually turn into, at feature level. The mapping and sourcing are in
[comics-craft-source-map.md](comics-craft-source-map.md); the enums are in
[craft-taxonomy.json](craft-taxonomy.json). This file is the build menu: 22 features, where each
lives, what it costs, and what it must never become.

**The rule for all of them:** the app offers *choices*, not grades. Every hint is dismissible,
every metadata field is optional, and nothing blocks export.

Effort: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more.

---

## A. Panel vocabulary (cheap, highest leverage)

| # | Feature | Where | What it does | Data | Effort |
|---|---|---|---|---|---|
| 1 | **Panel intent** | Script + Layout | Five short prompts per panel: *moment, frame, image, word, flow*. One line each, skippable; shows as five dots (filled/skipped). | `panel.intent` | S |
| 2 | **Transition chip** | Layout | Each panel carries its link to the previous one, from the six types. One-chip picker in the inspector; colour-coded on the page margin. | `panel.transition` | S |
| 3 | **Beat type** | Script + Layout | Establish / reaction / action / pause / reveal, per beat. The script's notecards already exist; this adds the label and a rhythm read. | `beat.kind` | S |
| 4 | **Shot chip** | Layout | Ten shot types. Selecting one applies a framing guide preset (figure scale + horizon) to the panel, not a crop. | `panel.shot` | S–M |
| 5 | **Facing chip** | Layout | Per panel: subject faces left / right / neither. Cheap, honest input for the continuity check. | `panel.facing` | S |
| 6 | **Word–image relation** | Caption | One chip per panel: word-specific, picture-specific, duo, additive, interdependent, parallel, montage. Drives the redundancy hint. | `panel.wordImage` | S |

## B. Flow and pacing (the app's differentiator)

| # | Feature | Where | What it does | Effort |
|---|---|---|---|---|
| 7 | **Rhythm strip** | Layout (under the page) | A bar of segments, one per panel, coloured by transition type; runs of one type are bracketed. Click a segment to change the type. This is the single best "craft made visible" feature. | M |
| 8 | **Read-back view** | Layout / Book | The page as a list: panel → shot → transition → words. Lets a writer read the page without looking at the art. | S |
| 9 | **Page-turn marker** | Layout | Mark which panel is the turn to the next page; hint if the turn lands on a low-information panel. | M |
| 10 | **Text density** | Caption | Words per panel and per page, with a soft cap by book format (page vs webtoon). | S |
| 11 | **Pacing heat map** | Book | Across pages: transition mix and text density as a strip per page, so a chapter's rhythm is visible. | M |

## C. Clarity (hints on existing checks)

| # | Feature | Where | What it does | Effort |
|---|---|---|---|---|
| 12 | **Balloon before speaker** | Caption | Flags a balloon the eye reaches before the panel that introduces its speaker. Builds on the existing reading-order check. | M |
| 13 | **Tail resolution** | Caption | Every speech tail must end on a character region; unresolved tails are listed. | S–M |
| 14 | **Text repeats picture** | Caption | Token overlap between the caption and the beat description, shown as a quiet hint. | S |
| 15 | **Eye-path overlay** | Layout | Numbered path through panels and balloons; flags a balloon outside the path. | M |

## D. Composition and continuity

| # | Feature | Where | What it does | Effort |
|---|---|---|---|---|
| 16 | **Silhouette preview** | Draw / Layout | One toggle fills the page's art black, so the panel reads as a shape. Also a useful inking check. | M |
| 17 | **Focal point check** | Layout | Luminance centroid vs the thirds intersections; flags two competing centres. Advisory only. | M |
| 18 | **Screen-direction flag** | Layout | Uses the facing chips: flags a cut that flips a subject's facing without a panel establishing the change. | M |
| 19 | **Scene axis** | Layout | Set the 180° line per scene from two facing chips; panels contradicting it are flagged. | L |

## E. Teaching, world, motion

| # | Feature | Where | What it does | Effort |
|---|---|---|---|---|
| 20 | **Study lens** | Study | Label a reference page's transitions and shots, then export a breakdown sheet. Analysis only; no page content shipped. | M |
| 21 | **Book bible** | Book | Cast, places, props with pinned reference. Script mentions get a hover card. | M–L |
| 22 | **Motion seeding** | Motion | Seed a motion cue from each transition: scene→scene = cut, aspect→aspect = slow pan, moment→moment = hold, action→action = quick push. Then edit by hand. | M |

---

## The five I would build first

1. **#2 transition chip + #7 rhythm strip** — together they are one feature: label the page, then
   see its rhythm. Cheap data, visible payoff, and it makes every later check possible.
2. **#1 panel intent** — five prompts turn the Script desk into a thinking tool without asking for
   a screenwriter's discipline.
3. **#9 page-turn marker** — page turns are the one thing prose cannot do; almost no tool helps.
4. **#16 silhouette preview** — a rendering trick that teaches composition and checks ink at the
   same time.
5. **#22 motion seeding** — the cross-feature: the same transition tags that pace the page seed the
   motion comic, which is the handoff to 2Dope.

## Anti-features — do not build

- **A page score.** No "this page is 72% clear". Craft is judgement; a score invites gaming.
- **Auto-layout from script text.** The knife is the point; generating panels from prose removes the
  decision the book is about.
- **A "correct" panel count or grid.** Templates are starting points, not answers.
- **AI rewriting of dialogue.** The words are the artist's.
- **Mandatory metadata.** If the five prompts become homework, they will be skipped and the rhythm
  strip will be empty. Everything defaults to unset and still works.

## Sequence

| Wave | Features | Why |
|---|---|---|
| 1 | 1, 2, 3, 5, 6, 8, 10 | All S; they are metadata plus small UI, and they unlock the rest |
| 2 | 7, 9, 12, 13, 14, 15, 16, 17 | The visible craft layer |
| 3 | 18, 19, 20, 21, 22 | Continuity, study, world, motion |

Schema: wave 1 is a schema-5 addition, all optional, with absent = unset. No migration work beyond
opening older books.
