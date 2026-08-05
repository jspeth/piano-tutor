# Product Context

## Why this project exists

A personal tool for learning to play piano parts from MIDI files, without
needing sheet music or a teacher. The motivating use case is being able to
practice a part with zero hardware — e.g., on a laptop on a train — not just
at a desk with a MIDI keyboard plugged in.

## Problem it solves

- Learning a song from a MIDI file usually means either reading staff
  notation (a separate skill) or a DAW piano-roll that isn't built for
  practice (no wait-for-key pacing, no lit keyboard, no note-name readout).
- Existing "learn piano" tools generally assume a connected MIDI keyboard.
  This app treats hardware as optional: mouse and computer-keyboard input are
  first-class, and real MIDI input (M5, done) is an additive enhancement
  layered on the same input abstraction.

## How it should work

1. Upload a `.mid`/`.midi` file (no bundled songs, no backend/server).
2. Pick a track/part to practice.
3. See the part on a horizontal piano-roll with a lit on-screen keyboard.
4. Drag-select a time region to focus practice on just that section, with
   looping.
5. Play along — pressed notes light the keyboard and sound a synth, whether
   pressed via mouse, computer keyboard, or a real MIDI keyboard.
6. A wait-for-key mode (M4) pauses playback at each note/chord until the
   right key(s) are pressed, so practice is self-paced rather than
   metronome-paced.

## UX goals

- Never require hardware to get started — the on-screen keyboard and typing
  keyboard must be fully functional practice inputs on their own.
- One shared clock/timeline: the piano-roll, playhead, and loop region always
  agree, regardless of tempo changes mid-playback.
- Minimal setup friction: drop in a file, pick a track, go.
