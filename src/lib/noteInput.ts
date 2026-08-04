import { useSyncExternalStore } from 'react'

export type NoteInputSource = 'mouse' | 'keyboard' | 'midi'

export interface NoteInputEvent {
  type: 'noteon' | 'noteoff'
  midi: number
  source: NoteInputSource
}

type RawListener = (e: NoteInputEvent) => void
type PressedListener = (pressed: Set<number>) => void

// midi -> per-source hold count. A midi is "effectively" pressed while this
// map has a non-empty entry for it. Counting (rather than a Set of sources)
// matters because the same source can hold the same midi more than once at
// once, e.g. two mouse pointers on the same key, or two computer-keyboard
// keys that map to the same midi after an octave shift — the note must stay
// pressed until every hold from every source is released.
const holders = new Map<number, Map<NoteInputSource, number>>()

const rawListeners = new Set<RawListener>()
const pressedListeners = new Set<PressedListener>()

let pressedSnapshot: Set<number> = new Set()

function computePressedSet(): Set<number> {
  const pressed = new Set<number>()
  for (const [midi, counts] of holders) {
    if (counts.size > 0) pressed.add(midi)
  }
  return pressed
}

export function publish(event: NoteInputEvent): void {
  for (const listener of rawListeners) listener(event)

  let counts = holders.get(event.midi)
  if (event.type === 'noteon') {
    if (!counts) {
      counts = new Map()
      holders.set(event.midi, counts)
    }
    const wasEmpty = counts.size === 0
    counts.set(event.source, (counts.get(event.source) ?? 0) + 1)
    if (wasEmpty) notifyPressedChange()
  } else {
    if (!counts) return
    const count = counts.get(event.source)
    if (count === undefined) return
    if (count <= 1) counts.delete(event.source)
    else counts.set(event.source, count - 1)
    if (counts.size === 0) {
      holders.delete(event.midi)
      notifyPressedChange()
    }
  }
}

function notifyPressedChange() {
  pressedSnapshot = computePressedSet()
  for (const listener of pressedListeners) listener(pressedSnapshot)
}

export function subscribe(listener: RawListener): () => void {
  rawListeners.add(listener)
  return () => rawListeners.delete(listener)
}

export function getPressedNotes(): Set<number> {
  return pressedSnapshot
}

export function subscribePressed(listener: PressedListener): () => void {
  pressedListeners.add(listener)
  return () => pressedListeners.delete(listener)
}

export function usePressedNotes(): Set<number> {
  return useSyncExternalStore(
    (onStoreChange) => subscribePressed(() => onStoreChange()),
    getPressedNotes,
  )
}
