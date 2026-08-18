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
- **Multitrack practice (upcoming)**: up to 3 tracks can be layered into
  simultaneous piano-roll lanes, not just one selected track at a time. One
  lane is always the *focus* (drives the readout/wait-mode/expected-note
  logic); the others play alongside it for context. See "Next initiative"
  below.
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
  keyboard, and Web MIDI all publish to it; the "pressed notes" set,
  key-name readout, and wait-for-key mode subscribe to it. Pressed notes also
  trigger the synth so silent practice input is audible.
- **Mouse input on the SVG keyboard**: `PianoKeyboard` gains pointer handlers
  per key rect — `pointerdown` = note-on, `pointerup`/`pointercancel` =
  note-off, with pointer capture; moving across keys while held (glissando)
  releases the previous key and presses the new one.
- **Computer-keyboard input**: two selectable layouts, both listening on
  `keydown`/`keyup` via `e.code` (layout-independent), ignoring `e.repeat` and
  events targeting form controls. Mapping lives in
  `src/lib/keyboardMapping.ts`.
  - **DAW-style** (default): one base octave across a two-row mapping
    (`A W S E D F T G Y H U J K` = C, C#, D, D#, E, F, F#, G, G#, A, A#, B,
    C), `Z`/`X` shift the single octave down/up.
  - **Two-hand**: left hand (`A W S E D F T G Y`) plays C–G# at the base
    octave; right hand (`H J I K O L ; [ ' ]` = B, C, C#, D, D#, E, F, F#, G,
    G#) plays B–G# starting a fifth higher, one octave up from the left
    hand's C. Each hand's octave shifts independently — `Z`/`X` for the left
    hand, `M`/`,` for the right — so a part spanning a wide range can be
    split across both hands at whatever octaves fit it.
- **Key-name readout**: a small component (`src/components/NoteReadout.tsx`)
  showing the names of currently pressed notes and, in wait-for-key mode, the
  expected note(s) — e.g., "Expected: F#4 · A4  |  Pressed: F#4". Note names
  derived from MIDI numbers via a shared `midiToNoteName()` util (or
  `Tone.Frequency(midi, 'midi').toNote()`).
- **Wait-for-key mode**: a third `PlaybackMode` (`'wait'`). The full track's
  notes are grouped once into onset "steps" (notes whose start times fall
  within a small epsilon form a chord step) via
  [src/lib/steps.ts](src/lib/steps.ts), filtered to the selected region (if
  any). Rather than driving `Tone.Part`'s look-ahead scheduler — which can't
  pause indefinitely mid-step — the Transport never runs in this mode; a
  manual stepper in `player.ts` seeks the transport to each step's time and
  waits. A step advances once every one of its pitches has been struck as a
  *fresh* `noteon` event on the note-input bus (accumulated via raw
  `subscribe`, not a snapshot of currently-held notes), so a pitch held over
  from the previous step can't auto-satisfy a repeat, and single-pointer
  mouse input can still "hold" a chord by striking its notes one at a time.
  Wrong notes don't affect step progress (no penalty/reset) but do fire a
  brief red flash via `onNoteFeedback` (see M7 below); correct notes flash
  green the same way. A region loops back to its first step; with no
  region, the session stops at the end of the track. Works identically for
  mouse, typing-keyboard, and (later) MIDI input, by construction of the
  note-input bus.
- **Web MIDI input**: [src/hooks/useWebMidiInput.ts](src/hooks/useWebMidiInput.ts)
  calls `WebMidi.enable()` and attaches `noteon`/`noteoff` listeners to every
  connected `Input`, publishing into the same note-input bus with
  `source: 'midi'`; inputs are (re)attached as devices connect/disconnect via
  WebMidi's own `connected`/`disconnected` events. Each input tracks its own
  held-note counts so a disconnect (or the hook unmounting) mid-press forces
  matching note-offs instead of leaving a key stuck lit — same per-source
  hold-count discipline as `noteInput.ts` itself. The hook never calls
  `WebMidi.disable()` on cleanup (it's a singleton-wide async teardown that
  can race a concurrent re-enable, e.g. under Fast Refresh); it only detaches
  its own listeners. Chrome/Edge only; Safari/Firefox support is inconsistent.
- **Sampled piano**: [src/lib/instrument.ts](src/lib/instrument.ts) owns a
  singleton `Tone.Sampler` (Salamander Grand Piano, 30 mp3s bundled locally
  under `public/samples/salamander/` for offline use; attribution in
  README.md) replacing the earlier `Tone.PolySynth`. `player.ts`'s
  `attack()`/`play()` await the sampler's load promise (extending the
  existing `Tone.start()` gating/`pendingAttacks` ordering) before sounding
  anything; `App.tsx` disables Play and shows "Loading piano…" (or a load
  error) until then.
- **Correct/incorrect press feedback**: wait-mode's per-step listener in
  `player.ts` calls a new `onNoteFeedback(midi, 'correct' | 'incorrect')`
  callback for every `noteon`, in addition to its existing (unchanged)
  satisfaction logic. `App.tsx` tracks a `feedbackNotes` map that auto-clears
  each entry after ~400ms (a timed flash, not "red while held") and clears
  entirely when leaving wait mode. `PianoKeyboard` and `NoteReadout` render
  it as a green/red highlight, input-source-agnostic by construction since
  it's driven by the same note-input-bus listener as step advancement.
- **Staff notation (deferred)**: `VexFlow`, driven from the same note array,
  with a scrolling/highlighted playhead.

## Next initiative: multitrack + visual redesign

A full visual redesign was produced separately (in Claude Desktop/design
mode) and handed off under
[design/design_handoff_piano_tutor/](design/design_handoff_piano_tutor/) —
see its `README.md` for the complete spec (layout, interaction rules, design
tokens) and `Piano Tutor.dc.html` for a live, high-fidelity HTML reference to
open in a browser. It is a reference to recreate with this codebase's own
patterns, not code to copy in directly.

The redesign's central feature is **multitrack practice**: up to 3 tracks
layered into simultaneous piano-roll lanes (plain-click a track chip to
toggle it into/out of the lanes, ⌘/Ctrl-click to focus it), one lane always
focused for the readout/wait-mode logic, each lane auto-zoomed to its own
pitch range, lanes always stacked in MIDI track order (never selection
order), and
the on-screen keyboard spanning the union of the selected tracks' ranges.
This means the redesign and "add multitrack support" are not two independent
efforts — the chip bar's selection rules, per-lane rendering, and shared
keyboard range *are* the multitrack feature; the rest of the spec (toolbar,
tokens, readout layout) is visual treatment around it.

**Decision: build the underlying multitrack mechanics first (M8), then
apply the visual redesign on top (M9).** Reasoning: the chip-selection logic
(toggle lanes on/off, max 3, ⌘/Ctrl-click to focus), multi-lane piano-roll
rendering, per-lane pitch ranges, and union keyboard range are data-model and
component-architecture work, not styling — building the new chip/lane visuals
against the current single-track selection model would mean reworking that
same logic again once real multitrack state exists underneath it. M8 extends
the existing single-selected-track UI to support layered tracks functionally
(current visual style, ugly is fine); M9 then re-skins the whole app to match
the handoff exactly, which is comparatively mechanical once the underlying
lanes/state already work.

### Resolved design questions (override/extend the handoff)

The handoff intentionally left some product decisions unspecified (it's a
visual/interaction prototype with fake data, not a full spec). Resolved as
follows — these take precedence over anything the handoff implies otherwise:

0. **Keyboard sizing** — don't stretch key width to fill the available width
   as the visible range shrinks (as seen in
   `design/design_handoff_piano_tutor/states/02-solo-bass.png`, where the
   bass-only range renders unusually fat keys). Key width stays constant
   across lane-count/range states, matching the width shown in the other
   reference screenshots; a narrower selected range makes for a narrower
   keyboard, not fatter keys.
1. **Wait mode with multiple lanes** — only the focused lane's transport/step
   logic drives wait-mode pausing. The other layered lanes freeze (stop
   advancing/sounding) while wait-mode holds, rather than continuing to play.
2. **Empty state (no file loaded)** — the roll area's center is empty (blank
   or lightly grayed placeholder) with a large, centered "Load file" button
   inside it; the on-screen keyboard stays visible and playable underneath.
3. **MIDI pill is status-only** — no device-selection affordance. It's
   read-only: a green dot + device name when a MIDI input is connected, a
   dim/dark dot + "MIDI not connected" (or similar) otherwise.
4. **Track chip bar** — drop the right-aligned hint text ("click to focus ·
   ⌘-click to add a second roll · drag chips to reorder lanes"); when there
   are more chips than fit, the chip bar scrolls horizontally instead.
5. **Theme** — dark stays the default per the handoff, but light mode (as
   the current app already supports via `prefers-color-scheme`) is kept, not
   dropped. Light-mode token values were initially best-guessed by mirroring
   the dark palette's relationships (invert background/text lightness, keep
   chroma/hue relationships) rather than designed from scratch — **revisited
   2026-08-15** via a real Claude Design pass
   ([design/light-mode-colors.md](design/light-mode-colors.md)), which found
   the guess read as washed out (the roll became a mid-gray slab and the
   fixed-lightness track hues didn't move with it, nearly erasing the amber
   track) and replaced it with a reviewed palette — the roll is now the
   lightest "paper" surface with theme-aware, darker/more-chromatic track
   hues. The app also gained a manual Auto/Light/Dark toggle (persisted to
   `localStorage`) so a user's choice can override the OS scheme instead of
   just mirroring it. See `memory-bank/activeContext.md` for the full
   implementation detail.

## Milestones

- [x] **M1** — Parse & play: upload a MIDI file, list tracks, select one,
  play it back with a basic synth, tempo slider, lit keyboard synced to
  playback.
- [x] **M2** — Piano-roll + region practice: Canvas piano-roll of the selected
  track with a synced playhead; drag-select a time region; play/loop just that
  region via Transport loop points; extract playback into `src/lib/player.ts`.
- [x] **M3** — Hardware-free input: clickable on-screen keyboard (pointer
  events) and computer-keyboard mapping with octave shift, both feeding a
  shared note-input bus, sounding the synth, lighting pressed keys, and shown
  in a text note-name readout.
- [x] **M4** — Wait-for-key mode: pause at each note/chord until the correct
  key(s) are pressed via mouse or typing keyboard, then advance; honors the
  selected region (including looping it); readout shows expected vs. pressed
  note names.
- [x] **M5** — Web MIDI input: detect a connected keyboard, publish its
  note-on/off into the same input bus so everything (readout, lit keys,
  wait-for-key) works with real hardware unchanged.
- [ ] **M6** — Staff notation view (VexFlow) synced to the same note data and
  playhead. Deferred indefinitely — M7 was done first, and M8/M9 (multitrack
  + redesign, below) now take priority over picking it back up.
- [x] **M7** — Polish: better piano sound (sampled piano instead of basic
  synth), visual feedback for correct/incorrect presses, UI cleanup.
- [x] **M8** — Multitrack mechanics: extend track selection to support
  layering up to 3 tracks into simultaneous piano-roll lanes (click to
  toggle a lane on/off, ⌘/Ctrl-click to focus, one lane always focused),
  lanes stacked in MIDI track order, each lane scaled to its own pitch
  range, a shared loop region/playhead across lanes,
  and the on-screen keyboard spanning the union of the selected tracks'
  ranges. Non-focused lanes freeze (stop advancing/sounding) while
  wait-mode holds on the focused lane. Functional first; current visual
  style is fine.
- [x] **M9** — Visual redesign: applied
  [design/design_handoff_piano_tutor/](design/design_handoff_piano_tutor/) —
  toolbar, track chips, lane styling, keyboard/readout treatment, design
  tokens — on top of the M8 multitrack mechanics, per the "Resolved design
  questions" above (constant key width, empty-state placeholder + load
  button, status-only MIDI pill, scrolling chip bar with no hint text, and
  keeping light mode alongside the new dark default). Built in ten reviewed
  steps (foundations/tokens through cleanup); light mode was verified
  end-to-end with a headless pass rather than left as an unchecked guess, and
  read fine as-is with no token changes needed. Accepted deviations from the
  handoff: no expected-note ring in Practice mode, keybed doesn't stretch for
  narrow ranges, no metronome/chip-hint-text/chip-drag-reorder, a
  seconds-based grid instead of bars/beats, and (post-M9) equal-height
  piano-roll lanes instead of a 1.7x-weighted focused lane — focus is
  conveyed through color/opacity/border instead of extra size. Also
  post-M9 (2026-08-15): light mode got a real Claude Design pass fixing the
  washed-out roll/track-contrast issue in the original best-guess palette
  (see decision #5 above), and the app gained a manual Auto/Light/Dark
  theme toggle, persisted to `localStorage`, so light mode is no longer
  purely OS-mirrored.

## Known limitations

- No persistence — reloading the page loses the loaded file, track selection,
  and (once built) the selected practice region.
- Computer-keyboard input is limited by hardware key rollover (some key
  combinations won't register simultaneously on many laptop keyboards), so
  large chords may need the mouse or, later, a MIDI keyboard.
