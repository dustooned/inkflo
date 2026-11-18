# Bundled lettering fonts

These fonts ship with inkflo for lettering (copied unmodified from 2Dope, which bundles the same set). Each loads only when a caption uses it. All were
downloaded unmodified on 2026-11-08 from Google's official fonts repository
(https://github.com/google/fonts), and each one's licence text sits beside it.

| Font | Files | Designer | Licence | Licence file |
|---|---|---|---|---|
| Comic Neue | Regular, Italic, Bold, BoldItalic | Craig Rozynski, Hrant Papazian | SIL Open Font License 1.1 | OFL-comicneue.txt |
| Bangers | Regular | Vernon Adams | SIL Open Font License 1.1 | OFL-bangers.txt |
| Patrick Hand | Regular | Patrick Wagesreiter | SIL Open Font License 1.1 | OFL-patrickhand.txt |
| Architects Daughter | Regular | Kimberly Geswein | SIL Open Font License 1.1 | OFL-architectsdaughter.txt |
| Indie Flower | Regular | Kimberly Geswein | SIL Open Font License 1.1 | OFL-indieflower.txt |
| Bubblegum Sans | Regular | Sudtipos | SIL Open Font License 1.1 | OFL-bubblegumsans.txt |
| Luckiest Guy | Regular | Astigmatic | Apache License 2.0 | LICENSE-luckiestguy.txt |
| Permanent Marker | Regular | Font Diner | Apache License 2.0 | LICENSE-permanentmarker.txt |

Both licences allow bundling and redistribution with the app. The OFL forbids selling the fonts
on their own and reserves the font names for modified versions; these files are unmodified.
Fonts students import are stored inside their own project, and the student is responsible for
having the right to use them.

## Interface font

The app's own text (menus, panels, dialogs) uses Inter. It loads on every page, not only for
lettering, and is declared in `src/styles/tokens.css`.

| Font | File | Designer | Licence | Licence file |
|---|---|---|---|---|
| Inter Variable 4.001 | InterVariable.ttf | The Inter Project Authors | SIL Open Font License 1.1 | OFL-inter.txt |

Unlike the fonts above, this file did not come from Google's repository. It is an unmodified copy of
the Inter 4.001 variable font (880 KB, all weights from one file, not subset) taken from the assets of
another project on the same machine. The font's own name table confirms it: version `4.001;git-9221beed3`,
copyright "The Inter Project Authors", licensed under the SIL OFL 1.1. If you want the file straight
from the source, replace it with the official release; nothing else changes. The OFL forbids selling the
font on its own; this file is unmodified.
