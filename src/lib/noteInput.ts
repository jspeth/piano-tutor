import { useSyncExternalStore } from 'react'

export type NoteInputSource = 'mouse' | 'keyboard' | 'midi' | 'audio'

export interface NoteInputEvent {
  type: 'noteon' | 'noteoff'
  midi: number
  source: NoteInputSource
}

type RawListener = (e: NoteInputEvent) => void
type PressedListener = (pressed: Set<number>) => void
type SoundingListener = (sounding: Set<number>) => void

// Sources whose sound already exists physically in the room, so the app must
// not re-sound them through the sampler — attacking the sampler for an
// 'audio' note-on would double the user's own piano. Everything else
// (mouse/keyboard/MIDI controllers) is silent-by-default and must keep
// sounding the sampler, since many MIDI controllers have no sound of their
// own.
const SILENT_SOURCES: ReadonlySet<NoteInputSource> = new Set(['audio'])

// midi -> per-source hold count. A midi is "effectively" pressed while this
// map has a non-empty entry for it. Counting (rather than a Set of sources)
// matters because the same source can hold the same midi more than once at
// once, e.g. two mouse pointers on the same key, or two computer-keyboard
// keys that map to the same midi after an octave shift — the note must stay
// pressed until every hold from every source is released.
const holders = new Map<number, Map<NoteInputSource, number>>()

const rawListeners = new Set<RawListener>()
const pressedListeners = new Set<PressedListener>()
const soundingListeners = new Set<SoundingListener>()

let pressedSnapshot: Set<number> = new Set()
let soundingSnapshot: Set<number> = new Set()

function computePressedSet(): Set<number> {
  const pressed = new Set<number>()
  for (const [midi, counts] of holders) {
    if (counts.size > 0) pressed.add(midi)
  }
  return pressed
}

// Sounding is pressed minus silent-source-only holds: a midi is "sounding"
// while it has at least one holder from a non-silent source. This is a
// filter over the same `holders` bookkeeping pressed uses, not a parallel
// tracking structure.
function computeSoundingSet(): Set<number> {
  const sounding = new Set<number>()
  for (const [midi, counts] of holders) {
    for (const source of counts.keys()) {
      if (!SILENT_SOURCES.has(source)) {
        sounding.add(midi)
        break
      }
    }
  }
  return sounding
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

export function publish(event: NoteInputEvent): void {
  for (const listener of rawListeners) listener(event)

  let counts = holders.get(event.midi)
  if (event.type === 'noteon') {
    if (!counts) {
      counts = new Map()
      holders.set(event.midi, counts)
    }
    counts.set(event.source, (counts.get(event.source) ?? 0) + 1)
  } else {
    if (!counts) return
    const count = counts.get(event.source)
    if (count === undefined) return
    if (count <= 1) counts.delete(event.source)
    else counts.set(event.source, count - 1)
    if (counts.size === 0) holders.delete(event.midi)
  }

  // Recompute both snapshots on every mutation rather than only on the
  // pressed-set 0->1/1->0 transitions: the sounding set can change on a
  // transition where the pressed set does not (e.g. a pitch held by both
  // mouse and audio, where mouse releases but audio still holds — pressed
  // stays 1, sounding drops 1->0). Each snapshot only notifies its own
  // listeners, and only when it actually changed.
  notifyIfChanged()
}

function notifyIfChanged() {
  const nextPressed = computePressedSet()
  if (!setsEqual(nextPressed, pressedSnapshot)) {
    pressedSnapshot = nextPressed
    for (const listener of pressedListeners) listener(pressedSnapshot)
  }

  const nextSounding = computeSoundingSet()
  if (!setsEqual(nextSounding, soundingSnapshot)) {
    soundingSnapshot = nextSounding
    for (const listener of soundingListeners) listener(soundingSnapshot)
  }
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

export function getSoundingNotes(): Set<number> {
  return soundingSnapshot
}

export function subscribeSounding(listener: SoundingListener): () => void {
  soundingListeners.add(listener)
  return () => soundingListeners.delete(listener)
}

export function usePressedNotes(): Set<number> {
  return useSyncExternalStore(
    (onStoreChange) => subscribePressed(() => onStoreChange()),
    getPressedNotes,
  )
}
