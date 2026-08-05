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
  and Web MIDI all publish to the same bus; pressed-notes state,
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
- **Wait-for-key mode (M4, done)**: a third `PlaybackMode` (`'wait'`), not an
  orthogonal flag — in this mode the synth only sounds via the player's own
  live-input `attack`/`release` path, same as practice mode.
  [src/lib/steps.ts](../src/lib/steps.ts)'s `groupIntoSteps()` groups the
  full track's notes into onset "steps" once (in `Player.setNotes()`); a
  step's `time` compares each note against the *step's first note*, not the
  previous note, so a chain of close onsets can't cumulatively merge into one
  giant step. Steps are filtered to the active region (half-open:
  `region.start <= step.time < region.end`) at session-start/region-change,
  not regrouped.
  - **No `Tone.Part` in this mode** — its look-ahead scheduling can't pause
    indefinitely mid-step. Instead `player.ts` runs a manual stepper: advancing
    seeks the transport (`Transport.seconds`) to the next step's time and
    lights its pitches via the existing `activeNotes` channel; the Transport
    itself never starts. The piano-roll's rAF playhead loop needs no changes
    since it just reads transport seconds regardless of play state.
  - **Satisfaction is accumulation, not a pressed-set snapshot**: a step
    advances once every one of its pitches has arrived as a *fresh* `noteon`
    event (via `noteInput.ts`'s raw `subscribe`, registered per step) since
    that step activated — notes already held over from the previous step
    don't count. This is the only rule compatible with mouse-only input
    (single pointer can't hold a chord) and prevents a held repeated pitch
    from auto-advancing without a fresh strike. Wrong notes are ignored (no
    penalty/reset — deliberately deferred to M7).
  - Looping: a region wraps back to its first in-region step once the last
    one is satisfied; with no region, the session stops at song end.
  - `onExpectedNotesChange` (`Set<number> | null`) reports the active step's
    pitches so `NoteReadout` can show `Expected: ... | Pressed: ...`
    simultaneously (both lines render whenever `expectedNotes` is passed).
  - Listener resubscription for the next step is deferred a microtask, since
    `noteInput.ts`'s `publish()` iterates its listener set live and would
    otherwise let the note that just satisfied a step also satisfy the next
    one in the same dispatch.
- **Web MIDI input (M5, done)**:
  [src/hooks/useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts) is the third
  publisher into `noteInput.ts`, alongside mouse and computer keyboard —
  proof the bus pattern scales to a new input source with zero consumer
  changes. Calls `WebMidi.enable()` (from the `webmidi` package), then
  attaches `noteon`/`noteoff` listeners to every `WebMidi.inputs[]` `Input`,
  publishing `{ type, midi: e.note.number, source: 'midi' }`. Devices can be
  plugged/unplugged while the app is open, so inputs are (re)attached on
  WebMidi's own `connected`/`disconnected` events rather than just once at
  enable time.
  - **Per-input held-note tracking**: each attached input keeps its own
    `midi -> count` map, incremented on `noteon`/decremented on `noteoff`. On
    detach (disconnect or hook unmount) any still-held pitches get a forced
    `noteoff` published. Without this, `noteInput.ts`'s per-source hold-count
    model would leave that pitch's `'midi'` hold count stuck above zero
    forever if a key was released after the device disappeared — the key
    would stay lit with no way to clear it short of a page reload. This
    mirrors `useComputerKeyboardInput.ts`'s `releaseAll()` on blur/unmount,
    just keyed by input instead of by keyboard code.
  - **Never calls `WebMidi.disable()` on cleanup** — it's an async,
    singleton-wide teardown (destroys inputs, nulls the interface, strips
    *all* WebMidi listeners) that can race a concurrent `enable()` from a
    remount (e.g. Vite Fast Refresh touching this hook or `App.tsx`),
    leaving WebMidi listener-less with no error until a full page reload.
    Cleanup only detaches the listeners this hook itself added.
  - Returns a `WebMidiStatus` (`supported`/`enabled`/`error`/`inputNames`) so
    `App.tsx` can show connection state — Web MIDI is Chrome/Edge only, so
    surfacing "not supported" beats a silent no-op.
  - `PortEvent.port` is typed `any` in webmidi's own `.d.ts` (an acknowledged
    upstream gap, see its "issue #229" comment) — the `e.port?.type` check in
    the connected/disconnected handlers is unchecked at compile time; verified
    correct at runtime against the installed `webmidi@3.1.16` behavior during
    review, not just assumed from the types.

## Design principles to preserve

- One shared clock: never let a second, independent time source creep in for
  the roll/playhead/loop — everything derives from `player.ts`'s
  song-time ↔ transport-time conversion.
- One input bus: new input sources (Web MIDI) must publish to
  `noteInput.ts`, not bypass it and talk directly to consumers.
- Canvas for anything with a per-frame redraw (piano-roll); SVG is fine for
  the mostly-static keyboard.
- Any input source that can be attached/detached at runtime (Web MIDI
  devices; anything similar added later) must force-release its held notes
  on detach, the same way `noteInput.ts`'s hold-count model expects — a
  disappearing input must never leave a phantom hold behind.
