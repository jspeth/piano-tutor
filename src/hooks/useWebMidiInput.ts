import { useEffect, useState } from 'react'
import { WebMidi } from 'webmidi'
import type { Input, NoteMessageEvent, PortEvent } from 'webmidi'
import { publish } from '../lib/noteInput'

export interface WebMidiStatus {
  supported: boolean
  enabled: boolean
  error: string | null
  inputNames: string[]
}

/**
 * Binds any connected MIDI keyboard(s) to the note-input bus, mirroring
 * useComputerKeyboardInput. Devices can come and go while the app is open, so
 * inputs are (re)attached on WebMidi's "connected"/"disconnected" events
 * rather than just once at enable time.
 */
export function useWebMidiInput(): WebMidiStatus {
  const [status, setStatus] = useState<WebMidiStatus>({
    supported: WebMidi.supported,
    enabled: false,
    error: null,
    inputNames: [],
  })

  useEffect(() => {
    if (!WebMidi.supported) return

    let cancelled = false
    const detachers = new Map<Input, () => void>()

    function attachInput(input: Input) {
      if (detachers.has(input)) return
      // Tracks this input's currently-held notes so a disconnect (or unmount)
      // mid-press can force matching noteoffs — otherwise noteInput.ts's
      // per-source hold count for that pitch never drops back to zero and
      // the key stays stuck lit.
      const held = new Map<number, number>()

      function handleNoteOn(e: NoteMessageEvent) {
        const midi = e.note.number
        held.set(midi, (held.get(midi) ?? 0) + 1)
        publish({ type: 'noteon', midi, source: 'midi' })
      }
      function handleNoteOff(e: NoteMessageEvent) {
        const midi = e.note.number
        const count = held.get(midi)
        if (count === undefined) return
        if (count <= 1) held.delete(midi)
        else held.set(midi, count - 1)
        publish({ type: 'noteoff', midi, source: 'midi' })
      }
      input.addListener('noteon', handleNoteOn)
      input.addListener('noteoff', handleNoteOff)
      detachers.set(input, () => {
        input.removeListener('noteon', handleNoteOn)
        input.removeListener('noteoff', handleNoteOff)
        for (const midi of held.keys()) {
          publish({ type: 'noteoff', midi, source: 'midi' })
        }
        held.clear()
      })
    }

    function detachInput(input: Input) {
      detachers.get(input)?.()
      detachers.delete(input)
    }

    function syncInputNames() {
      setStatus((s) => ({ ...s, inputNames: WebMidi.inputs.map((i) => i.name) }))
    }

    function handleConnected(e: PortEvent) {
      if (e.port?.type !== 'input') return
      attachInput(e.port)
      syncInputNames()
    }

    function handleDisconnected(e: PortEvent) {
      if (e.port?.type !== 'input') return
      detachInput(e.port)
      syncInputNames()
    }

    WebMidi.enable()
      .then(() => {
        if (cancelled) return
        for (const input of WebMidi.inputs) attachInput(input)
        WebMidi.addListener('connected', handleConnected)
        WebMidi.addListener('disconnected', handleDisconnected)
        setStatus({
          supported: true,
          enabled: true,
          error: null,
          inputNames: WebMidi.inputs.map((i) => i.name),
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus({
          supported: WebMidi.supported,
          enabled: false,
          error: err instanceof Error ? err.message : String(err),
          inputNames: [],
        })
      })

    return () => {
      cancelled = true
      WebMidi.removeListener('connected', handleConnected)
      WebMidi.removeListener('disconnected', handleDisconnected)
      for (const input of Array.from(detachers.keys())) detachInput(input)
      // Deliberately not calling WebMidi.disable() here: it's an async,
      // singleton-wide teardown that races a concurrent re-enable (e.g. Fast
      // Refresh remounting this hook), leaving WebMidi listener-less until a
      // full page reload. Just detaching our own listeners is enough.
    }
  }, [])

  return status
}
