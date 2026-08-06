import { useMemo, useRef } from 'react'
import { publish } from '../lib/noteInput'
import './PianoKeyboard.css'

const BLACK_KEY_SEMITONES = new Set([1, 3, 6, 8, 10])

function isBlackKey(midi: number): boolean {
  return BLACK_KEY_SEMITONES.has(((midi % 12) + 12) % 12)
}

const WHITE_KEY_WIDTH = 24
const BLACK_KEY_WIDTH = WHITE_KEY_WIDTH * 0.62
const WHITE_KEY_HEIGHT = 140
const BLACK_KEY_HEIGHT = 88

interface Key {
  midi: number
  black: boolean
  x: number
  width: number
}

// Maps a semitone (0-11) to the index, within its octave, of the white key
// at or immediately below it — e.g. C#(1) and D#(3) floor to C(0) and D(1).
// This gives every MIDI note a continuous "white-key" x-position formula that
// doesn't depend on which notes are actually in the visible [low, high] range,
// so a black key at the very edge of the range (whose neighboring white key
// falls outside it) still gets a sensible position instead of an undefined one.
const WHITE_INDEX_FLOOR = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]

function globalWhiteIndex(midi: number): number {
  const semitone = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12)
  return octave * 7 + WHITE_INDEX_FLOOR[semitone]
}

function generateKeys(low: number, high: number): { keys: Key[]; totalWidth: number } {
  // Anchor x=0 to the first white key at or after `low`, so a leading black
  // key (if `low` itself is black) renders partially cropped at the left
  // edge rather than shifting the rest of the keyboard over.
  const baseIndex = globalWhiteIndex(isBlackKey(low) ? low + 1 : low)

  const keys: Key[] = []
  let whiteCount = 0
  for (let m = low; m <= high; m++) {
    const idx = globalWhiteIndex(m) - baseIndex
    if (!isBlackKey(m)) {
      keys.push({ midi: m, black: false, x: idx * WHITE_KEY_WIDTH, width: WHITE_KEY_WIDTH })
      whiteCount++
    } else {
      keys.push({
        midi: m,
        black: true,
        x: idx * WHITE_KEY_WIDTH + WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2,
        width: BLACK_KEY_WIDTH,
      })
    }
  }

  return { keys, totalWidth: whiteCount * WHITE_KEY_WIDTH }
}

/** Hit-tests a point against the key geometry: checks black keys first when
 * y is within the black-key band, else falls back to white keys by x. */
function hitTest(keys: Key[], x: number, y: number): number | null {
  if (y < 0 || y > WHITE_KEY_HEIGHT) return null
  if (y <= BLACK_KEY_HEIGHT) {
    for (const k of keys) {
      if (k.black && x >= k.x && x < k.x + k.width) return k.midi
    }
  }
  for (const k of keys) {
    if (!k.black && x >= k.x && x < k.x + k.width) return k.midi
  }
  return null
}

interface PianoKeyboardProps {
  activeNotes: Set<number>
  pressedNotes?: Set<number>
  expectedNotes?: Set<number>
  feedbackNotes?: Map<number, 'correct' | 'incorrect'>
  lowNote?: number
  highNote?: number
}

export function PianoKeyboard({
  activeNotes,
  pressedNotes,
  expectedNotes,
  feedbackNotes,
  lowNote = 21,
  highNote = 108,
}: PianoKeyboardProps) {
  const { keys, totalWidth } = useMemo(() => generateKeys(lowNote, highNote), [lowNote, highNote])
  const whiteKeys = keys.filter((k) => !k.black)
  const blackKeys = keys.filter((k) => k.black)
  const pointerMidiRef = useRef(new Map<number, number>())

  const classFor = (midi: number, black: boolean) => {
    const classes = ['key', black ? 'black' : 'white']
    const feedback = feedbackNotes?.get(midi)
    if (feedback === 'incorrect') classes.push('incorrect')
    else if (feedback === 'correct') classes.push('correct')
    else if (activeNotes.has(midi)) classes.push('active')
    else if (pressedNotes?.has(midi)) classes.push('pressed')
    else if (expectedNotes?.has(midi)) classes.push('expected')
    return classes.join(' ')
  }

  function pointFromEvent(svg: SVGSVGElement, e: React.PointerEvent<SVGSVGElement>) {
    const rect = svg.getBoundingClientRect()
    const scaleX = totalWidth / rect.width
    const scaleY = WHITE_KEY_HEIGHT / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function releasePointer(pointerId: number) {
    const midi = pointerMidiRef.current.get(pointerId)
    if (midi === undefined) return
    pointerMidiRef.current.delete(pointerId)
    publish({ type: 'noteoff', midi, source: 'mouse' })
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return
    const svg = e.currentTarget
    const { x, y } = pointFromEvent(svg, e)
    const midi = hitTest(keys, x, y)
    if (midi === null) return
    svg.setPointerCapture(e.pointerId)
    pointerMidiRef.current.set(e.pointerId, midi)
    publish({ type: 'noteon', midi, source: 'mouse' })
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const current = pointerMidiRef.current.get(e.pointerId)
    if (current === undefined) return
    const { x, y } = pointFromEvent(e.currentTarget, e)
    const midi = hitTest(keys, x, y)
    if (midi === current) return
    publish({ type: 'noteoff', midi: current, source: 'mouse' })
    if (midi !== null) {
      pointerMidiRef.current.set(e.pointerId, midi)
      publish({ type: 'noteon', midi, source: 'mouse' })
    } else {
      pointerMidiRef.current.delete(e.pointerId)
    }
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    releasePointer(e.pointerId)
  }

  function handlePointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    releasePointer(e.pointerId)
  }

  function handleLostPointerCapture(e: React.PointerEvent<SVGSVGElement>) {
    releasePointer(e.pointerId)
  }

  return (
    <svg
      className="piano-keyboard"
      width={totalWidth}
      height={WHITE_KEY_HEIGHT}
      viewBox={`0 0 ${totalWidth} ${WHITE_KEY_HEIGHT}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      {whiteKeys.map((k) => (
        <rect
          key={k.midi}
          x={k.x}
          y={0}
          width={k.width - 1}
          height={WHITE_KEY_HEIGHT}
          className={classFor(k.midi, false)}
        />
      ))}
      {blackKeys.map((k) => (
        <rect
          key={k.midi}
          x={k.x}
          y={0}
          width={k.width}
          height={BLACK_KEY_HEIGHT}
          className={classFor(k.midi, true)}
        />
      ))}
    </svg>
  )
}
