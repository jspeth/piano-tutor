# Light mode — revised color values

## What was wrong

The current `@media (prefers-color-scheme: light)` block in `src/index.css` recalibrates the
surfaces into a light range but leaves two relationships broken:

1. **`--surface-roll: oklch(0.78 0.01 282)`** — the roll became a mid-gray slab, and the track
   hues did not move with it. Track colors are fixed at L 0.70–0.76 (`src/lib/trackColors.ts`),
   so the amber track (L 0.76) sits on an L 0.78 background: a lightness delta of 0.02. The blue
   track survives only because of its chroma. In the screenshot the amber lane is barely there.
2. **The grid outranks the content.** `--grid-major: 0.675` against a 0.78 roll is a 0.105 delta,
   larger than the delta between the notes and the roll — so the gridlines read as the strongest
   thing on screen, and the whole roll reads gray rather than as a surface with notes on it.

Secondary: `--surface-keybed: 0.99` is lighter than the white keys (0.97), so the keybed
disappears behind the keyboard; `--text: 0.07` is harsher than necessary; the black playhead
carries a 55%-alpha glow, which on a light roll smudges rather than glows; and
`--key-label-on: oklch(0.2 0.01 280 / 0.75)` assumes the lit-key fill is *light*, which stops
being true once track colors are darkened for light mode.

## The fix, in one sentence

In light mode the roll becomes the **lightest** surface (paper), not the darkest, and the track
hues drop to L 0.50–0.55 so notes are ink on paper. Elevation ordering inverts because the
figure/ground relationship inverts; chroma and hue stay put.

## Replacement for the light block in `src/index.css`

```css
@media (prefers-color-scheme: light) {
  :root {
    /* Surfaces — the roll is now the LIGHTEST surface, not the darkest: in light
       mode notes are dark ink on paper, so the roll has to be the paper. Chrome
       sits a step darker than the roll so the roll reads as the content area. */
    --surface-app: oklch(0.9 0.006 280);
    --surface-toolbar: oklch(0.955 0.004 280);
    --surface-chipbar: oklch(0.925 0.005 280);
    --surface-control: oklch(0.975 0.003 280);
    --surface-control-raised: oklch(0.995 0.002 280);
    /* Hover darkens in light mode (it lightened in dark) — same "moves away
       from the page" relationship, opposite direction. */
    --surface-control-hover: oklch(0.905 0.008 280);
    --surface-popover: oklch(0.99 0.004 280);
    --surface-roll: oklch(0.965 0.003 282);
    /* Must be darker than --key-white or the keybed vanishes behind the keys. */
    --surface-keybed: oklch(0.885 0.006 280);

    /* Borders */
    --border: oklch(0.81 0.01 280);
    --border-subtle: oklch(0.865 0.008 280);
    --border-strong: oklch(0.7 0.012 280);

    /* Roll grid — deliberately quiet: the delta from --surface-roll is smaller
       than the note-to-roll delta, so notes stay the loudest thing on the roll. */
    --grid-major: oklch(0.875 0.008 282);
    --grid-minor: oklch(0.935 0.005 282);

    /* Text — dark ink, not pure black. */
    --text: oklch(0.28 0.012 280);
    --text-bright: oklch(0.18 0.014 280);
    --text-secondary: oklch(0.38 0.012 280);
    --text-muted: oklch(0.5 0.012 280);
    --text-faint: oklch(0.52 0.012 280);
    --text-disabled: oklch(0.58 0.01 280);

    /* Accent — L 0.50 holds white text at AA on the filled mode button, and the
       tint/wash alphas come down because alpha over white reads stronger. */
    --accent: oklch(0.5 0.21 298);
    --accent-tint: oklch(0.5 0.21 298 / 0.14);
    --accent-line: oklch(0.5 0.21 298 / 0.45);
    --accent-text: oklch(0.42 0.16 298);
    --accent-wash: oklch(0.5 0.21 298 / 0.1);

    /* Semantic */
    --correct: oklch(0.52 0.16 150);
    --wrong: oklch(0.53 0.2 27);
    --expected-tint-white: oklch(0.9 0.06 150);
    --expected-tint-black: oklch(0.4 0.08 150);

    /* Keyboard — black keys stay black; the keybed and edges carry the contrast. */
    --key-white: oklch(0.99 0.002 280);
    --key-white-edge: oklch(0.8 0.008 280);
    --key-black-top: oklch(0.34 0.012 280);
    --key-black-bottom: oklch(0.18 0.01 280);
    --key-label: oklch(0.58 0.01 280);
    /* Flips to near-white: lit keys are DARK in light mode (track L 0.50–0.55),
       so a dark label on a lit key would disappear. */
    --key-label-on: oklch(0.99 0 0 / 0.92);
    --keybed-inset: oklch(0.78 0.01 280);
    --keybed-shadow: oklch(0.45 0.02 280 / 0.14);

    /* Playhead — dark ink line; the glow alpha drops hard, since a dark blur on a
       light roll reads as a smudge, not a glow. */
    --playhead: oklch(0.3 0.02 280);
    --playhead-glow: oklch(0.3 0.02 280 / 0.2);

    --shadow-popover: 0 6px 18px oklch(0.45 0.02 280 / 0.18);
  }
}
```

## `src/lib/trackColors.ts` — track hues have to move with the roll

This is the change that actually fixes the invisible amber lane. Same hues, same ordering, same
forbidden bands; lightness drops and chroma rises so each hue holds against paper.

```ts
import { getTheme, type Theme } from './theme'

/** Near L 0.70-0.76, C 0.12-0.15 — tuned to sit on the dark roll (L 0.135). */
const BASE_DARK: OklchParts[] = [
  { l: 0.7, c: 0.15, h: 250 }, // blue
  { l: 0.76, c: 0.14, h: 78 }, // amber
  { l: 0.72, c: 0.12, h: 205 }, // cyan
  { l: 0.68, c: 0.15, h: 348 }, // pink
]

/**
 * Same hues, ~0.2 darker and slightly more chromatic, to sit on the light
 * roll (L 0.965) — L 0.50 keeps a note's contrast against the roll (~5:1) above
 * everything else drawn on it, so notes stay the loudest element. Amber is the
 * exception at L 0.55 (it goes muddy lower) and rotates 78 -> 70, since at this
 * lightness the original hue reads brown against white.
 */
const BASE_LIGHT: OklchParts[] = [
  { l: 0.5, c: 0.19, h: 250 },
  { l: 0.55, c: 0.16, h: 70 },
  { l: 0.5, c: 0.14, h: 205 },
  { l: 0.5, c: 0.2, h: 348 },
]

export function trackColorParts(trackIndex: number, theme: Theme = getTheme()): OklchParts {
  const base = theme === 'light' ? BASE_LIGHT : BASE_DARK
  const index = ((trackIndex % base.length) + base.length) % base.length
  const wraps = Math.floor(trackIndex / base.length)
  const h = avoidForbiddenBands(base[index].h + wraps * 70)
  return { l: base[index].l, c: base[index].c, h }
}
```

`trackColor` / `trackColorVars` keep their signatures and pick up the theme by default. Two
consumers need to re-read on theme change:

- **The canvas.** `subscribeCanvasTokens` already clears the token cache on scheme change; the
  per-lane note color now also depends on the theme, so whatever recomputes note fills has to be
  invalidated by the same subscription (or read `useCanvasTokens()`'s change as its cue to redraw).
- **`trackColorVars` in React** (chips, lane labels, lit keys). Subscribe via `subscribeTheme` —
  a `useTheme()` wrapper around `useSyncExternalStore` next to `useCanvasTokens` keeps it to one line
  per component.

If plumbing the theme into `trackColors.ts` is more churn than you want right now, the CSS-only
alternative is to define `--track-l` / `--track-c` per theme and build the color in CSS — but the
canvas can't use that, so the TS route is the smaller change overall.

## The non-focused lane: alpha ghosting has to change too

This is the second half of the same bug, and it is easy to miss because it isn't a token value.
Non-focused lanes de-emphasise their notes with **alpha** (`--track-55`, plus the
`opacity: 0.9` on `.piano-roll-lane`). Alpha is not symmetric when figure/ground inverts:
over the near-black dark roll, 55% alpha darkens a note *toward* the roll and it still holds
~2.9:1; over the 0.965 paper roll the same alpha lightens it *toward white* and it collapses to
~2.0:1 — leaving the ghosted lane the faintest thing on screen, which is the original complaint
all over again.

In light mode, raise the ghosting alpha and drop the lane-level dimming:

```css
@media (prefers-color-scheme: light) {
  /* 0.55 over white collapses to ~2:1; 0.85 restores dark mode's ~2.9:1 while
     still reading clearly behind the focused lane (4.5–5.3:1). */
  .piano-roll-lane { opacity: 1; }
}
```

and in `trackColorVars`, make the ghost step theme-dependent rather than a fixed `0.55`:

```ts
const GHOST_ALPHA = { dark: 0.55, light: 0.85 } as const

export function trackColorVars(trackIndex: number, theme: Theme = getTheme()): CSSProperties {
  return {
    '--track': trackColor(trackIndex, 1, theme),
    '--track-55': trackColor(trackIndex, GHOST_ALPHA[theme], theme),
    '--track-20': trackColor(trackIndex, theme === 'light' ? 0.16 : 0.2, theme),
    '--track-glow': trackColor(trackIndex, 0.9, theme),
  } as CSSProperties
}
```

The canvas note fill for non-focused lanes needs the same alpha, from the same source. If you'd
rather not thread alpha through, the alternative that behaves identically in both themes is to
ghost by **lightness offset** instead — `l + 0.18` in light, `l - 0.18` in dark — which keeps a
constant perceptual step regardless of what is behind it.

## One spot check after applying

- `.piano-roll canvas` draws its 1px ring from `--border-subtle` (0.865) against
  `--surface-roll` (0.965) — thin but visible. With `opacity: 1` on the lane, that ring is now
  the only thing separating the two lane boxes, so confirm it reads at the lane gap.
- `TrackChips.css:75`'s comment about a near-white/near-black text flip still holds — the focused
  chip's background is now `--track-20` over a light surface, so verify the badge text (which was
  `oklch(0.99 0 0 / 0.14)` white overlay in dark) reads. The preview uses
  `oklch(0.25 0.02 280 / 0.10)` there instead.

## Preview

`Piano Tutor Light.dc.html` in the project root is the design file with this palette applied —
the same layout, same states, light values. Open it next to `Piano Tutor.dc.html` to compare.
