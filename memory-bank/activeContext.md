# Active Context

## Current work focus

M1–M3 are complete (parse & play, piano-roll + region practice,
hardware-free input). Recent commits layered listen/practice modes,
spacebar play/pause, and tap-to-seek on top of M3, plus two bugfixes
(same-note key-blink glitch, a NaN crash on key press). No milestone work
is actively in progress right now — **M4 (wait-for-key mode) is next up**
and hasn't been started.

## Recent changes (most recent first)

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

- Start M4: wait-for-key mode. Per PLAN.md, this means grouping the selected
  track's notes into onset "steps" (notes within a small time epsilon form a
  chord step), pausing the Transport at each step until the note-input bus
  reports all pitches of that step pressed, then advancing. Must honor the
  selected region (including looping it), and the readout should show
  expected vs. pressed note names.
- After M4: M5 (Web MIDI input via `webmidi`, already installed but unused)
  and M6 (VexFlow staff notation).

## Active decisions / considerations

- No new architectural decisions pending — the note-input bus and
  player.ts clock abstractions (see [systemPatterns.md](systemPatterns.md))
  are expected to support M4 without redesign, since wait-for-key mode was
  designed into the input-bus pattern from the start.
