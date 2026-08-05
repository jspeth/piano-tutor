# System Patterns

Distilled from [PLAN.md](../PLAN.md)'s Architecture section — treat PLAN.md
as authoritative if this drifts; update both together.

## Architecture overview

- **Parsing**: `@tonejs/midi` parses an uploaded file into tracks/notes
  (`midi`, `name`, `time`, `duration`, `velocity`).
  [src/lib/midiParser.ts](../src/lib/midiParser.ts)
- **Playback engine**: `Tone.js`. A `Tone.Part` schedules note on/off events
  against a synth voice, driven by the Transport.
  [src/lib/player.ts](../src/lib/player.ts) owns:
  - the Transport
  - the single song-time ↔ transport-time conversion
    (`transport = song / tempo`)
  - loop points
  This is deliberately centralized so the piano-roll, loop region, and
  playhead can never disagree about time. Tempo changes mid-playback rebuild
  the Part and reposition the Transport to preserve song-time position.
- **Piano-roll view**: Canvas (not SVG) for redraw performance with a moving
  playhead. [src/components/PianoRoll.tsx](../src/components/PianoRoll.tsx)
  - x = note `time`/`duration` (song seconds × px-per-sec)
  - y = pitch rows spanning the track's note range
  - Playhead driven by `requestAnimationFrame` reading
    `Tone.Transport.seconds`, converted back to song time.
  - Region selection: pointer drag sets `{ start, end }` in song seconds,
    drawn as a translucent overlay with edge handles.
  - Looping: region converted to transport time via
    `Tone.Transport.setLoopPoints(...)` + `Transport.loop = true`; recomputed
    whenever tempo or region changes.
- **Note input abstraction**: a small event bus,
  [src/lib/noteInput.ts](../src/lib/noteInput.ts), emitting
  `{ type: 'noteon' | 'noteoff', midi, source }`. Mouse, computer keyboard,
  and (later) Web MIDI all publish to the same bus; pressed-notes state,
  the note-name readout, and wait-for-key mode all subscribe to it rather
  than to any specific input device. This is the key pattern that lets
  hardware-free and hardware-based input be interchangeable — new input
  sources plug in without touching consumers.
  - Pressed notes also trigger the synth directly, so silent practice input
    is still audible.
- **Mouse input**: `PianoKeyboard` has pointer handlers per key rect
  (`pointerdown` = note-on, `pointerup`/`pointercancel` = note-off) with
  pointer capture; dragging across keys while held releases the previous key
  and presses the new one (glissando behavior).
- **Computer-keyboard input**: DAW-style two-row mapping from a base octave
  (`A W S E D F T G Y H U J K` = C, C#, D, D#, E, F, F#, G, G#, A, A#, B, C),
  `Z`/`X` shift the octave down/up. Uses `e.code` (layout-independent),
  ignores `e.repeat` and events targeting form controls. Mapping in
  [src/lib/keyboardMapping.ts](../src/lib/keyboardMapping.ts), wired via
  [src/hooks/useComputerKeyboardInput.ts](../src/hooks/useComputerKeyboardInput.ts).
- **Key-name readout**:
  [src/components/NoteReadout.tsx](../src/components/NoteReadout.tsx) shows
  pressed notes and (in wait-for-key mode) expected notes, e.g.
  "Expected: F#4 · A4 | Pressed: F#4". Names derived via
  [src/lib/noteNames.ts](../src/lib/noteNames.ts).
- **Wait-for-key mode (M4, not yet built)**: group the selected track's notes
  (within the selected region, if any) into onset "steps" — notes whose
  start times fall within a small epsilon form a chord step. Playback pauses
  the Transport at each step until the note-input bus reports all of that
  step's pitches pressed, then advances. Designed to work identically
  regardless of input source, by construction of the note-input bus pattern.

## Design principles to preserve

- One shared clock: never let a second, independent time source creep in for
  the roll/playhead/loop — everything derives from `player.ts`'s
  song-time ↔ transport-time conversion.
- One input bus: new input sources (Web MIDI) must publish to
  `noteInput.ts`, not bypass it and talk directly to consumers.
- Canvas for anything with a per-frame redraw (piano-roll); SVG is fine for
  the mostly-static keyboard.
