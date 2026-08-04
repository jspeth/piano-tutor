import { useMemo } from 'react'
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

function generateKeys(low: number, high: number): { keys: Key[]; totalWidth: number } {
  const whiteX = new Map<number, number>()
  let whiteIndex = 0
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) {
      whiteX.set(m, whiteIndex * WHITE_KEY_WIDTH)
      whiteIndex++
    }
  }

  const keys: Key[] = []
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) {
      keys.push({ midi: m, black: false, x: whiteX.get(m)!, width: WHITE_KEY_WIDTH })
    } else {
      const prevWhiteX = whiteX.get(m - 1)!
      keys.push({ midi: m, black: true, x: prevWhiteX + WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2, width: BLACK_KEY_WIDTH })
    }
  }

  return { keys, totalWidth: whiteIndex * WHITE_KEY_WIDTH }
}

interface PianoKeyboardProps {
  activeNotes: Set<number>
  expectedNotes?: Set<number>
  lowNote?: number
  highNote?: number
}

export function PianoKeyboard({
  activeNotes,
  expectedNotes,
  lowNote = 21,
  highNote = 108,
}: PianoKeyboardProps) {
  const { keys, totalWidth } = useMemo(() => generateKeys(lowNote, highNote), [lowNote, highNote])
  const whiteKeys = keys.filter((k) => !k.black)
  const blackKeys = keys.filter((k) => k.black)

  const classFor = (midi: number, black: boolean) => {
    const classes = ['key', black ? 'black' : 'white']
    if (activeNotes.has(midi)) classes.push('active')
    else if (expectedNotes?.has(midi)) classes.push('expected')
    return classes.join(' ')
  }

  return (
    <svg
      className="piano-keyboard"
      width={totalWidth}
      height={WHITE_KEY_HEIGHT}
      viewBox={`0 0 ${totalWidth} ${WHITE_KEY_HEIGHT}`}
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
