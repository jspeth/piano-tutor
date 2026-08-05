# Active Context

## Current work focus

M1–M5 are complete (parse & play, piano-roll + region practice,
hardware-free input, wait-for-key mode, Web MIDI input). No milestone work is
actively in progress right now — **M6 (VexFlow staff notation) is next up**
and hasn't been started.

## Recent changes (most recent first)

- `feat: add Web MIDI input` (M5) — new
  [src/hooks/useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts) enables
  `WebMidi.js`, attaches `noteon`/`noteoff` listeners to every connected
  `Input` (re-attaching as devices connect/disconnect via WebMidi's own
  events), and publishes into the existing `noteInput.ts` bus with
  `source: 'midi'` — no changes needed to any consumer (readout, lit keys,
  wait-for-key). Each input tracks its own held-note counts so a disconnect
  or unmount mid-press force-releases them, avoiding a stuck-lit key. A
  review pass caught two bugs before landing: missing held-note tracking
  (the stuck-key leak just described), and an unmount cleanup that called
  `WebMidi.disable()` — an async, singleton-wide teardown that can race a
  concurrent re-enable (e.g. Fast Refresh) and leave WebMidi listener-less
  until a full reload; cleanup now only detaches its own listeners. `App.tsx`
  shows a status line (supported/enabled/connected device names/error). See
  [systemPatterns.md](systemPatterns.md) for the full design.
- `feat: add wait-for-key mode` (M4) — third `'wait'` `PlaybackMode`; a
  manual stepper in `player.ts` (no `Tone.Part`) seeks the transport through
  onset "steps" (new [src/lib/steps.ts](../src/lib/steps.ts)), advancing
  each step only on a fresh `noteon` accumulated via the note-input bus's
  raw `subscribe` (not a pressed-set snapshot, so mouse-only chords and
  repeated pitches both work correctly). Honors region looping;
  `NoteReadout` now shows Expected and Pressed simultaneously. See
  [systemPatterns.md](systemPatterns.md) for the full design and the bugs
  a review pass caught (step-boundary float tolerance in
  `findStepIndexAtOrAfter`, stuck-lit keys when entering wait mode
  mid-playback, a latent double-subscribe leak guard).
- `docs: add memory bank rule` — added the Memory Bank workflow to
  CLAUDE.md (this memory bank is the result).
- `fix: crash when key gave NaN` — guarded against a NaN MIDI key value.
- `fix: same note blinks the key` — fixed a visual glitch where repeating
  the same note caused a spurious blink instead of a clean re-light.
- `feat: add listen/practice modes, spacebar toggles play/pause, tap to seek`
  — added a mode toggle (listen vs. practice), spacebar transport control,
  and click-to-seek on the piano-roll.
- `feat: add hardware free input` (M3) — mouse + computer-keyboard input via
  the shared note-input bus.

## Next steps

- Start M6: VexFlow staff notation view, synced to the same note data and
  playhead as the piano-roll.
- After M6: M7 (polish: sampled piano, wrong/right visual feedback, UI
  cleanup).
- M5 was never manually verified against real MIDI hardware (no device
  available in the dev/review environment) — worth a real-keyboard smoke
  test (connect, play notes, unplug mid-press) before considering it fully
  proven out.

## Active decisions / considerations

- No new architectural decisions pending for M6 yet.
