# Active Context

## Current work focus

M1–M5, M7, and now M8 are complete (parse & play, piano-roll + region
practice, hardware-free input, wait-for-key mode, Web MIDI input, M7
"Polish", and M8 multitrack mechanics — see the M8 entry under "Recent
changes" for the full implementation summary). **M6 (VexFlow staff
notation) remains deferred indefinitely**, now deprioritized behind **M9
(visual redesign)**, which is next up.

A full high-fidelity redesign was produced separately (Claude Desktop design
mode) and dropped into
[design/design_handoff_piano_tutor/](../design/design_handoff_piano_tutor/)
— see its `README.md` for the full spec and `Piano Tutor.dc.html` for a live
HTML reference. Its central feature is multitrack practice: up to 3 tracks
layered into simultaneous piano-roll lanes via track-chip
solo/⌘-click-to-add selection, one lane always focused, each lane
auto-zoomed to its own pitch range, and the on-screen keyboard spanning the
union of the selected tracks' ranges. Because the chip-selection rules and
multi-lane rendering are the multitrack feature (not just visual treatment),
the plan is **mechanics before skin**: M8 extends the current
single-selected-track model to support layered tracks functionally, using
today's plain visual style; M9 then re-skins the whole app to match the
handoff's tokens/layout exactly on top of that already-working state. Doing
the redesign's chip/lane UI first, before the underlying multi-lane state
exists, would mean rebuilding that same selection/rendering logic twice. See
[PLAN.md](../PLAN.md)'s "Next initiative" section for the full reasoning.

Neither M8 nor M9 has been started yet — this is a planning update only, no
code changes.

## Recent changes (most recent first)

- `feat: multitrack mechanics` (M8) — extends the single-selected-track
  model to layer up to 3 tracks into simultaneous piano-roll lanes, using
  today's plain visual style (M9 will restyle on top of this). Implemented
  per a design pass that resolved three open questions: loop region/scroll
  position persist across lane add/remove/focus changes within one loaded
  file (reset only on a new file load); changing focus during an active
  wait-mode session keeps it running, jumping to the new focus lane's
  nearest step; adding/removing a lane during active listen/practice
  playback stops it (full rebuild, same as today's single-track switch),
  but an active *wait-mode* session survives lane add/remove — that
  distinction (missed in an early draft that stopped every lane-set change
  unconditionally, breaking the focus-change-mid-session contract) was
  caught by testing decision 2 and 3 together, not deducible from either
  decision read in isolation.
  - New [src/lib/laneSelection.ts](../src/lib/laneSelection.ts): a small
    reducer (`laneSelectionReducer`) driving the track-chip selection
    rules — plain click solos a lane (collapses to just that one); ⌘/Ctrl/
    Shift-click toggles a lane in/out of an ordered `lanes: number[]` (max
    3, drops the oldest when a 4th is added) with one `focus` index always
    a member. Also hosts `noteRangeFor()`, extracted unchanged from the old
    single-track keyboard-range logic in `App.tsx`.
  - [src/lib/player.ts](../src/lib/player.ts): `setNotes(notes)` replaced
    with `setLanes(lanes: PlayerLane[], focusTrackIndex)`. Diffs whether
    the *lane set* changed (trackIndex sequence or notes-array identity)
    vs. only *focus* changing. An actively-running wait session (mid-hold)
    is never stopped by a lane-set change — it merges the new notes/steps
    in place and jumps to the nearest step for the new focus lane, mirroring
    `setRegion`'s existing wait-branch; only listen/practice playback (or a
    paused/inactive wait mode) gets the old full `stop()`+rebuild treatment.
    Non-focus-lane freezing during a wait-mode hold needed no new code: the
    Transport never `.start()`s in wait mode, so every lane's scheduled
    `Tone.Part` callbacks structurally never fire while a step is held,
    regardless of how many lanes are merged into the flat `this.notes`.
  - [src/components/PianoRoll.tsx](../src/components/PianoRoll.tsx)
    reworked from one canvas to N stacked canvases in one shared scroll
    container (`lanes: RollLane[]` prop, one entry per selected track, each
    with its own `lowNote`/`highNote`), so region-drag/seek/hover-to-sound
    work starting from any lane while x-axis state (`PX_PER_SEC`,
    scrollLeft, region, playhead) stays shared across all of them. A
    `.focused` CSS class + small corner label mark the focus lane
    (unstyled beyond that, per M9 deferring visual treatment). The old
    notes-keyed scroll-reset effect was deleted; `App.tsx` now passes a
    `fileGeneration` counter as `PianoRoll`'s `key`, so the component (and
    its scroll position) only resets on an actual new file load, not on
    every lane toggle.
  - [src/App.tsx](../src/App.tsx): `selectedTrackIndex` state replaced with
    `useReducer(selectionReducer, ...)` holding `LaneSelection | null`
    (`selectionReducer` wraps `laneSelectionReducer` to tolerate the `null`
    "no file loaded" state and a local-only `clear` action for parse
    errors). The old track `<select>` dropdown is now a row of chip
    buttons (`.track-chips`) with three visually distinct states (focused/
    selected-but-not-focused/unselected), dispatching `solo` on a plain
    click and `toggle` on ⌘/Ctrl/Shift-click. Region reset now only happens
    in `handleFileChange` (previously reset on every track-selection
    change) — the confirmed persistence behavior. Keyboard range is now the
    union of all selected lanes' ranges (was: the one selected track's).
  - Verified with `npm run build` (tsc + vite) and `npm run lint` (oxlint),
    both clean, plus an actual headless-browser pass (`playwright-core`
    against the real dev server, a synthesized 4-track `.mid` fixture built
    with the `midi-file` package already in `node_modules`) exercising:
    solo-click through lanes; ⌘/Ctrl/Shift-click add up to 3 lanes and
    correctly drop the oldest on a 4th; removing the currently-focused lane
    reassigns focus to the new first lane; removing the last remaining lane
    is a no-op; region drag started from a non-focused lane's canvas
    commits correctly; region persists across a lane add/remove; wait mode
    stays running (readout updates to the new focus lane's expected note)
    when focus changes mid-session via adding a new lane, but correctly
    pauses if the new focus lane has zero steps inside the current region
    (mirrors `setRegion`'s empty-steps handling); listen-mode playback
    stops when a lane is added mid-playback; tempo change with 3 lanes
    active causes no errors. Zero console errors across all of the above
    (ignoring the expected pre-gesture `AudioContext` autoplay-policy
    warnings Tone.js logs before the first user-gesture-triggered
    `Tone.start()`).
  - A `reviewer` pass over this diff (before considering it done) caught
    three real bugs, all fixed and re-verified: (1) `setLanes`'s
    wait-session-survives branch updated `this.notes`/`this.songEnd` but
    never disposed a pre-existing `Tone.Part` left over from listen/practice
    playback before switching to wait mode — a later switch back to listen
    mode would silently rebuild-skip and play the *stale* lane set; fixed by
    disposing the part and clearing the transport's scheduled events when
    the lane set changes during an active wait session. (2)
    `handleFileChange` never called `player.stop()`, so loading a *new*
    file while a wait session was active incorrectly hit the "keep the
    session running" path (scoped to changes within the same file, not
    across a file swap) and briefly relit a stale step against the old
    song; fixed by stopping the player at the top of `handleFileChange`
    before parsing. (3) the lane-label CSS (`position: sticky`, in normal
    flow) was pushing every lane's canvas down by the label's own height,
    misaligning the `.focused` outline and overflowing the last lane out of
    `.piano-roll-track` — switched to `position: absolute` (matching the
    original plan, which called for absolute, not sticky) and confirmed via
    a geometry check (`getBoundingClientRect()` on lane vs. canvas, and the
    scroller's `scrollHeight`/`clientHeight`) that lane and canvas now align
    exactly with no spurious overflow.
- `feat: tighten up UI layout (no-scroll shell, compact header, big centered
  readout, constant-width Play/Pause)` — a user-requested visual pass over
  `App.tsx`/`App.css`/`NoteReadout.tsx`, not tied to a PLAN.md milestone:
  - **No-scroll shell**: `.app` is now a `height: 100dvh` flex column with
    `overflow: hidden`; header/controls/keyboard-panel are fixed-height
    (`flex: 0 0 auto`) and `.piano-roll-panel` is `flex: 0 1 auto` — sized to
    its content by default (so a short note range doesn't get force-stretched
    into a tall panel with dead space below the notes — the first version of
    this got that wrong, fixed after user feedback) but able to *shrink*
    (`min-height: 0`, inner `.piano-roll` keeps `overflow: auto`) when the
    combined content would overflow the viewport, so a wide-range track
    scrolls internally instead of growing the page. Verified both directions
    with headless-Chrome screenshots (`playwright-core` against the real dev
    server) using synthesized narrow-range and full 88-key-range `.mid`
    fixtures, checking `document.documentElement.scrollHeight` against
    `window.innerHeight` plus the roll's own `clientHeight`/`scrollHeight`.
  - **Compact header**: title and "Load MIDI file" collapsed into one
    `<header>` row instead of an `<h1>` plus a separate panel section.
  - **Parts control**: the old radio-list "Parts" section (its own panel,
    one `<li>` per track) is now a `<select>` folded into the controls row
    (`.parts-select`, `margin-left: auto`) — both more compact and moved
    lower in visual order per the request to de-emphasize it now that it's
    a rarely-changed-after-load control.
  - **On-screen keyboard scroll isolation**: `PianoKeyboard` now sits alone
    in `.keyboard-scroll` (`overflow-x: auto`), separate from
    `NoteReadout`/the DAW-Two-Hand toggle/status line below it, so dragging
    a wide keyboard into view never drags the controls with it.
  - **Big centered note readout**: `NoteReadout.tsx` restructured to always
    render a small label line plus a large (34px) centered value line,
    instead of conditionally rendering only in wait mode — in listen/practice
    mode the label now reads `Playing: <activeNotes>` (a new required
    `activeNotes` prop, passed from `App.tsx`'s existing playback state) and
    the big value is the pressed note(s); in wait mode it's unchanged
    (`Expected: ...` label, pressed notes colored correct/incorrect). This
    was itself a follow-up fix — the request was "always show the label",
    and always rendering both lines regardless of mode was the only way to
    stop the readout's height (and everything below it) from jumping when
    switching modes.
  - **Constant-width Play/Pause**: `.play-pause { width: 72px }` so the
    button doesn't resize when its label toggles between "Play"/"Pause".
  - Typecheck-clean throughout; also smoke-tested end-to-end in a real
    browser (not just typecheck), including this being the project's first
    time reaching for a *persistent* test tool — `playwright-core` was
    added as a devDependency (driving the system's installed Google Chrome
    via `executablePath`, no bundled Chromium download) specifically so
    future UI verification passes don't need reinstalling, per explicit user
    request.
- `feat: hover piano-roll note bars for key name, tap to play` —
  [PianoRoll.tsx](../src/components/PianoRoll.tsx) now hit-tests pointer
  position against the notes on that pitch row (grouped into a `notesByMidi`
  map, built once per `notes` change, so hit-testing only scans one row
  instead of the whole song). Hovering a note bar shows a small fixed-position
  tooltip (`midiToNoteName`) and switches the cursor to `pointer`; pressing
  and holding one publishes `noteon`/`noteoff` on
  [noteInput.ts](../src/lib/noteInput.ts) with `source: 'mouse'` — the exact
  same bus `PianoKeyboard` publishes to — so it sounds through the normal
  `App.tsx` → `player.attack`/`release` path and lights the on-screen keyboard
  key for free, no new wiring needed. This is a second UI surface proving out
  the "one input bus" design principle (see
  [systemPatterns.md](systemPatterns.md)). Region-edge dragging still takes
  priority over a note hit at the same x (edge hit-testing has always ignored
  y/row, since region edges span the full height); tapping/dragging on blank
  space is unchanged (seek / region-select). Verified end-to-end with a
  headless Playwright script driving the real dev server against a
  synthesized 3-note test `.mid` (not just typecheck/build/lint): tooltip
  text, cursor style, on-screen key lighting while held, tap-to-seek (via
  reading the playhead pixel back out of the canvas), and drag-to-region all
  confirmed working, zero console errors. First feature in this project
  smoke-tested in an actual browser via automation rather than manually or
  left unverified — worth reaching for again instead of a manual-pass caveat.
- `fix: ignore stray MIDI noteon right after device connect` — user reported
  that plugging in one specific MIDI keyboard (not their other one) always
  produced a stuck-lit key at a different, random note each time. Root cause:
  that keyboard's firmware sends a bogus `noteon` as USB enumeration
  finishes, arriving as a genuine well-formed MIDI message the app's
  event-based parsing (delegated to `webmidi`, no raw-byte handling of its
  own) had no way to tell apart from a real key press — likely stale
  running-status state left over from the device's own init. Fixed in
  [useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts): `attachInput` now
  records an attach timestamp and drops any `noteon` arriving within 250ms of
  it. Confirmed fixed by the user against the real hardware that triggered
  it — see [systemPatterns.md](systemPatterns.md) for detail.
- `perf: size PianoRoll's canvas to the viewport, not the song` — Chrome-only
  (not Safari) slowdown reported right after loading a MIDI file: audio
  stayed on time (Web Audio's clock doesn't depend on the main thread) while
  key-lighting and the playhead lagged and dropped frames, because the main
  thread was saturated. Root cause, found by profiling in Chrome DevTools
  (Performance panel, Bottom-up tab): [PianoRoll.tsx](../src/components/PianoRoll.tsx)'s
  `<canvas>` was sized to the *entire song* (so the browser could natively
  scroll it) — tens of thousands of backing px wide for a multi-minute song
  at retina resolution. Chrome denies GPU acceleration to 2D canvases past
  some size threshold, so **every** 2D op on it — even copying a couple of
  cached pixels — paid a large software-raster tax; an intermediate fix that
  cached the static layer and only touched a small strip per frame still
  cost ~0.6ms/call (confirmed via Bottom-up self-time, not just guessed) and
  didn't fully fix it, because the *source* canvas for the cache was equally
  huge. Real fix: canvas is now sized to just the scroll container's
  viewport (`ResizeObserver`-tracked `viewportWidth`) and kept in view via
  `position: sticky` inside a plain `.piano-roll-track` div whose width
  carries the full-song scrollable range (cheap — divs don't have a
  canvas-style backing-store size ceiling); each frame redraws only the
  currently-visible slice (gridlines/notes filtered to
  `[scrollLeft, scrollLeft + canvasWidth]`), so per-frame cost no longer
  scales with song length at all, and the `MAX_BACKING_PX` capping/caching
  machinery from the intermediate attempt was removed as unnecessary.
  Pointer math (`timeAtEvent`/`edgeAtEvent`) now adds `scrollLeft` back in
  since canvas-local coordinates no longer equal song-time coordinates. This
  was an iterative fix guided by the user's own Chrome DevTools Performance
  traces (two rounds of profile → diagnosis → fix). User confirmed smooth
  playback/piano-roll/playhead in Chrome after this round — fixed. Still
  worth a manual pass on region-drag and click-to-seek after scrolling
  partway through a long song, to be sure the scroll-aware pointer math
  didn't regress those (not explicitly re-tested).
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

- The UI layout pass above was verified headlessly against the browser's
  default (light) color scheme only — worth a manual pass in dark mode
  (`prefers-color-scheme: dark` is already handled in `index.css`) to confirm
  the readout/controls/dropdown all still read clearly, since it wasn't
  re-checked there.
- M9 (visual redesign) is up next now that M8 has landed — apply
  [design/design_handoff_piano_tutor/](../design/design_handoff_piano_tutor/)
  (toolbar, track-chip styling, lane styling, keyboard/readout treatment,
  design tokens) on top of the working multitrack mechanics, per PLAN.md's
  "Resolved design questions". M8's mechanics were smoke-tested with a
  synthesized fixture but never eyeballed in a real browser by a human —
  worth a quick manual look (lane stacking, chip states, region drag from a
  non-focused lane) before or during the M9 pass, since M9 will be
  restyling this same DOM. M6 (VexFlow staff notation) stays deferred
  behind M9 with no committed timeline.
- M5 has now had a real-keyboard smoke test (the connect-noise bug above was
  found this way), but only covers connect/unplug behavior across two
  physical keyboards so far — playing notes/chords on real hardware during
  normal use is still unverified.
- M7 (sampled piano + feedback + UI cleanup) was implemented and
  typecheck/build/lint verified throughout, but never smoke-tested in a
  real browser (audio and visual flash timing can't be verified
  headlessly) — worth a manual pass to confirm samples load/sound correct,
  the correct/incorrect flash reads clearly at a glance, and the UI cleanup
  looks right in both light and dark color schemes before considering it
  fully proven out.

## Active decisions / considerations

- M6 is intentionally deferred with no committed timeline; M7 was pulled
  forward ahead of it by explicit user request, and M8/M9 (below) now sit
  ahead of it too.
- 2026-08-14: added M8 (multitrack mechanics) and M9 (visual redesign from
  [design/design_handoff_piano_tutor/](../design/design_handoff_piano_tutor/))
  to PLAN.md, in that order — mechanics before skin, so the chip/lane
  selection logic that's central to both the redesign and the multitrack
  feature only gets built once. See PLAN.md's "Next initiative" section.
- 2026-08-14: resolved the open product questions the handoff deliberately
  left unspecified (full detail in PLAN.md's "Resolved design questions"):
  keyboard key width stays constant across range/lane-count states rather
  than stretching to fill the toolbar (the handoff's own
  `states/02-solo-bass.png` shows the stretched/"fat" look to avoid);
  non-focused lanes freeze during wait-mode holds rather than continuing to
  play; the no-file-loaded empty state is a blank/grayed roll area with a
  big centered "Load file" button over a still-playable keyboard; the MIDI
  pill drops the "click to change device" affordance and is read-only
  status (connected name + green dot, or "MIDI not connected" + dim dot);
  the track-chip bar drops its right-aligned hint text and scrolls
  horizontally instead when chips overflow; and light mode is kept
  alongside the new dark default, with light-mode token values best-guessed
  by mirroring the dark palette's relationships until/unless a real design
  pass is needed.
