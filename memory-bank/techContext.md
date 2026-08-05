# Tech Context

## Stack

- **Framework**: React 19 + TypeScript, built with Vite 8.
- **Audio/playback**: `Tone.js` (`^15.1.22`) — Transport, `Tone.Part`,
  `Tone.PolySynth`.
- **MIDI parsing**: `@tonejs/midi` (`^2.0.28`) — reads uploaded `.mid`/`.midi`
  files into tracks/notes.
- **MIDI hardware input (installed, not yet wired)**: `webmidi` (`^3.1.16`) —
  for the deferred M5 Web MIDI milestone.
- **Linting**: Oxlint (`npm run lint`), config in `.oxlintrc.json`.
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
  Firefox support is inconsistent. This only matters once M5 lands.
- **Computer-keyboard chord limits**: physical keyboard hardware key rollover
  means some multi-key chords won't register simultaneously on many laptops.
  Large chords need the mouse or, eventually, a real MIDI keyboard. This is a
  documented, accepted limitation — not a bug to chase.
- **No persistence**: reloading the page loses the loaded file, track
  selection, and selected practice region. Known limitation, not yet
  scheduled to be fixed.

## Key source files

- [src/lib/midiParser.ts](../src/lib/midiParser.ts) — MIDI file → tracks/notes.
- [src/lib/player.ts](../src/lib/player.ts) — Transport, time conversion, loop points.
- [src/lib/noteInput.ts](../src/lib/noteInput.ts) — shared note-event bus.
- [src/lib/noteNames.ts](../src/lib/noteNames.ts) — MIDI number → note name.
- [src/lib/keyboardMapping.ts](../src/lib/keyboardMapping.ts) — computer-keyboard → piano key mapping.
- [src/hooks/useComputerKeyboardInput.ts](../src/hooks/useComputerKeyboardInput.ts)
- [src/components/PianoKeyboard.tsx](../src/components/PianoKeyboard.tsx) — SVG on-screen keyboard.
- [src/components/PianoRoll.tsx](../src/components/PianoRoll.tsx) — Canvas piano-roll.
- [src/components/NoteReadout.tsx](../src/components/NoteReadout.tsx) — pressed/expected note text.
- [src/App.tsx](../src/App.tsx) — file upload, track selection, playback controls, wiring.
