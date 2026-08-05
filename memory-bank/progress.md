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
- Additional polish beyond M3 (not separately milestoned in PLAN.md):
  listen/practice modes, spacebar play/pause, tap-to-seek on the piano-roll.

## What's left to build

- [ ] **M5** — Web MIDI input: detect a connected keyboard, publish its
  note-on/off into the same input bus so readout/lit-keys/wait-for-key work
  unchanged with real hardware.
- [ ] **M6** — Staff notation view (VexFlow), synced to the same note data
  and playhead.
- [ ] **M7** — Polish: sampled piano instead of basic synth, visual feedback
  for correct/incorrect presses, UI cleanup.

## Current status

Actively developed, no milestone in progress at last check. M1–M4 done, M5
is next. See [activeContext.md](activeContext.md) for the latest.

## Known issues / limitations

- Instrument sound is a generic `Tone.PolySynth`, not a sampled piano
  (tracked as part of M7).
- No persistence — reloading the page loses the loaded file, track
  selection, and selected practice region.
- Computer-keyboard input is limited by hardware key rollover; large chords
  may need the mouse or, later, a MIDI keyboard. Accepted limitation, not a
  bug.
