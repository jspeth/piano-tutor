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
  scheduled to be fixed.
- **Canvas `oklch()`/`roundRect()` browser floor (M9)**: `PianoRoll`'s draw
  code passes `oklch()` color strings straight to `ctx.fillStyle`/
  `ctx.strokeStyle` (via [src/lib/tokens.ts](../src/lib/tokens.ts)/
  `trackColor()`) and uses `CanvasRenderingContext2D.roundRect()` for note
  bars — both require Chrome 111+, Safari 16.4+, or Firefox 113+. Accepted
  as fine since Web MIDI already constrains this app to Chrome/Edge (see
  above); recorded explicitly now that the canvas draw path itself also
  depends on a modern-browser feature, not just Web MIDI.

## Key source files

- [src/lib/midiParser.ts](../src/lib/midiParser.ts) — MIDI file → tracks/notes.
- [src/lib/player.ts](../src/lib/player.ts) — Transport, time conversion, loop points.
- [src/lib/noteInput.ts](../src/lib/noteInput.ts) — shared note-event bus.
- [src/lib/noteNames.ts](../src/lib/noteNames.ts) — MIDI number → note name.
- [src/lib/keyboardMapping.ts](../src/lib/keyboardMapping.ts) — computer-keyboard → piano key mapping.
- [src/hooks/useComputerKeyboardInput.ts](../src/hooks/useComputerKeyboardInput.ts)
- [src/hooks/useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts) — WebMidi.js device input.
- [src/components/PianoKeyboard.tsx](../src/components/PianoKeyboard.tsx) — SVG on-screen keyboard.
- [src/components/PianoRoll.tsx](../src/components/PianoRoll.tsx) — Canvas piano-roll.
- [src/components/NoteReadout.tsx](../src/components/NoteReadout.tsx) — pressed/expected note text.
- [src/App.tsx](../src/App.tsx) — file upload, track selection, playback controls, wiring.
