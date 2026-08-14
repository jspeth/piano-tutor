import { useMemo, useRef } from 'react'
import { publish } from '../lib/noteInput'
import { midiToNoteName } from '../lib/noteNames'
import { trackColorVars } from '../lib/trackColors'
import './PianoKeyboard.css'

const BLACK_KEY_SEMITONES = new Set([1, 3, 6, 8, 10])

function isBlackKey(midi: number): boolean {
  return BLACK_KEY_SEMITONES.has(((midi % 12) + 12) % 12)
}

function isC(midi: number): boolean {
  return ((midi % 12) + 12) % 12 === 0
}

const WHITE_KEY_WIDTH = 28
const BLACK_KEY_WIDTH = WHITE_KEY_WIDTH * 0.66
const WHITE_KEY_HEIGHT = 116
const BLACK_KEY_HEIGHT = 72

// Corner rounding is bottom-only (per the design handoff), which an SVG
// `<rect>` can't express directly (`rx`/`ry` round all four corners
// uniformly). The trick: draw each key's rect extended upward past y=0 by
// more than its own `rx`, so the would-be-rounded top corners fall entirely
// outside the SVG's viewBox/viewport (which clips to it by default) and only
// the bottom corners' rounding is ever visible. `hitTest`/`pointFromEvent`
// are untouched by this — they only reason about the logical key geometry
// (`Key.x`/`width` and the height constants above), not this rendering
// overhang.
const CORNER_OVERHANG = 4
const WHITE_KEY_RADIUS = 3
const BLACK_KEY_RADIUS = 2

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
  activeNotes: Map<number, number>
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

  // Fill state stays a strict, mutually-exclusive if/else chain (unchanged
  // from before this pass) — a key never carries two fill classes. `expected`
  // is layered on independently as a *ring*, not part of that chain, because
  // the handoff requires it to survive on top of any fill state (most
  // notably: "play a wrong note and the key turns red, but the green
  // expected ring stays" — ring and fill must be able to coexist).
  const fillClassFor = (midi: number): string | null => {
    const feedback = feedbackNotes?.get(midi)
    if (feedback === 'incorrect') return 'incorrect'
    if (feedback === 'correct') return 'correct'
    if (activeNotes.has(midi)) return 'active'
    if (pressedNotes?.has(midi)) return 'pressed'
    return null
  }

  const classFor = (midi: number, black: boolean) => {
    const classes = ['key', black ? 'black' : 'white']
    const fillClass = fillClassFor(midi)
    if (fillClass) classes.push(fillClass)
    if (expectedNotes?.has(midi)) classes.push('expected')
    return classes.join(' ')
  }

  const styleFor = (midi: number): React.CSSProperties | undefined => {
    // Only threads a track color in for the plain "active" state — feedback
    // (correct/incorrect) keeps its own flat colors and takes precedence,
    // same ordering as `classFor` above.
    if (feedbackNotes?.has(midi)) return undefined
    const trackIndex = activeNotes.get(midi)
    return trackIndex !== undefined ? trackColorVars(trackIndex) : undefined
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
    <div className="piano-keybed" style={{ width: totalWidth }}>
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
        <defs>
          {/* Black keys' idle fill is a subtle top-to-bottom gradient per the
              handoff; state colors (active/pressed/correct/incorrect) still
              override it with a flat fill via the class rules in the CSS. */}
          <linearGradient id="piano-key-black-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--key-black-top)" />
            <stop offset="1" stopColor="var(--key-black-bottom)" />
          </linearGradient>
        </defs>
        {whiteKeys.map((k) => (
          <rect
            key={k.midi}
            x={k.x}
            y={-CORNER_OVERHANG}
            width={k.width - 1}
            height={WHITE_KEY_HEIGHT + CORNER_OVERHANG}
            rx={WHITE_KEY_RADIUS}
            className={classFor(k.midi, false)}
            style={styleFor(k.midi)}
          />
        ))}
        {blackKeys.map((k) => (
          <rect
            key={k.midi}
            x={k.x}
            y={-CORNER_OVERHANG}
            width={k.width}
            height={BLACK_KEY_HEIGHT + CORNER_OVERHANG}
            rx={BLACK_KEY_RADIUS}
            className={classFor(k.midi, true)}
            style={styleFor(k.midi)}
          />
        ))}
        {/* A dedicated, non-overhanging rect per expected key so the ring's
            stroke isn't clipped on top by the fill rects' corner overhang
            (see CORNER_OVERHANG above) — renders on top of every fill state. */}
        {keys
          .filter((k) => expectedNotes?.has(k.midi))
          .map((k) => (
            <rect
              key={`ring-${k.midi}`}
              x={k.x}
              y={0}
              width={k.black ? k.width : k.width - 1}
              height={k.black ? BLACK_KEY_HEIGHT : WHITE_KEY_HEIGHT}
              rx={k.black ? BLACK_KEY_RADIUS : WHITE_KEY_RADIUS}
              className="key-ring"
            />
          ))}
        {whiteKeys
          .filter((k) => isC(k.midi))
          .map((k) => (
            <text
              key={`label-${k.midi}`}
              x={k.x + k.width / 2}
              y={WHITE_KEY_HEIGHT - 6}
              textAnchor="middle"
              className={`key-label${fillClassFor(k.midi) ? ' on' : ''}`}
              pointerEvents="none"
            >
              {midiToNoteName(k.midi)}
            </text>
          ))}
      </svg>
    </div>
  )
}
