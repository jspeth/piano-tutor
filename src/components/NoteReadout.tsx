import { Fragment } from 'react'
import { midiToNoteName } from '../lib/noteNames'

interface NoteReadoutProps {
  pressedNotes: Set<number>
  expectedNotes?: Set<number>
}

function formatNotes(notes: Set<number>): string {
  if (notes.size === 0) return '—'
  return [...notes]
    .sort((a, b) => a - b)
    .map(midiToNoteName)
    .join(' · ')
}

/**
 * Renders each pressed note name individually so it can be colored by
 * whether it's in `expectedNotes` (wait mode's correct/incorrect coloring),
 * rather than as one joined string.
 */
function PressedNotes({ pressedNotes, expectedNotes }: { pressedNotes: Set<number>; expectedNotes: Set<number> }) {
  if (pressedNotes.size === 0) return <>—</>
  const midis = [...pressedNotes].sort((a, b) => a - b)
  return (
    <>
      {midis.map((midi, i) => (
        <Fragment key={midi}>
          {i > 0 && ' · '}
          <span className={expectedNotes.has(midi) ? 'note-correct' : 'note-incorrect'}>
            {midiToNoteName(midi)}
          </span>
        </Fragment>
      ))}
    </>
  )
}

export function NoteReadout({ pressedNotes, expectedNotes }: NoteReadoutProps) {
  return (
    <p className="note-readout">
      {expectedNotes === undefined ? (
        <span>Pressed: {formatNotes(pressedNotes)}</span>
      ) : (
        <span>
          Expected: {formatNotes(expectedNotes)} | Pressed:{' '}
          <PressedNotes pressedNotes={pressedNotes} expectedNotes={expectedNotes} />
        </span>
      )}
    </p>
  )
}
