# Progress

[PLAN.md](../PLAN.md)'s milestone checklist is the source of truth — keep
this summary in sync with it rather than forking it.

## What works

- [x] **M1** — Parse & play: upload a MIDI file, list tracks, select one,
  play back with a basic synth, tempo slider, lit keyboard synced to
  playback.
- [x] **M2** — Piano-roll + region practice: Canvas piano-roll of the
  selected track with a synced playhead; drag-select a time region;
  play/loop just that region via Transport loop points; playback logic
  extracted into `src/lib/player.ts`.
- [x] **M3** — Hardware-free input: clickable on-screen keyboard (pointer
  events) and computer-keyboard mapping with octave shift, both feeding a
  shared note-input bus, sounding the synth, lighting pressed keys, shown in
  a text note-name readout.
- [x] **M4** — Wait-for-key mode: pause at each note/chord until the correct
  key(s) are pressed (mouse or typing keyboard), then advance; honors the
  selected region (including looping); readout shows expected vs. pressed
  note names.
- [x] **M5** — Web MIDI input: `src/hooks/useWebMidiInput.ts` enables
  WebMidi.js, publishes connected-keyboard note-on/off into the same
  note-input bus (`source: 'midi'`), and force-releases held notes on
  disconnect/unmount so nothing gets stuck lit. Readout/lit-keys/wait-for-key
  work unchanged with real hardware.
- Additional polish beyond M3 (not separately milestoned in PLAN.md):
  listen/practice modes, spacebar play/pause, tap-to-seek on the piano-roll,
  and hovering/tapping a piano-roll note bar directly to see its key name
  and play it (region-select/seek on blank space unchanged).
- Additional UI layout pass (not separately milestoned): no-page-scroll flex
  shell with the piano-roll shrinking/scrolling internally instead of
  overflowing the page, compact single-row header, Parts as a dropdown
  folded into the controls row, the on-screen keyboard scrolling
  independently of the controls below it, an always-visible big centered
  note readout (`Playing: ...` in listen/practice, `Expected: ...` in wait
  mode), and a constant-width Play/Pause button. See
  [activeContext.md](activeContext.md) for detail.
- [x] **M7** — Polish, done ahead of M6 by explicit request:
  - Sampled piano: `src/lib/instrument.ts` owns a singleton `Tone.Sampler`
    (Salamander Grand Piano, bundled locally under
    `public/samples/salamander/`) in place of the `Tone.PolySynth` that
    used to live in `player.ts`. Play and live-input attack are gated on
    the sampler finishing its load (`whenInstrumentLoaded()`); `App.tsx`
    disables Play and shows "Loading piano…"/a load error until then.
  - Correct/incorrect press feedback: wait-mode fires
    `onNoteFeedback(midi, 'correct' | 'incorrect')` per `noteon` without
    changing step-satisfaction logic; `App.tsx` flashes the key/note name
    green or red for ~400ms.
  - UI cleanup: removed dead template CSS, fixed light/dark-unsafe
    hardcoded colors, consistent button/file-input/track-list styling,
    wrapping controls row.

- [x] **M8** — Multitrack mechanics: layer up to 3 tracks into simultaneous
  piano-roll lanes (chip-based solo/add/remove selection, one lane always
  focused, per-lane pitch ranges, shared loop/playhead, union keyboard
  range). Functional first, current visual style — see
  [activeContext.md](activeContext.md) for the full implementation summary.
- [x] **M9** — Visual redesign: applied
  [design/design_handoff_piano_tutor/](../design/design_handoff_piano_tutor/)
  on top of M8's mechanics — five-band fixed layout (toolbar/chips/roll/
  keyboard/readout), oklch design tokens with a dark default and a
  relationship-mirrored light override, per-track hue coloring
  (`src/lib/trackColors.ts`), a cached canvas↔CSS token bridge
  (`src/lib/tokens.ts`), a shared rAF frame loop (`src/lib/frameLoop.ts`),
  the toolbar/tooltip/keyboard-shortcut system, restyled track chips, a
  piano-roll rework (JS-computed per-lane heights, DOM playhead/region
  overlay, dirty-redraw skip), a restyled on-screen keyboard, and a
  restyled 3-column readout row. Accepted deviations from the handoff (no
  expected-note ring in Practice mode, keybed doesn't stretch for narrow
  ranges, no metronome/chip-hint-text/chip-drag-reorder, seconds-based grid
  instead of bars/beats) are called out in PLAN.md. See
  [activeContext.md](activeContext.md) for the full implementation summary,
  including the step-10 cleanup (dead CSS/legacy token aliases removed) and
  light-mode legibility pass (read cleanly, no token changes needed).

## What's left to build

- [ ] **M6** — Staff notation view (VexFlow), synced to the same note data
  and playhead. Deferred indefinitely, no committed timeline — the only
  milestone left in PLAN.md now that M9 is done.

## Current status

Actively developed. M1–M5, M7, M8, and M9 are all done; M6 is deferred
indefinitely with no committed timeline — see [activeContext.md](activeContext.md)
for the latest.

## Known issues / limitations

- No persistence — reloading the page loses the loaded file, track
  selection, and selected practice region.
- Computer-keyboard input is limited by hardware key rollover; large chords
  may need the mouse or, later, a MIDI keyboard. Accepted limitation, not a
  bug.
