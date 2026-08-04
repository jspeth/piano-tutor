# Piano Tutor — Plan

A browser app to load a MIDI file, pick a part to learn, and practice it with a
lit-up keyboard, staff notation, and a real MIDI keyboard plugged into the
computer.

## Core decisions

- **Platform**: web app (React + TypeScript + Vite). Chosen over an Electron
  wrapper for now because the Web MIDI API + Web Audio cover everything we
  need directly in the browser, with much less build/distribution overhead.
  Caveat: Web MIDI input works in Chrome/Edge; Safari/Firefox support is
  inconsistent, so development/testing should target Chrome or Edge.
- **Parts**: defined by the MIDI file's existing track/channel structure (no
  auto-splitting by hand/pitch-range, no arbitrary time-range selection).
- **Note display**: both staff notation and falling notes (piano-roll), plus
  the lit keyboard — not just one or the other.
- **MIDI file input**: user uploads a `.mid`/`.midi` file from disk. No
  bundled sample songs, no backend.

## Architecture

- **Parsing**: `@tonejs/midi` reads an uploaded file into tracks, each with
  notes (`midi`, `name`, `time`, `duration`, `velocity`). See
  [src/lib/midiParser.ts](src/lib/midiParser.ts).
- **Playback**: `Tone.js` — a `Tone.Part` schedules note on/off events against
  a synth voice, driven by `Tone.Transport`. Tempo is applied by scaling note
  `time`/`duration` by a multiplier before scheduling (not via
  `Transport.bpm`, since note times come from the file in absolute seconds).
- **MIDI input**: `WebMidi.js` (installed, not yet wired up) will listen to a
  connected MIDI keyboard and compare incoming note-on events against the
  expected next note(s).
- **Keyboard view**: custom SVG piano in
  [src/components/PianoKeyboard.tsx](src/components/PianoKeyboard.tsx),
  auto-scoped to the selected track's note range, highlights active notes
  during playback (and will highlight "expected" notes in wait-mode).
- **Staff notation**: not yet built — planned via `VexFlow`, driven from the
  same note array, with a scrolling/highlighted playhead.
- **Falling notes**: not yet built — planned as a Canvas piano-roll synced to
  the same Transport clock, sitting above the keyboard.

## Milestones

- [x] **M1** — Parse & play: upload a MIDI file, list tracks, select one,
  play it back with a basic synth, tempo slider, lit keyboard synced to
  playback.
- [ ] **M2** — Web MIDI input: detect a connected keyboard, listen for
  note-on/off, show which keys are actually being pressed.
- [ ] **M3** — Wait-for-key mode: pause playback at each note/chord until the
  correct key(s) are pressed on the connected keyboard, then advance.
- [ ] **M4** — Staff notation view (VexFlow) synced to the same note data and
  playhead.
- [ ] **M5** — Falling notes (Canvas piano-roll) above the keyboard.
- [ ] **M6** — Polish: better piano sound (sampled piano instead of basic
  synth), visual feedback for correct/incorrect presses, UI cleanup.

## Known limitations

- Tempo slider only takes effect on the next Play — sliding it mid-playback
  doesn't retime the currently-scheduled `Tone.Part`. Fix would rebuild the
  part in place (or reschedule) when tempo changes while playing.
- Instrument sound is a generic `Tone.PolySynth`, not a sampled piano.
- No persistence — reloading the page loses the loaded file and track
  selection.
