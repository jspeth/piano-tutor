# Piano Tutor — Plan

A browser app to load a MIDI file, pick a part to learn, and practice it with a
lit-up keyboard and a DAW-style piano-roll view. Practice works with **no
hardware**: the on-screen keyboard is clickable and the computer keyboard maps
to piano keys, so you can practice on a laptop anywhere (e.g., on a train). A
real MIDI keyboard and staff notation come later.

## Core decisions

- **Platform**: web app (React + TypeScript + Vite). Chosen over an Electron
  wrapper because Web Audio (and eventually Web MIDI) cover everything we need
  directly in the browser, with much less build/distribution overhead.
- **No hardware required (near-term)**: primary input methods are the mouse
  (click/drag on the on-screen SVG keyboard) and the computer typing keyboard
  (mapped to piano keys, DAW-style). A physical MIDI keyboard via `WebMidi.js`
  is deferred to a late milestone. All input sources feed one shared note-event
  abstraction so wait-for-key mode doesn't care where a note came from.
- **Parts**: defined by the MIDI file's existing track/channel structure (no
  auto-splitting by hand/pitch-range).
- **Time-region selection is a core feature**: the piano-roll supports
  drag-selecting an arbitrary time range of the selected track to focus
  practice — play just that region, loop it, and run wait-for-key within it.
  (This reverses the earlier "no arbitrary time-range selection" decision.)
- **Note display (near-term)**: horizontal GarageBand/DAW-style piano-roll of
  the selected track + the lit keyboard + a simple text readout of pressed and
  expected note names (e.g., "F#4"). Staff notation (VexFlow) is deferred to a
  late milestone.
- **MIDI file input**: user uploads a `.mid`/`.midi` file from disk. No
  bundled sample songs, no backend.

## Architecture

- **Parsing**: `@tonejs/midi` reads an uploaded file into tracks, each with
  notes (`midi`, `name`, `time`, `duration`, `velocity`). See
  [src/lib/midiParser.ts](src/lib/midiParser.ts).
- **Playback engine**: `Tone.js` — a `Tone.Part` schedules note on/off events
  against a synth voice, driven by the Transport. Playback lives in
  [src/lib/player.ts](src/lib/player.ts), which owns the Transport, the single
  song-time ↔ transport-time conversion (`transport = song / tempo`), and
  loop points — so the piano-roll, loop region, and playhead all agree on one
  clock. Tempo changes mid-playback rebuild the Part and reposition the
  Transport so the playhead stays at the same song time.
- **Piano-roll view**: Canvas component (`src/components/PianoRoll.tsx`).
  Horizontal timeline: x = note `time`/`duration` (song seconds × px-per-sec),
  y = pitch rows spanning the track's note range (reuse the range logic from
  `App.tsx`). Canvas over SVG for redraw performance with a moving playhead
  (`requestAnimationFrame` reading `Tone.Transport.seconds`, converted back to
  song time). Region selection: pointer drag on the roll sets
  `{ start, end }` in song seconds, drawn as a translucent overlay with edge
  handles for adjustment. Looping: player converts the region to transport
  time and uses `Tone.Transport.setLoopPoints(...)` + `Transport.loop = true`;
  loop points are recomputed whenever tempo or region changes.
- **Note input abstraction**: a small event bus (`src/lib/noteInput.ts`)
  emitting `{ type: 'noteon' | 'noteoff', midi, source }`. Mouse, computer
  keyboard, and (later) Web MIDI all publish to it; the "pressed notes" set,
  key-name readout, and wait-for-key mode subscribe to it. Pressed notes also
  trigger the synth so silent practice input is audible.
- **Mouse input on the SVG keyboard**: `PianoKeyboard` gains pointer handlers
  per key rect — `pointerdown` = note-on, `pointerup`/`pointercancel` =
  note-off, with pointer capture; moving across keys while held (glissando)
  releases the previous key and presses the new one.
- **Computer-keyboard input**: DAW-style two-row mapping from a base octave
  (`A W S E D F T G Y H U J K` = C, C#, D, D#, E, F, F#, G, G#, A, A#, B, C),
  with `Z`/`X` shifting the octave down/up. Listen on `keydown`/`keyup` using
  `e.code` (layout-independent), ignore `e.repeat` and events targeting form
  controls. Mapping lives in `src/lib/keyboardMapping.ts`.
- **Key-name readout**: a small component (`src/components/NoteReadout.tsx`)
  showing the names of currently pressed notes and, in wait-for-key mode, the
  expected note(s) — e.g., "Expected: F#4 · A4  |  Pressed: F#4". Note names
  derived from MIDI numbers via a shared `midiToNoteName()` util (or
  `Tone.Frequency(midi, 'midi').toNote()`).
- **Wait-for-key mode**: group the selected track's notes (within the selected
  region, if any) into onset "steps" — notes whose start times fall within a
  small epsilon form a chord step. Playback pauses the Transport at each step
  until the note-input bus reports all of that step's pitches pressed, then
  advances. Works identically for mouse, typing-keyboard, and (later) MIDI
  input.
- **Web MIDI input (deferred)**: `WebMidi.js` (already installed) will publish
  note-on/off from a connected keyboard into the same note-input bus. Chrome/
  Edge only; Safari/Firefox support is inconsistent.
- **Staff notation (deferred)**: `VexFlow`, driven from the same note array,
  with a scrolling/highlighted playhead.

## Milestones

- [x] **M1** — Parse & play: upload a MIDI file, list tracks, select one,
  play it back with a basic synth, tempo slider, lit keyboard synced to
  playback.
- [x] **M2** — Piano-roll + region practice: Canvas piano-roll of the selected
  track with a synced playhead; drag-select a time region; play/loop just that
  region via Transport loop points; extract playback into `src/lib/player.ts`.
- [ ] **M3** — Hardware-free input: clickable on-screen keyboard (pointer
  events) and computer-keyboard mapping with octave shift, both feeding a
  shared note-input bus, sounding the synth, lighting pressed keys, and shown
  in a text note-name readout.
- [ ] **M4** — Wait-for-key mode: pause at each note/chord until the correct
  key(s) are pressed via mouse or typing keyboard, then advance; honors the
  selected region (including looping it); readout shows expected vs. pressed
  note names.
- [ ] **M5** — Web MIDI input: detect a connected keyboard, publish its
  note-on/off into the same input bus so everything (readout, lit keys,
  wait-for-key) works with real hardware unchanged.
- [ ] **M6** — Staff notation view (VexFlow) synced to the same note data and
  playhead.
- [ ] **M7** — Polish: better piano sound (sampled piano instead of basic
  synth), visual feedback for correct/incorrect presses, UI cleanup.

## Known limitations

- Instrument sound is a generic `Tone.PolySynth`, not a sampled piano.
- No persistence — reloading the page loses the loaded file, track selection,
  and (once built) the selected practice region.
- Computer-keyboard input is limited by hardware key rollover (some key
  combinations won't register simultaneously on many laptop keyboards), so
  large chords may need the mouse or, later, a MIDI keyboard.
