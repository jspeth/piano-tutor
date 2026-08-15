repo: jspeth/piano-tutor
branch: master
path: src

## Last sync

date: 2026-08-15T16:10:12Z

### Updated in this project

- Read the implemented light-mode token block in `src/index.css` and the fixed track hues in `src/lib/trackColors.ts`.
- Diagnosed the washed-out light mode: mid-gray roll (L 0.78) against unchanged L 0.70–0.76 track hues.
- Added `light-mode-colors.md` — a drop-in replacement for the `prefers-color-scheme: light` block plus a theme-aware `trackColors.ts`.
- Added `Piano Tutor Light.dc.html`, the design file rendered in the proposed light palette.

## Screen map

| Project file | Repo files |
| --- | --- |
| Piano Tutor.dc.html (dark reference) | src/index.css, src/App.tsx, src/App.css, src/components/* |
| Piano Tutor Light.dc.html (light palette proof) | src/index.css (light block), src/lib/trackColors.ts |
| light-mode-colors.md | src/index.css, src/lib/trackColors.ts, src/lib/tokens.ts, src/components/PianoRoll.css, src/components/PianoKeyboard.css |
