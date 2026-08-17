# Active Context

## Current work focus

**M10a — audio pitch input (in progress, steps 1–5 of 10 done).** Started
2026-08-16 for a friend who has a digital keyboard but no MIDI cable: listen
through the built-in laptop microphone and detect played notes so wait-for-key
mode works without hardware. Explicitly framed by the user as a best-effort
nice-to-have — *"do the best we can with built in mic… if you want better, get
a cheap usb cable"* — which makes **legible failure** more important than
detection rate, and makes "buy a USB-MIDI cable" a designed, first-class
outcome the UI points at rather than a buried caveat.

The full plan, all measured tuning results, and an 11-item revisit backlog
live in **[audioPitchInput.md](audioPitchInput.md)** — that file is the source
of truth for this feature; this section is only the orientation summary.

Where it stands: the note-input bus groundwork, the pure detector, the Web
Audio engine, a dev-only lab page, and a tuning pass are done and verified.
Remaining: step 6 (`useAudioInput` hook), step 7 (`AudioPill` + calibration/
monitor UI), step 8 (app wiring + escape hatch), step 9 (docs), step 10
(real-room acceptance). **Nothing is wired into the real app yet** — the
feature is only reachable via the lab page, and the app is unchanged apart
from the bus/sampler groundwork in step 1.

M1–M5, M7, M8, and M9 are all complete (parse & play, piano-roll +
region practice, hardware-free input, wait-for-key mode, Web MIDI input, M7
"Polish", M8 multitrack mechanics, and M9 visual redesign — see the M9 entry
under "Recent changes" for the full implementation summary). **M6 (VexFlow
staff notation) remains deferred indefinitely** with no committed timeline.

M9 applied the high-fidelity redesign handed off in
[design/design_handoff_piano_tutor/](../design/design_handoff_piano_tutor/)
on top of M8's working multitrack mechanics: a five-band non-scrolling
layout (toolbar/chips/roll/keyboard/readout), an oklch design-token system
with a dark default and a light-mode mirror, per-track hue coloring, and
Archivo/IBM Plex Mono typography. See PLAN.md's "Known deviations from the
reference" for the handful of intentionally accepted gaps versus the
handoff screenshots (no expected-note ring in Practice mode, keybed doesn't
stretch to fill width for narrow ranges, no metronome/chip-hint-text/
chip-drag-reorder, and a seconds-based grid/ruler instead of bars/beats,
since MIDI tempo is display-only and never a second time source).

Post-M9, on 2026-08-15: light mode got a real Claude Design pass (fixing a
washed-out roll and near-invisible amber track in the original best-guess
palette) and the app gained a manual Auto/Light/Dark theme toggle persisted
to `localStorage` — see the top two "Recent changes" entries below for the
full detail.

## Recent changes (most recent first)

- **M10a audio pitch input, steps 1–5** (2026-08-16) — see
  [audioPitchInput.md](audioPitchInput.md) for the full plan, measured
  numbers, and revisit backlog. Summary of what changed in the codebase:
  - `noteInput.ts` gained an `'audio'` source and a second derived snapshot,
    **sounding notes** = pressed minus `SILENT_SOURCES` (just `'audio'`), with
    `getSoundingNotes()`/`subscribeSounding()`. `App.tsx`'s sampler-attack
    effect switched from `subscribePressed` to `subscribeSounding`, so audio
    notes light keys and (later) advance wait steps without the sampler
    re-sounding them over the user's real piano. `notifyPressedChange` had to
    be *redesigned* rather than extended: the old code only recomputed on the
    two hold-count boundaries where *pressed* changes, which are not the
    boundaries where *sounding* changes (mouse+audio both holding a pitch,
    mouse releasing). Both snapshots are now recomputed per `publish()` and
    diffed independently — behaviourally identical for pressed subscribers.
  - New `src/lib/audioPitch/detector.ts` — pure, DOM-free, Web-Audio-free
    detection state machine (`Float32Array`s in, note events out), which is
    what makes it testable without a microphone or a room.
  - New `src/lib/audioPitch/engine.ts` — Web Audio wrapper owning a dedicated
    plain `AudioContext` (deliberately not Tone's), `getUserMedia` with all
    voice processing disabled, and two `AnalyserNode`s (2048 onset / 8192
    pitch) pumped from the existing `frameLoop.ts`. `start(source?)` accepts
    an injected node — the seam that lets tests drive it from oscillators.
  - New dev-only lab: `audio-lab.html` (a second Vite entry, deliberately
    *not* in the production build inputs) plus `src/dev/AudioLab.tsx`.
  - **Six bugs found and fixed during this work; three of them surfaced only
    from re-reading raw traces after a subagent had reported the work
    passing, and two were actively misdiagnosed first.** In order: noise-floor
    creep (caught in plan review before coding), false onsets during decay,
    bass sub-octave errors hidden by a harness that never checked the detected
    pitch matched the played pitch, duplicate note-on emission hidden by
    harnesses that filtered the log to note-*on* lines only, a noise-floor
    deadlock, and no tonality gate. The last two were found by the user
    testing a real microphone, where the detector hallucinated notes
    continuously from ambient room noise.
  - **The recurring lesson, worth internalising: noise-free synthetic testing
    was a fantasy that hid real bugs, and "all tests pass" meant little until
    the harness asserted the right things.** The synthetic source now has a
    configurable noise bed, and permanent regression checks cover the cases
    that were previously invisible (empty room → zero note-ons; one strike →
    exactly one note-on/note-off pair; pitch correctness, not just detection).

- **Manual Auto/Light/Dark theme toggle** (2026-08-15) — theme resolution
  moved from a pure `prefers-color-scheme` mirror to a persisted user
  preference. [src/lib/theme.ts](../src/lib/theme.ts) now tracks a
  `ThemePreference` (`'auto' | 'light' | 'dark'`) in `localStorage`
  (`pianotutor:theme`); `getTheme()` resolves it (system scheme when
  `'auto'`) and `initTheme()` applies the result as a `data-theme` attribute
  on `<html>` — called in `main.tsx` before the first render, so there's no
  flash of the wrong theme. `src/index.css`'s light-token block and
  `PianoRoll.css`'s light-mode lane-opacity rule both moved from `@media
  (prefers-color-scheme: light)` to `:root[data-theme='light']` selectors
  accordingly, so an explicit preference can override the OS scheme instead
  of just mirroring it; dark stays the unattributed default, unchanged. New
  `setThemePreference()`/`useThemePreference()` plus a `ThemeToggle.tsx`/
  `.css` component (a 3-way pill, same visual language as the existing
  DAW/Two-Hand toggle) render it in the readout row's bottom-right corner,
  next to that toggle. Verified via headless Chrome (`playwright-core`):
  auto follows the OS scheme by default with no stored preference, an
  explicit choice persists across a reload even when it contradicts the OS
  scheme, and switching back to `'auto'` correctly re-resolves from the OS
  scheme.
- **Light-mode color pass via Claude Design sync** (2026-08-15) — resolved
  PLAN.md decision #5's deferred "revisit with Claude design later if the
  guesses read poorly": the original best-guess light palette (mirrored
  lightness/relationships from dark, never actually reviewed) read as
  washed out — `--surface-roll` at L 0.78 made the roll a mid-gray slab, and
  the fixed track hues (L 0.70–0.76) didn't move with it, so the amber track
  (L 0.76) nearly vanished into the roll (a 0.02 lightness delta).
  [design/light-mode-colors.md](../design/light-mode-colors.md) (a Claude
  Design pass, itself informed by [design/github.md](../design/github.md)'s
  repo sync) diagnosed this and specified a real light-mode palette, applied
  across:
  - `src/index.css`'s light-token block: the roll becomes the *lightest*
    surface ("paper"), not a mirrored-dark mid-tone; chrome sits a step
    darker; grid contrast quieted; text/accent/keyboard/playhead
    recalibrated for AA contrast on light surfaces.
  - `src/lib/trackColors.ts`: track hues are now theme-aware (`BASE_DARK`/
    `BASE_LIGHT`; `trackColorParts`/`trackColor`/`trackColorVars` all take
    an optional `theme` param, defaulting to `getTheme()`) — same
    hues/ordering/forbidden-bands, but ~0.2 darker and more chromatic in
    light mode so notes hold contrast against paper; amber additionally
    rotates 78°→70°, since the original hue reads brown at the darker
    lightness. Non-focused-lane ghosting alpha (new `trackGhostAlpha()`) is
    likewise themed (0.55 dark / 0.85 light) — alpha isn't symmetric when
    the roll's figure/ground relationship inverts, so the same alpha that
    ghosts correctly on the dark roll nearly disappears on the light one.
  - `PianoKeyboard.tsx`/`TrackChips.tsx`/`PianoRoll.tsx` all now call
    `useTheme()` ([src/lib/theme.ts](../src/lib/theme.ts), a
    `useSyncExternalStore` wrapper) and pass the resolved theme into
    `trackColor`/`trackColorVars`/`trackGhostAlpha` — including the
    canvas's non-focused-lane fill, previously a hardcoded `0.5` alpha.
  - A user-reported follow-up bug, fixed the same session:
    [App.css](../src/App.css)'s `.roll-area` (the outer padding/frame around
    the ruler and lanes) was reusing `--surface-roll` — the same token the
    note-lane canvases use for their "paper" background — so the frame
    bled the paper's lightness into the gutter around it, reading as a
    mismatch against the `--surface-app`-colored keyboard band below (a
    real regression from the first pass, not a pre-existing bug). Fixed by
    pointing `.roll-area` at `--surface-app` instead, restoring
    `--surface-roll` as a value distinct from `--surface-app` (`0.965` vs
    `0.9`) reserved for the lane "paper," and recalibrating
    `--grid-major`/`--grid-minor` to match.
  - Verified with `tsc`/`build`/`oxlint` plus real headless-Chrome
    screenshots (`playwright-core` driving the system's installed Google
    Chrome via `executablePath`, since only `playwright-core` — no bundled
    browser binary — is a project devDependency) in both light and dark
    mode, against a synthesized two-track test `.mid`: confirmed the
    amber/blue tracks read clearly against the new roll, and the
    roll/keyboard-band frame colors now match.
- **Equal-height piano-roll lanes** (2026-08-15) — dropped the handoff's
  1.7x height weighting for the focused lane
  ([src/components/PianoRoll.tsx](../src/components/PianoRoll.tsx),
  `FOCUSED_WEIGHT`/`OTHER_WEIGHT`, both now `1`). All lanes now split
  available height evenly regardless of focus; focus is still conveyed
  through color/opacity/glow on notes, the lane border, and the chip
  styling — just no longer through extra size. `FOCUSED_WEIGHT` is kept as
  a separate named constant from `OTHER_WEIGHT` (rather than collapsed into
  one) in case per-focus weighting is revisited.

- **Track chip click behavior simplified, lane order fixed to MIDI order**
  (2026-08-15) — post-M9 polish, superseding the click semantics described in
  the M9/M8 entries below:
  - Plain click now **toggles** a track's lane on/off (add/remove from
    `LaneSelection.lanes`); it no longer solos (collapses to just that one
    lane). ⌘/Ctrl-click now **focuses** a track (adding it to the lanes
    first if not already present), instead of toggling membership. Shift-click
    is no longer a modifier for this. `laneSelectionReducer`
    ([src/lib/laneSelection.ts](../src/lib/laneSelection.ts)) gained a
    dedicated `'focus'` action; `'toggle'` no longer moves focus except when
    the removed/evicted lane was the focused one. `'solo'` is unchanged and
    now used only to seed the initial selection on file load.
  - Fixed a reintroduced-identity bug where `'focus'` on an
    already-focused track returned a new `LaneSelection` object instead of
    `state`, which — because `selection` feeds the `player.setLanes` effect
    in App.tsx — silently restarted the current wait-mode step (wiping
    partially-struck chord progress) on a no-op ⌘-click. Fixed by returning
    `state` unchanged when `focus` doesn't actually change, mirroring the
    no-op guard `'toggle'` already had for the last-lane case.
  - Piano-roll lanes now always stack in **MIDI track order** (ascending
    `track.index`), not selection order: `laneTracks` in App.tsx filters the
    already-ordered `tracks` array by lane membership instead of mapping
    over `selection.lanes`. `LaneSelection.lanes`'s ordering is now purely an
    eviction queue (oldest selected gets dropped past 3 lanes / reassigned
    focus first), not a render order — noted in the type's doc comment so a
    future change doesn't reintroduce a display dependency on it.

- `feat: visual redesign` (M9) — applied
  [design/design_handoff_piano_tutor/](../design/design_handoff_piano_tutor/)
  on top of M8's working multitrack mechanics, in ten sequential,
  independently reviewed steps (foundations, track-identity-through-player,
  shell, toolbar, chips, roll sizing, roll visuals, keyboard, readout row,
  cleanup+light-mode):
  - **Five-band fixed layout**: `.app` is a `100dvh; overflow: hidden` flex
    column — toolbar 46px, chip bar 36px, roll area `flex: 1 1 auto;
    min-height: 0`, keyboard band 116px, readout row 96px — replacing the
    old centered 1100px column. The chip bar always renders (even with no
    file loaded) so the layout never jumps on load.
  - **oklch design-token system**: `src/index.css`'s `:root` carries the
    handoff's dark palette as the default, with `@media
    (prefers-color-scheme: light)` overriding role-based tokens (surfaces,
    borders, roll grid, text, accent, semantic, keyboard, playhead,
    shadows). Light-mode values mirror *relationships* (hue/chroma
    unchanged, elevation ordering preserved, text mirrored around L 0.5)
    rather than being designed from scratch — resolved decision #5 in
    PLAN.md. New `src/lib/theme.ts` wraps `matchMedia` so a future manual
    toggle is a one-line change.
  - **Per-track hue system**: new `src/lib/trackColors.ts` —
    `trackColorParts(trackIndex)`/`trackColor()`/`trackColorVars()` compute
    `{l,c,h}` from the handoff's 4 base hues, rotating +70° per wrap and
    skipping reserved green/red bands, keyed on `track.index` (stable per
    session, never lane position). Chips, lane labels, canvas note bars, and
    `PianoKeyboard` (which spreads `trackColorVars()` per lit key, feeding
    `.key.active { fill: var(--track, var(--correct)) }`) all read this one
    source.
  - **Canvas↔CSS token bridge**: new `src/lib/tokens.ts` — a *cached*
    `getComputedStyle(:root)` snapshot (`getCanvasTokens()` /
    `subscribeCanvasTokens()` / `useCanvasTokens()` over
    `useSyncExternalStore`), invalidated on theme change via `theme.ts`,
    never read inside the per-frame draw loop (a per-frame
    `getComputedStyle` would force a style recalc every frame — the same
    class of perf bug M8 fixed for canvas sizing).
  - **Toolbar/tooltip/shortcut system**: new `components/icons.tsx`
    (currentColor-ified SVGs), `Tooltip.tsx` (400ms `pointerenter` delay,
    immediate on `focus-visible`), `IconButton.tsx`, `Toolbar.tsx`,
    `TimeReadout.tsx`, `TempoControl.tsx` (real `<input type="range">`,
    `::-webkit-slider-*` styled), `MidiPill.tsx` (status-only, no
    device-selection affordance), and `hooks/useAppShortcuts.ts` (`Space`
    play/pause, `Alt/Opt+O` open-file via `e.code` since macOS emits `ø` for
    the key). The loop toolbar button is repurposed as loop-status-plus-clear
    since a dedicated enable/disable toggle was out of scope; the `L`
    shortcut was dropped since the only action left is destructive.
  - **Track chips restyled**: `TrackChips.tsx`/`.css` — three visually
    distinct states (focused/selected-not-focused/unselected), chip bar
    scrolls horizontally on overflow instead of showing hint text (resolved
    decision #4).
  - **Piano-roll rework**: lanes now **fill available height** in JS,
    split evenly across lanes (originally focused `1.7`, others `1`, per
    the handoff; changed to equal weight post-M9 — see "Equal-height
    piano-roll lanes" below) rather than pitch-count × a fixed
    `ROW_HEIGHT` (deleted) — the existing scroll-container
    `ResizeObserver` now also records height, and `laneLayouts` gains
    `height`/`rowHeight`. `noteAtEvent` takes the layout's `rowHeight`.
    Horizontal black-key striping/octave lines were deliberately removed
    (illegible noise at derived heights). DOM restructure: lane
    border/radius/background moved onto the `<canvas>` (the visible lane
    box), not the song-width lane div. Playhead and loop region moved out of
    the canvas into one absolutely-positioned `pointer-events: none` overlay,
    positioned imperatively via `style.transform` from the shared per-frame
    function — never React state — enabling a dirty-redraw check that skips
    lane redraws entirely when nothing changed (near-zero CPU while paused).
    The ruler/grid map onto seconds (major gridline every 1s with an `m:ss`
    label, minor every 0.25s) since bar/beat data doesn't exist — resolved
    decision, called out as a known deviation.
  - **Keyboard restyled**: `PianoKeyboard.tsx`/`.css` — new module constants
    (`WHITE_KEY_WIDTH` 28, `WHITE_KEY_HEIGHT` 116, `BLACK_KEY_HEIGHT` 72,
    `BLACK_KEY_WIDTH` 0.66×), bottom-only rounded corners, C-boundary key
    labels, keybed inset/shadow. Key width stays constant across
    lane-count/range states rather than stretching (resolved decision #0,
    a known deviation from `02-solo-bass.png`). New
    `keyboardRangeFor(ranges)` in `laneSelection.ts` snaps the union range
    outward to the nearest C, 24-semitone minimum, clamped A0–C8.
  - **Readout row restyled**: `NoteReadout.tsx` plus an inline 3-column
    `.readout-row` grid in `App.tsx`/`App.css` (loop info left,
    `EXPECTED`/`YOU PLAYED`/`CLEAN` center, octave/key-count +
    computer-keyboard-layout toggle right) — kept inline rather than a
    separate `ReadoutRow` component, since it's a thin, non-reusable
    composition. `♯` display formatter added to
    `noteNames.ts` (logic call sites keep the old `midiToNoteName`). A step-9
    review found the center column's long-chord (8+ note) overflow could
    push the row past its fixed 96px band at narrow viewports; fixed in
    step 10 (see below).
  - **Player API**: `onActiveNotesChange` changed from `Set<number>` to
    `Map<number, trackIndex>` so lit keys/lane notes/lane labels/chips can
    all be driven by the same per-track data — a bare `Set` couldn't carry
    which lane a sounding pitch belonged to.
  - **Fonts**: `@fontsource-variable/archivo` (400–600 in one variable file)
    and `@fontsource/ibm-plex-mono` (400/500/600), `latin`-only entry points
    imported in `main.tsx`, bundled offline rather than via the handoff's
    Google Fonts CDN link (same precedent as the Salamander samples).
    Attribution added to README.md.
  - **Step 10 cleanup + light-mode pass**: deleted the step-1 legacy CSS
    alias vars (`--text-h`, `--bg`, `--accent-bg`, `--accent-border`,
    `--shadow`) once nothing referenced the old names anymore; deleted dead
    App.css rules left over from the pre-redesign UI (`.mode-toggle`,
    `.play-pause`, `.tempo`, `.full-keyboard-toggle`, `.region-info`,
    `.status-row`, `.hint`) and index.css's now-unused `h1`/`h2` rules (no
    `<h1>`/`<h2>` remain — the song button replaced the old title); deleted
    the unreferenced `public/icons.svg` sprite sheet. Fixed the step-9
    long-chord overflow: `.readout-row`'s center grid track is now `minmax(0,
    auto)` and `.note-readout` itself carries a `max-width: min(560px,
    100%)` cap, with the expected/played value `<span>`s given
    `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` — a
    pathological chord now clips to one line and ellipsizes instead of
    wrapping to a second line and overflowing into the keyboard band above;
    verified with a headless pass measuring `.readout-row`'s bounding-box
    height (exactly 96px in every case tested: 1512px/1100px ×
    short/long chord) and confirming `scrollWidth > clientWidth` on the
    value span for the long-chord case (proving the ellipsis path actually
    engages) while a short chord's rendered size is unchanged. Did a
    headless light-mode legibility pass (empty state, two-lane wait-mode
    wrong-note, and keyboard key-state screenshots) — read cleanly with good
    contrast throughout (chip states, roll grid against the lighter roll
    background, track hues, correct/incorrect/expected-ring key states), so
    no light-mode token changes were needed.
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

- **M10a audio pitch input is the active work — resume at step 6.** Steps 1–5
  (bus groundwork, detector, engine, lab page, tuning) are done and verified.
  Remaining, in order: step 6 `useAudioInput` hook (gating, `publishedHeld`,
  force-release, Fast-Refresh-safe teardown), step 7 `AudioPill` +
  calibration/monitor UI, step 8 app wiring + escape hatch, step 9 docs, step
  10 real-room acceptance. Full step definitions in
  [audioPitchInput.md](audioPitchInput.md).
  - One decision already taken for step 7: add a `--warning` semantic token
    for the "struggling" amber pill state rather than repurposing a track hue
    (track hues already carry meaning; borrowing one would muddy it).
  - Read that file's **"Known issues and things to revisit"** backlog before
    resuming. Two items matter most: the unmeasured **false-positive-on-an-
    expected-note** risk (a false positive on a pitch the step is waiting for
    will advance it without the user playing — the one failure that actively
    teaches the piece wrong), and item 11, the **flaky noise-floor-creep
    check** under noise, which is worth reproducing deliberately before step
    10 because pedal-heavy playing is what would expose it.
- **M6 (VexFlow staff notation)** remains deferred indefinitely with no
  committed timeline — M7/M8/M9 were all pulled ahead of it by explicit
  prioritization, and M10a is now ahead of it too.
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

- M6 is intentionally deferred with no committed timeline; M7, M8, and M9
  were all pulled forward ahead of it, and now that M9 is done it's the only
  milestone left in PLAN.md, still with no committed timeline to pick it
  back up.
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
  pass is needed. **Superseded 2026-08-15**: that guess read as washed out
  and was replaced by a real Claude Design pass — see the "Light-mode color
  pass via Claude Design sync" entry above — and the app also gained a
  manual Auto/Light/Dark toggle, so light mode is no longer purely
  OS-mirrored.
