const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Sharps-only spelling, e.g. 60 -> "C4". */
export function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

/**
 * Display variant of `midiToNoteName` for UI text: renders sharps as `♯`
 * (U+266F) instead of `#`, per the design handoff. `midiToNoteName` itself is
 * left untouched since other call sites (PianoRoll's hover tooltip,
 * PianoKeyboard's C-key labels) depend on its exact output.
 */
export function formatNoteName(midi: number): string {
  return midiToNoteName(midi).replace('#', '♯')
}
