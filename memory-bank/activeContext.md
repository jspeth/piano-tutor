# Active Context

## Current work focus

M1–M4 are complete (parse & play, piano-roll + region practice,
hardware-free input, wait-for-key mode). No milestone work is actively in
progress right now — **M5 (Web MIDI input) is next up** and hasn't been
started.

## Recent changes (most recent first)

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

- Start M5: Web MIDI input via `WebMidi.js` (already installed, unused) —
  detect a connected keyboard and publish its note-on/off into the same
  `noteInput.ts` bus so the readout, lit keys, and wait-for-key mode all
  work unchanged with real hardware.
- After M5: M6 (VexFlow staff notation), M7 (polish: sampled piano, wrong/
  right visual feedback, UI cleanup).

## Active decisions / considerations

- No new architectural decisions pending for M5 — Web MIDI input is meant
  to be a third publisher into the existing `noteInput.ts` bus, same shape
  as mouse/keyboard, so consumers (readout, lit keys, wait-for-key stepper)
  shouldn't need changes.
