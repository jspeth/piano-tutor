# Handoff: Piano Tutor — single-screen practice layout

## Overview

Redesign of a browser app that teaches piano from a MIDI file. The user loads a MIDI file, picks one or more parts (tracks), and plays along on a real MIDI keyboard or the on-screen keyboard while the piano roll scrolls.

The redesign has two goals:

1. **Support multiple simultaneous tracks** (two or three piano rolls at once) without running out of vertical space.
2. **Collapse all chrome** so the three things that matter — the piano rolls, the on-screen keyboard, and the played/expected note readout — get every pixel that is left.

The whole app is one non-scrolling screen. Target viewport: MacBook at 1512×982 (≈870px of usable page height). The page must never scroll vertically.

## About the design files

`Piano Tutor.dc.html` in this bundle is a **design reference created in HTML** — a prototype showing the intended look and behavior. It is not production code to copy. The task is to **recreate this design in the target codebase's existing environment** (the current app appears to be a Vite/React project at `localhost:5173`) using its established patterns, component library, and styling approach. Where the existing app already has working MIDI parsing, playback, scheduling and input handling, keep it — this handoff describes layout, visual treatment, and interaction rules only.

Open the HTML file in any browser to interact with it: the mode buttons, transport toggles, keyboard-range toggle, tooltips, and track chips are all live.

`before_current_app.png` is the current production UI for comparison.

## Fidelity

**High fidelity.** Colors, typography, spacing, and sizes are final and should be matched closely. All data in the prototype is fake (see "What is faked" below) — the visual system is not.

## Screen

There is one screen. Top to bottom, it is a fixed-height flex column:

```
height: 100vh; overflow: hidden; display: flex; flex-direction: column;
background: oklch(0.17 0.008 280);
```

| Band | Height | Flex |
|---|---|---|
| Toolbar | 46px | `0 0 auto` |
| Track chips | 36px | `0 0 auto` |
| Roll area | — | `1 1 auto; min-height: 0` |
| Keyboard | 116px (+14px side padding) | `0 0 auto` |
| Readout row | 96px | `0 0 auto` |

The roll area absorbs all remaining height. `min-height: 0` on it is required or the flex column will overflow.

---

### 1. Toolbar (46px)

`display: flex; align-items: center; gap: 14px; padding: 0 14px;`
`background: oklch(0.20 0.009 280); border-bottom: 1px solid oklch(0.27 0.01 280);`

Every control is 30px tall. There is **no second control row** — the old Play/Stop/Listen/Practice/Wait/Tempo row and the bottom DAW/Two-Hand + octave + MIDI row are both folded into this bar and the readout row.

Left to right:

1. **Song button** — replaces both the "Piano Tutor" wordmark and the oversized "Load MIDI file" button. A 30px pill: `border: 1px solid oklch(0.30 0.012 280); border-radius: 7px; background: oklch(0.24 0.01 280); padding: 0 11px 0 9px; gap: 9px`. Contains a 14px outlined file icon, the song name at 13.5px/600/`-0.01em` (truncates with ellipsis, `max-width: 300px`), and the part count at 10px IBM Plex Mono in `oklch(0.58 0.012 280)`. Hover: `background oklch(0.28 0.012 280); border-color oklch(0.38 0.015 280)`. Click opens the file picker. Tooltip: "Load MIDI file ⌘O". With no file loaded, show "Load a MIDI file" in place of the song name.
2. 1px × 22px divider `oklch(0.28 0.01 280)`.
3. **Transport** — three 32×30 icon buttons with `gap: 4px`: play/pause (triangle), stop (square), loop (rounded-rect ring). Idle: transparent background, `color: oklch(0.72 0.012 280)`. Hover: `background oklch(0.25 0.01 280); color oklch(0.95 0.006 280)`. Active/on: `background oklch(0.62 0.19 300 / 0.22); border 1px solid oklch(0.62 0.19 300 / 0.55); color oklch(0.86 0.10 300); border-radius: 7px`. Tooltips: "Play / Pause  Space", "Stop & rewind", "Loop bars 5–13  L".
4. **Time readout** — 12px IBM Plex Mono, `letter-spacing: -0.02em`, `white-space: nowrap`. Elapsed in `oklch(0.95 0.006 280)`, ` / total` in `oklch(0.66 0.012 280)`.
5. Divider.
6. **Mode segmented control** — a 2px-padded group: `border 1px solid oklch(0.28 0.01 280); border-radius: 8px; background oklch(0.225 0.01 280)`. Three 38×26 icon buttons, `gap: 2px`, `border-radius: 6px`. Selected: `background oklch(0.62 0.19 300); color oklch(0.99 0 0)`. Unselected: transparent, `color oklch(0.70 0.012 280)`. Icons: speaker (Listen), mini keyboard (Practice), pause bars (Wait). Tooltips carry the meaning: "Listen — play the part back to me", "Practice — I play, tempo keeps running", "Wait — hold until I hit the right note".
7. **Spacer** (`flex: 1`).
8. **Tempo** — a 30px pill (`border 1px solid oklch(0.28 0.01 280); border-radius 7px; background oklch(0.225 0.01 280); padding 0 10px; gap 9px`): metronome-triangle icon, an 84×4px track (`border-radius 2px; background oklch(0.32 0.012 280)`) with a violet fill `oklch(0.62 0.19 300)` and a 12px white thumb, then the percentage at 11.5px IBM Plex Mono in a fixed 32px-wide slot so the row doesn't jitter. Tooltip shows the resolved BPM: "Tempo — 80% of 72 BPM".
9. **Metronome toggle** — 32×30 icon button, same active treatment as transport.
10. **Keyboard-range toggle** — 32×30 icon button. Off = keyboard fitted to the selected parts; on = full 88. Tooltip flips between "Fitted to the selected parts — click for full 88" and "Full 88 keys — click to fit the selected parts".
11. Divider.
12. **MIDI device pill** — 30px, `border 1px solid oklch(0.30 0.012 280); border-radius 7px; background oklch(0.225 0.01 280); gap 7px`. A 7px status dot (`border-radius 50%`, `oklch(0.72 0.17 150)` with `box-shadow 0 0 8px oklch(0.72 0.17 150 / 0.8)` when connected; `oklch(0.55 0.012 280)` with no glow when not) plus the device name at 12px in `oklch(0.82 0.01 280)`. Click opens device selection. Tooltip: "MIDI in connected — click to change device".

**Tooltips** are custom, not native `title`. They appear on hover below the control: `top: 34px` (36px under the taller pills), `padding: 4px 8px; border-radius: 5px; background oklch(0.30 0.012 280); border 1px solid oklch(0.38 0.015 280); font-size 11px; white-space nowrap; box-shadow 0 6px 18px oklch(0.10 0.01 280 / 0.6); z-index 40`. Centered under icon buttons (`left: 50%; transform: translateX(-50%)`), left-aligned under the song button, right-aligned under the right-hand controls so they never leave the viewport. Keyboard shortcuts inside a tooltip render in IBM Plex Mono at `oklch(0.65 0.012 280)`. (In a real implementation, add a ~400ms hover delay; the prototype shows them immediately.)

---

### 2. Track chips (36px)

`display: flex; align-items: center; gap: 7px; padding: 0 14px;`
`background: oklch(0.185 0.008 280); border-bottom: 1px solid oklch(0.24 0.01 280);`

One chip per track in the MIDI file. Each chip: 26px tall, `border-radius: 13px; padding: 0 9px; gap: 7px; white-space: nowrap`, containing

- an 8×8 `border-radius: 2px` color square in the track's hue,
- the track name at 12px/600,
- the note count at 9.5px IBM Plex Mono, `opacity: 0.6`,
- a role badge at 9.5px, uppercase, `letter-spacing: 0.06em`, `padding: 1px 5px; border-radius: 4px` ("right hand", "left hand", "pad", "fingered" — from the MIDI track/instrument name).

Three states:

| State | Border | Background | Text | Dot | Badge |
|---|---|---|---|---|---|
| Focused | track hue @ 55% | track hue @ 20% | `oklch(0.95 0.006 280)` | track hue + `0 0 8px hue/0.9` glow | `background oklch(0.99 0 0 / 0.14)`, `color oklch(0.92 0.006 280)` |
| In roll, not focused | track hue @ 55% | `oklch(0.24 0.01 280)` | `oklch(0.95 0.006 280)` | track hue, no glow | transparent, `oklch(0.52 0.012 280)` |
| Not selected | `oklch(0.30 0.012 280)` | transparent | `oklch(0.58 0.012 280)` | `oklch(0.40 0.012 280)` | transparent, `oklch(0.52 0.012 280)` |

Focused chips also get `box-shadow: 0 0 0 1px <hue>/0.5`.

Right-aligned hint at 11px in `oklch(0.55 0.012 280)`: "click to focus · ⌘-click to add a second roll · drag chips to reorder lanes".

**Selection rules** (this is the core of the multi-track feature):

- **Plain click** on a chip → that track becomes the focus *and* the only lane. Solo.
- **⌘/Ctrl/Shift-click** on an unselected chip → adds it as an extra lane and makes it the focus.
- **⌘/Ctrl/Shift-click** on a selected chip → removes that lane. If it was the focused one, focus moves to the first remaining lane.
- Maximum 3 lanes; adding a 4th drops the oldest.
- The last remaining lane cannot be removed.
- Lane order follows selection order; dragging chips reorders lanes (not implemented in the prototype).

---

### 3. Roll area (flex)

`padding: 10px 14px 8px; position: relative; display: flex; flex-direction: column;`

**Bar ruler** — 18px tall, `border-bottom: 1px solid oklch(0.26 0.01 280); margin-bottom: 6px`. 16 equal `flex: 1 1 0` cells, each `padding-left: 4px; border-left: 1px solid oklch(0.24 0.01 280)` (first cell's border transparent), bar number at 9.5px IBM Plex Mono in `oklch(0.50 0.012 280)`. One ruler for all lanes.

**Lanes** — `flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px`. One lane per selected track, stacked, all sharing the ruler, the loop region, and the playhead.

Each lane: `position: relative; border-radius: 8px; overflow: hidden; background: oklch(0.135 0.012 282); min-height: 0`.
- Focused lane: `flex: 1.7 1 0`, `border: 1px solid <hue>/0.40`, `opacity: 1`.
- Other lanes: `flex: 1 1 0`, `border: 1px solid oklch(0.24 0.01 280)`, `opacity: 0.9`.

Grid, as a background layer filling the lane:
```css
background-image:
  linear-gradient(to right, oklch(0.24 0.012 282) 0 1px, transparent 1px 100%),
  linear-gradient(to right, oklch(0.19 0.012 282) 0 1px, transparent 1px 100%);
background-size: 6.25% 100%, 1.5625% 100%;   /* bars, 16ths */
```

Notes: absolutely positioned, `border-radius: 2px; min-height: 4px`. Horizontal position and width from time; vertical position from pitch, scaled to that lane's own pitch range **padded by 2 semitones on each side** — so each lane auto-zooms to its part rather than sharing a global pitch axis. Focused lane: solid hue + `box-shadow: 0 0 6px <hue>/0.35`. Other lanes: hue at 50% alpha, no glow.

Lane label, `position: absolute; top: 6px; left: 8px`, `display: flex; gap: 6px; padding: 2px 7px; border-radius: 5px; background: oklch(0.135 0.012 282 / 0.85)`: a 7×7 hue square, the track name at 10.5px/600 uppercase `letter-spacing: 0.02em`, and the lane's pitch range at 9.5px IBM Plex Mono `opacity: 0.55` (e.g. "A3–E6").

**Overlay layer** — one absolutely positioned, `pointer-events: none` layer spanning all lanes (inset to the roll area, from below the ruler to the bottom):
- Loop region: `background oklch(0.62 0.19 300 / 0.09)`, `border-left`/`border-right: 1px solid oklch(0.62 0.19 300 / 0.55)`, plus a 5×16px `border-radius: 2px` violet grab handle at the top of each edge.
- Playhead: 2px wide, `background oklch(0.96 0.02 280)`, `box-shadow: 0 0 10px oklch(0.96 0.02 280 / 0.55)`, gently pulsing (`opacity 1 → 0.65 → 1`, 1.6s ease-in-out, infinite). Drop the pulse if you prefer; it exists to keep the playhead visible against dense notes.

Loop interactions carry over from the current app: drag on a roll to set a loop, drag an edge to resize, click to clear, tap to seek. Dragging in **any** lane sets the shared loop.

---

### 4. Keyboard (116px + 14px side padding)

`position: relative; border-radius: 5px; overflow: hidden; background: oklch(0.30 0.01 280);`
`box-shadow: inset 0 -1px 0 oklch(0.42 0.012 280), 0 8px 24px oklch(0.10 0.01 280 / 0.5);`

White keys are a `display: flex` row of equal `flex: 1 1 0` cells, full height, `background: oklch(0.97 0.004 280)`, `border-right: 1px solid oklch(0.72 0.008 280)`, `border-radius: 0 0 3px 3px`. Black keys are absolutely positioned at 62% height, width = 0.66 × white-key width, centered on the white-key boundary, `background: linear-gradient(oklch(0.30 0.01 280), oklch(0.16 0.008 280))`, `border-radius: 0 0 2px 2px`, `box-shadow: 0 2px 5px oklch(0.10 0.01 280 / 0.55)`, `z-index: 2`.

C keys carry a label at the bottom: 8.5px IBM Plex Mono, `oklch(0.55 0.01 280)`, darkening to `oklch(0.20 0.01 280 / 0.75)` when the key is filled.

**Range**: when the range toggle is off, the keyboard spans the union of the selected tracks' pitch ranges, expanded outward to the nearest C boundaries, with a 24-semitone minimum, clamped to A0–C8. When on, it is the full 88 (A0–C8).

**Key states** — applied in this order:

1. **Sounding note** (from the MIDI, for any lane): fill with that lane's track hue, plus `inset 0 0 0 1px oklch(0.25 0.02 280 / 0.25)`.
2. **Expected note** (Practice/Wait): a **ring**, not a fill — `inset 0 0 0 2.5px oklch(0.72 0.17 150)`. If the key isn't already filled by a sounding note, tint it (`oklch(0.93 0.05 150)` white / `oklch(0.34 0.06 150)` black). The ring survives on top of a hue fill, which is why it's a ring.
3. **Note you played**: fills the key — `oklch(0.72 0.17 150)` if correct, `oklch(0.63 0.21 27)` if wrong. Raise `z-index` to 3 for black keys so it isn't clipped by neighbours.

---

### 5. Readout row (96px)

`display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 0 16px;`

**Left column** — two 11px lines in `oklch(0.55 0.012 280)`, `gap: 3px`: the loop hint ("Drag on a roll to set a practice loop · drag an edge to resize · click to clear") and live position ("Bar 7 · beat 3 · loop bars 5–13 · 8 of 9 notes clean").

**Center column** — `display: flex; gap: 22px; align-items: center`:
- Expected, right-aligned: label "EXPECTED" at 9.5px IBM Plex Mono `letter-spacing: 0.14em` in `oklch(0.55 0.012 280)`; note name at 26px/500 IBM Plex Mono, `letter-spacing: -0.02em`, `line-height: 1`, `oklch(0.80 0.01 280)`.
- 1px × 42px divider `oklch(0.28 0.01 280)`.
- Played, left-aligned, `min-width: 190px` so the row doesn't shift as note names change: label "YOU PLAYED" (wrong) or "CLEAN" (right) at 9.5px IBM Plex Mono `letter-spacing: 0.14em`; note name at 54px/600 IBM Plex Mono, `letter-spacing: -0.03em`, `line-height: 1`. Both label and note are `oklch(0.63 0.21 27)` when wrong, `oklch(0.72 0.17 150)` when right.

Sharps render as `♯` (U+266F), not `#`.

**Right column** — right-aligned, 11px `oklch(0.55 0.012 280)`, `gap: 16px`: "On-screen octave **C4** · Z / X to shift" (the note name in IBM Plex Mono `oklch(0.78 0.01 280)`) and the live key count/range in IBM Plex Mono, e.g. "73 keys · C1–C7".

---

## Interactions & behavior

| Trigger | Result |
|---|---|
| Click song button / ⌘O | File picker; on load, replace song name and part count, rebuild chips, focus the first track |
| Click play | Toggle play/pause; icon and active styling flip |
| Click stop | Stop and rewind to the loop start (or 0 if no loop) |
| Click loop | Enable/disable the loop region |
| Click a mode icon | Switch Listen / Practice / Wait |
| Drag tempo | 25–150%; label and resolved BPM in the tooltip update live |
| Click metronome | Toggle the click |
| Click range toggle | Fitted range ⟷ full 88 |
| Click MIDI pill | Device selection |
| Hover any toolbar control | Tooltip after ~400ms |
| Click a chip | Solo that track |
| ⌘/Ctrl/Shift-click a chip | Add or remove that lane (max 3, min 1) |
| Drag chips | Reorder lanes |
| Drag on any roll | Set the shared loop region |
| Drag a loop edge | Resize |
| Click a roll | Clear the loop / seek |
| Z / X | Shift the on-screen keyboard octave |
| Play a wrong note in Practice | Played readout and the key turn red; expected keeps its green ring |
| Play the right note | Both turn green; label reads "CLEAN" |
| Wait mode | Playhead holds at the expected note until it is hit |

Animations: only the playhead pulse (1.6s ease-in-out, infinite) and standard hover transitions. Nothing else moves except the playhead and the rolls.

## State

```
songName, songDuration, tracks[]        // parsed from the MIDI file
playing, position, tempoPct, metronome, mode ('listen'|'practice'|'wait')
loop: { enabled, startBar, endBar } | null
layered: number[]     // track indices with a lane, in lane order, length 1–3
focus: number         // track index; must be in `layered`
fullKeyboard: boolean
midiDevice, octave
soundingPitches: Map<pitch, trackIndex>   // derived, per frame
expectedPitch, playedPitch, playedCorrect
```

Derived, not stored: each lane's pitch range (track min/max ± 2), the keyboard range (union of `layered` ranges, expanded to C boundaries, min 24 semitones, clamped A0–C8), lit-key colors (from `soundingPitches` → track hue).

**One rule to preserve:** lit keys, lane notes, lane labels, and chips must all be driven by the same track data. The first draft of this prototype hardcoded the lit pitches and they contradicted the selected tracks — it read as a bug immediately.

## Design tokens

**Surfaces** (all oklch, hue 280–282)
| Token | Value |
|---|---|
| App background | `oklch(0.17 0.008 280)` |
| Toolbar | `oklch(0.20 0.009 280)` |
| Chip bar | `oklch(0.185 0.008 280)` |
| Control surface | `oklch(0.225 0.01 280)` / raised `oklch(0.24 0.01 280)` |
| Control hover | `oklch(0.28 0.012 280)` |
| Popover / tooltip | `oklch(0.30 0.012 280)` |
| Roll background | `oklch(0.135 0.012 282)` |
| Bar gridline | `oklch(0.24 0.012 282)` · 16th gridline `oklch(0.19 0.012 282)` |
| Border | `oklch(0.27 0.01 280)` / subtle `oklch(0.24 0.01 280)` / strong `oklch(0.38 0.015 280)` |

**Text**: primary `oklch(0.93 0.006 280)`, bright `oklch(0.95 0.006 280)`, secondary `oklch(0.82 0.01 280)`, muted `oklch(0.66 0.012 280)`, faint `oklch(0.55 0.012 280)`, disabled `oklch(0.50 0.012 280)`.

**Accent** (transport, modes, loop, tempo): `oklch(0.62 0.19 300)`; tint `/0.22`, border `/0.55`, active text `oklch(0.86 0.10 300)`.

**Semantic — reserved, never used for a track**: correct `oklch(0.72 0.17 150)`, wrong `oklch(0.63 0.21 27)`.

**Track hues** — all near L 0.70–0.76, C 0.12–0.15, so no track dominates:
| Track | Hue |
|---|---|
| 1 | `oklch(0.70 0.15 250)` blue |
| 2 | `oklch(0.76 0.14 78)` amber |
| 3 | `oklch(0.72 0.12 205)` cyan |
| 4 | `oklch(0.68 0.15 348)` pink |

Assign by track index and keep the assignment stable for the session. Extend by rotating hue in ~70° steps, staying clear of 130–170 (green) and 10–40 (red).

**Typography**
- UI: **Archivo** (Google Fonts), weights 400/500/600/700. Sizes: 13.5px song name, 12px chips and pills, 11px hints, 10.5px lane labels, 9.5px badges.
- Numeric / musical: **IBM Plex Mono**, 400/500/600. Sizes: 54px played note, 26px expected note, 12px time, 11.5px tempo, 9.5px labels and counts.
- Tracking: `-0.03em` on the 54px note, `-0.02em` on the 26px note and the time, `0.14em` on the small uppercase labels, `0.06em` on chip badges.

**Radius**: 13px chips · 8px lane and mode group · 7px pills and icon buttons · 6px mode buttons · 5px keyboard, tooltips, lane label · 3/2px keys and notes.

**Spacing**: 14px page gutter · 16px readout gutter · 14px toolbar gap · 7px chip gap · 6px lane gap · 4px transport gap.

## Assets

None. All icons are inline SVGs built from rectangles, triangles, and circles (file, play, stop, loop, speaker, mini keyboard, pause, metronome, dots, keyboard-range). No images, no icon font. Fonts load from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## What is faked in the prototype

Do not carry these over:

- Notes are generated from a seeded pseudo-random walk over a scale, not from a real MIDI file.
- The playhead is parked at 41% and the loop at 25–75%; nothing advances.
- Time (1:18 / 3:12), bar/beat, note counts, tempo (80% of 72 BPM), the song title, track note counts, and the MIDI device name are all placeholder strings.
- Expected/played notes are derived from whatever the focused lane happens to have under the playhead, then offset by 6 semitones to demo the wrong-note state.
- Chip drag-to-reorder, tempo dragging, and loop dragging are not wired.

## Files

- `states/01-two-tracks-practice-wrong-note.png` — default: Piano R focused + Piano L layered, Practice mode, a wrong note played (red fill, green expected ring)
- `states/02-solo-bass.png` — one chip plain-clicked: single lane, keyboard refitted to the Bass range
- `states/03-three-tracks.png` — three lanes (Piano R focused, Piano L, Strings), keyboard spanning the union of their ranges
- `states/04-full-88-keys.png` — two lanes with the keyboard-range toggle on (A0–C8)
- `states/05-correct-note.png` — correct note played: both readout and key green, label reads "CLEAN"

All screenshots are the layout at 1512px wide.

- `Piano Tutor.dc.html` — the design. Open in a browser; it is self-contained apart from the Google Fonts link. Layout lives in the markup; per-lane and per-key styling is computed in the `renderVals()` method near the bottom of the file.
- `before_current_app.png` — the current production UI, for comparison.
