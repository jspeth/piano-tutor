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

## What's left to build

- [ ] **M6** — Staff notation view (VexFlow), synced to the same note data
  and playhead. Deliberately skipped for now; no committed timeline.

## Current status

Actively developed, no milestone in progress at last check. M1–M5 and M7
are done; M6 is deliberately deferred. See [activeContext.md](activeContext.md)
for the latest.

## Known issues / limitations

- No persistence — reloading the page loses the loaded file, track
  selection, and selected practice region.
- Computer-keyboard input is limited by hardware key rollover; large chords
  may need the mouse or, later, a MIDI keyboard. Accepted limitation, not a
  bug.
