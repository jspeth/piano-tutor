# Tech Context

## Stack

- **Framework**: React 19 + TypeScript, built with Vite 8.
- **Audio/playback**: `Tone.js` (`^15.1.22`) — Transport, `Tone.Part`,
  `Tone.Sampler` (Salamander Grand Piano, bundled locally).
- **MIDI parsing**: `@tonejs/midi` (`^2.0.28`) — reads uploaded `.mid`/`.midi`
  files into tracks/notes.
- **MIDI hardware input**: `webmidi` (`^3.1.16`) — wired via
  [src/hooks/useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts) (M5,
  done).
- **Fonts**: `@fontsource-variable/archivo` (one variable file, 400–600) and
  `@fontsource/ibm-plex-mono` (400/500/600), both bundled locally (M9) and
  imported via their `latin`-only entry points in `main.tsx` rather than
  linked from Google Fonts CDN — matching the same offline-first precedent
  set by the bundled Salamander piano samples, so the app has no runtime
  dependency on an external font host.
- **Audio pitch detection (M10a, in progress)**: no new dependencies — plain
  Web Audio (`AudioContext`, `getUserMedia`, two `AnalyserNode`s) plus
  hand-written DSP in `src/lib/audioPitch/`. Deliberately **not** an ML model
  (no ONNX/TensorFlow/basic-pitch) to keep the bundle small and the code
  reasonable-about-able. `AnalyserNode` was chosen over an AudioWorklet with a
  hand-rolled FFT specifically to avoid writing/validating an FFT and to dodge
  a real Vite problem: TS AudioWorklet modules don't load cleanly in dev.
- **Linting**: Oxlint (`npm run lint`), config in `.oxlintrc.json`.
- **UI smoke-testing**: `playwright-core` (devDependency, no bundled Chromium
  download) drives the system's installed Google Chrome via `executablePath`
  for headless end-to-end checks against the real `npm run dev` server —
  added so UI verification passes (layout, note-readout state, etc.) don't
  require reinstalling anything each time.
- **No backend**: everything runs client-side; no server, no bundled sample
  songs, no persistence.

## Development setup

- Requires Node.js 20+.
- `npm install` then `npm run dev` — Vite dev server, usually
  http://localhost:5173.
- `npm run build` — `tsc -b && vite build` (type-checks before bundling).
- `npm run preview` — preview the production build.
- `npm run lint` — Oxlint.

## Technical constraints

- **Web MIDI browser support**: Web MIDI API is Chrome/Edge only; Safari and
  Firefox support is inconsistent. `useWebMidiInput.ts` surfaces this via a
  `supported` flag rather than failing silently.
- **Computer-keyboard chord limits**: physical keyboard hardware key rollover
  means some multi-key chords won't register simultaneously on many laptops.
  Large chords need the mouse or, eventually, a real MIDI keyboard. This is a
  documented, accepted limitation — not a bug to chase.
- **No persistence**: reloading the page loses the loaded file, track
  selection, and selected practice region. Known limitation, not yet
  scheduled to be fixed. (One exception, added 2026-08-15: the theme
  preference — auto/light/dark — persists to `localStorage` via
  [src/lib/theme.ts](../src/lib/theme.ts).)
- **Canvas `oklch()`/`roundRect()` browser floor (M9)**: `PianoRoll`'s draw
  code passes `oklch()` color strings straight to `ctx.fillStyle`/
  `ctx.strokeStyle` (via [src/lib/tokens.ts](../src/lib/tokens.ts)/
  `trackColor()`) and uses `CanvasRenderingContext2D.roundRect()` for note
  bars — both require Chrome 111+, Safari 16.4+, or Firefox 113+. Accepted
  as fine since Web MIDI already constrains this app to Chrome/Edge (see
  above); recorded explicitly now that the canvas draw path itself also
  depends on a modern-browser feature, not just Web MIDI.

## Dev-only build entries

- `audio-lab.html` at the repo root is a **second Vite HTML entry** for the
  audio-pitch dev lab (`src/dev/AudioLab.tsx`). It is served under
  `npm run dev` at `/piano-tutor/audio-lab.html` — the `/piano-tutor/` base
  path from `vite.config.ts` is required or it won't resolve — and is
  deliberately **absent from the production build**: because
  `build.rollupOptions.input` is unset, Vite builds only root `index.html`.
  Verify with `find dist -iname "*audio*"` after a build if that ever changes.
- Headless verification of the lab uses `playwright-core` driving the system
  Chrome via `executablePath` against a running dev server, the same pattern
  as the M9 UI checks. The lab exposes `window.__audioLabEngine` and
  `[data-testid="log-line"]` elements as the hooks those scripts read.

## Key source files

- [src/lib/midiParser.ts](../src/lib/midiParser.ts) — MIDI file → tracks/notes.
- [src/lib/player.ts](../src/lib/player.ts) — Transport, time conversion, loop points.
- [src/lib/noteInput.ts](../src/lib/noteInput.ts) — shared note-event bus;
  owns both the `pressed` and `sounding` snapshots (see systemPatterns.md).
- [src/lib/audioPitch/detector.ts](../src/lib/audioPitch/detector.ts) — pure
  pitch-detection state machine (no Web Audio, no React, no DOM).
- [src/lib/audioPitch/engine.ts](../src/lib/audioPitch/engine.ts) — Web Audio
  wrapper: own `AudioContext`, mic capture, two `AnalyserNode`s, frame pump.
- [src/dev/AudioLab.tsx](../src/dev/AudioLab.tsx) — dev-only detector lab.
- [src/lib/noteNames.ts](../src/lib/noteNames.ts) — MIDI number → note name.
- [src/lib/keyboardMapping.ts](../src/lib/keyboardMapping.ts) — computer-keyboard → piano key mapping.
- [src/lib/theme.ts](../src/lib/theme.ts) — theme preference (auto/light/dark), `localStorage` persistence, `data-theme` attribute.
- [src/lib/trackColors.ts](../src/lib/trackColors.ts) — theme-aware per-track hue/alpha computation.
- [src/hooks/useComputerKeyboardInput.ts](../src/hooks/useComputerKeyboardInput.ts)
- [src/hooks/useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts) — WebMidi.js device input.
- [src/components/PianoKeyboard.tsx](../src/components/PianoKeyboard.tsx) — SVG on-screen keyboard.
- [src/components/PianoRoll.tsx](../src/components/PianoRoll.tsx) — Canvas piano-roll.
- [src/components/NoteReadout.tsx](../src/components/NoteReadout.tsx) — pressed/expected note text.
- [src/App.tsx](../src/App.tsx) — file upload, track selection, playback controls, wiring.
