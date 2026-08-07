export type KeyboardLayout = 'daw' | 'two-hand'

/** DAW-style two-row computer-keyboard mapping, keyed on `e.code` (layout-independent). */
export const KEY_CODE_TO_OFFSET: Record<string, number> = {
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C (next octave)
}

/**
 * Two-handed mapping: left hand (A S D F G) plays C-G at the base octave,
 * right hand (H J K L ; ') plays B-G starting a fifth higher, one octave up
 * from the left hand's C. Sharps follow the same "row above and to the
 * right of the white key" pattern as DAW mode.
 */
export const TWO_HAND_KEY_CODE_TO_OFFSET: Record<string, number> = {
  // Left hand
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  // Right hand (one octave up from the left hand's base)
  KeyH: 11, // B
  KeyJ: 12, // C
  KeyI: 13, // C#
  KeyK: 14, // D
  KeyO: 15, // D#
  KeyL: 16, // E
  Semicolon: 17, // F
  BracketLeft: 18, // F#
  Quote: 19, // G
}

const LAYOUT_OFFSETS: Record<KeyboardLayout, Record<string, number>> = {
  daw: KEY_CODE_TO_OFFSET,
  'two-hand': TWO_HAND_KEY_CODE_TO_OFFSET,
}

export const OCTAVE_DOWN_CODE = 'KeyZ'
export const OCTAVE_UP_CODE = 'KeyX'

export const MIN_OCTAVE = 1
export const MAX_OCTAVE = 7
export const DEFAULT_OCTAVE = 4

export function clampOctave(octave: number): number {
  return Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, octave))
}

/** `midi = (baseOctave + 1) * 12 + offset`, so `codeToMidi('KeyA', 4, 'daw') === 60` (C4). */
export function codeToMidi(
  code: string,
  baseOctave: number,
  layout: KeyboardLayout = 'daw',
): number | null {
  const offset = LAYOUT_OFFSETS[layout][code]
  if (offset === undefined) return null
  const octave = clampOctave(baseOctave)
  return (octave + 1) * 12 + offset
}
