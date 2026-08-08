import { useEffect, useRef, useState } from 'react'
import { publish } from '../lib/noteInput'
import {
  DEFAULT_OCTAVE,
  OCTAVE_DOWN_CODE,
  OCTAVE_UP_CODE,
  clampOctave,
  codeToMidi,
  type KeyboardLayout,
} from '../lib/keyboardMapping'

const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
])

export function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT') return TEXT_ENTRY_INPUT_TYPES.has((target as HTMLInputElement).type)
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export interface ComputerKeyboardInput {
  baseOctave: number
  layout: KeyboardLayout
  setLayout: (layout: KeyboardLayout) => void
}

/**
 * Binds the computer keyboard to the note-input bus, in either the DAW-style
 * mapping or a two-handed mapping. Returns the current base octave and
 * layout for display, plus a setter to switch layouts.
 */
export function useComputerKeyboardInput(): ComputerKeyboardInput {
  const [baseOctave, setBaseOctave] = useState(DEFAULT_OCTAVE)
  const baseOctaveRef = useRef(DEFAULT_OCTAVE)
  const [layout, setLayoutState] = useState<KeyboardLayout>('daw')
  const layoutRef = useRef<KeyboardLayout>('daw')
  const downCodesRef = useRef(new Map<string, number>())

  function releaseAll() {
    for (const midi of downCodesRef.current.values()) {
      publish({ type: 'noteoff', midi, source: 'keyboard' })
    }
    downCodesRef.current.clear()
  }

  function setLayout(next: KeyboardLayout) {
    if (next === layoutRef.current) return
    releaseAll()
    layoutRef.current = next
    setLayoutState(next)
  }

  useEffect(() => {
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
      const midi = codeToMidi(e.code, baseOctaveRef.current, layoutRef.current)
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

  return { baseOctave, layout, setLayout }
}
