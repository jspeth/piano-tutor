# Active Context

## Current work focus

M1–M5 and M7 are complete (parse & play, piano-roll + region practice,
hardware-free input, wait-for-key mode, Web MIDI input, and — per an explicit
decision to skip M6 for now — the M7 "Polish" milestone: sampled piano,
correct/incorrect press feedback, UI cleanup). **M6 (VexFlow staff notation)
is deliberately skipped for now** and hasn't been started; it's the only
milestone left in PLAN.md.

## Recent changes (most recent first)

- `feat: M7 polish` (M7, all three parts) — implemented as three sequential,
  independently reviewed changes, then a fourth pass fixing issues a
  cross-part review caught:
  - **Part A — sampled piano**: new
    [src/lib/instrument.ts](../src/lib/instrument.ts) owns a singleton
    `Tone.Sampler` built from the Salamander Grand Piano sample set (30
    mp3s, minor-third spacing), bundled locally under
    `public/samples/salamander/` (decided: bundled, not CDN, for offline
    use). Replaces the `Tone.PolySynth` that used to live directly in
    `player.ts` — all 4 call sites now go through `getInstrument()`.
    `player.ts`'s `attack()`/`play()` await
    `Promise.all([Tone.start(), whenInstrumentLoaded()])`, extending the
    existing `pendingAttacks` map rather than adding a second ordering
    mechanism. `App.tsx` disables Play and shows "Loading piano…" until
    loaded — no PolySynth fallback/hot-swap, by design.
  - **Part B — correct/incorrect press feedback**: wait-mode's per-step
    listener in `player.ts` now also calls a new
    `onNoteFeedback(midi, 'correct' | 'incorrect')` callback for every
    `noteon`, without changing the existing (no penalty/reset)
    satisfaction logic. `App.tsx` tracks a `feedbackNotes` map with a
    ~400ms per-midi auto-clear timer (a timed flash, not "red while
    held"), cleared entirely when leaving wait mode. `PianoKeyboard` and
    `NoteReadout` render green/red highlighting — input-source-agnostic by
    construction, since it's the same per-step listener that drives step
    advancement.
  - **Part C — UI cleanup**: removed dead Vite-template CSS from
    `index.css` (`--code-bg`, `--social-bg`, `.counter`, etc.), dropped
    `#root`'s forced center-alignment/fixed width, shrunk the oversized
    `h1`, fixed the mode-toggle's hardcoded (light-mode-invisible) border
    color to use `var(--border)`/`var(--accent)`, added `flex-wrap` to the
    controls row, gave buttons/file-input/track-list consistent styling
    instead of browser defaults, and merged the octave/MIDI status lines
    into one row.
  - **Cross-part review fixes** (caught by a review pass over the combined
    diff, after each part had already been reviewed individually): the
    spacebar play shortcut now respects the same `instrumentLoaded` gate as
    the Play button (previously it could queue a `play()` that fired
    seconds later, with no UI feedback while loading); `instrument.ts`'s
    load error is now read at mount (not just subscribed going forward) and
    surfaced in its own state instead of the shared MIDI-parse `error`
    state (which a file upload would otherwise silently wipe); `.key.correct`
    now adds a white stroke outline, since its fill alone was nearly
    indistinguishable from the wait-mode `.key.active` green on exactly the
    keys where it mattered; the hidden file `<input>` is now
    visually-hidden-but-focusable (was `display: none`, unreachable by
    keyboard) with `:focus-within` styling on its label.
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

- M6 (VexFlow staff notation) is the only milestone left, but it's
  deliberately not started yet — no active plan for when to pick it up.
- M5 was never manually verified against real MIDI hardware (no device
  available in the dev/review environment) — worth a real-keyboard smoke
  test (connect, play notes, unplug mid-press) before considering it fully
  proven out.
- M7 (sampled piano + feedback + UI cleanup) was implemented and
  typecheck/build/lint verified throughout, but never smoke-tested in a
  real browser (audio and visual flash timing can't be verified
  headlessly) — worth a manual pass to confirm samples load/sound correct,
  the correct/incorrect flash reads clearly at a glance, and the UI cleanup
  looks right in both light and dark color schemes before considering it
  fully proven out.

## Active decisions / considerations

- M6 is intentionally deferred with no committed timeline; M7 was pulled
  forward ahead of it by explicit user request.
