import { useEffect, useRef, useState } from 'react'
import { publish } from '../lib/noteInput'
import {
  DEFAULT_OCTAVE,
  OCTAVE_DOWN_CODE,
  OCTAVE_UP_CODE,
  clampOctave,
  codeToMidi,
} from '../lib/keyboardMapping'

function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Binds the computer keyboard (DAW-style mapping) to the note-input bus.
 * Returns the current base octave for display.
 */
export function useComputerKeyboardInput(): number {
  const [baseOctave, setBaseOctave] = useState(DEFAULT_OCTAVE)
  const baseOctaveRef = useRef(DEFAULT_OCTAVE)
  const downCodesRef = useRef(new Map<string, number>())

  useEffect(() => {
    function releaseAll() {
      for (const midi of downCodesRef.current.values()) {
        publish({ type: 'noteoff', midi, source: 'keyboard' })
      }
      downCodesRef.current.clear()
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isFormTarget(e.target)) return

      if (e.code === OCTAVE_DOWN_CODE) {
        baseOctaveRef.current = clampOctave(baseOctaveRef.current - 1)
        setBaseOctave(baseOctaveRef.current)
        return
      }
      if (e.code === OCTAVE_UP_CODE) {
        baseOctaveRef.current = clampOctave(baseOctaveRef.current + 1)
        setBaseOctave(baseOctaveRef.current)
        return
      }

      if (downCodesRef.current.has(e.code)) return
      const midi = codeToMidi(e.code, baseOctaveRef.current)
      if (midi === null) return
      downCodesRef.current.set(e.code, midi)
      publish({ type: 'noteon', midi, source: 'keyboard' })
    }

    function handleKeyUp(e: KeyboardEvent) {
      // Always process releases (even with modifiers held) so a note never
      // gets stuck because e.g. Cmd was pressed after the note key.
      const midi = downCodesRef.current.get(e.code)
      if (midi === undefined) return
      downCodesRef.current.delete(e.code)
      publish({ type: 'noteoff', midi, source: 'keyboard' })
    }

    function handleBlur() {
      releaseAll()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      releaseAll()
    }
  }, [])

  return baseOctave
}
