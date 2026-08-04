# Piano Tutor

A browser app for learning to play piano from a MIDI file. Load a MIDI file,
pick a part (track) to practice, and play along with a lit up keyboard while
connected to a real MIDI keyboard.

See [PLAN.md](PLAN.md) for the full design, architecture, and milestone
status.

## Features

- Load a MIDI file from disk and see its tracks.
- Select a track as the part you want to practice.
- Play back the part with a tempo control.
- Piano keyboard visualization that lights up in sync with playback.

Planned: MIDI keyboard input, a wait for key practice mode, staff notation,
and falling notes.

## Requirements

- Node.js 20 or later.
- Chrome or Edge is recommended once MIDI keyboard input is added, since Web
  MIDI support is inconsistent in Safari and Firefox.

## Getting started

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Then open the printed local URL (usually http://localhost:5173) in your
browser and upload a `.mid` or `.midi` file.

## Scripts

- `npm run dev`: start the Vite dev server with hot reload.
- `npm run build`: type check and build a production bundle.
- `npm run preview`: preview the production build locally.
- `npm run lint`: run Oxlint.

## Project structure

- `src/lib/midiParser.ts`: parses an uploaded MIDI file into tracks and notes
  using `@tonejs/midi`.
- `src/components/PianoKeyboard.tsx`: SVG piano keyboard component that
  highlights active notes.
- `src/App.tsx`: file upload, track selection, playback controls, and
  keyboard wiring.
