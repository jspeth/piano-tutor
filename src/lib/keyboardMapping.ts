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

export const OCTAVE_DOWN_CODE = 'KeyZ'
export const OCTAVE_UP_CODE = 'KeyX'

export const MIN_OCTAVE = 1
export const MAX_OCTAVE = 7
export const DEFAULT_OCTAVE = 4

export function clampOctave(octave: number): number {
  return Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, octave))
}

/** `midi = (baseOctave + 1) * 12 + offset`, so `codeToMidi('KeyA', 4) === 60` (C4). */
export function codeToMidi(code: string, baseOctave: number): number | null {
  const offset = KEY_CODE_TO_OFFSET[code]
  if (offset === undefined) return null
  const octave = clampOctave(baseOctave)
  return (octave + 1) * 12 + offset
}
