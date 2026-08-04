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

export function NoteReadout({ pressedNotes, expectedNotes }: NoteReadoutProps) {
  return (
    <p className="note-readout">
      {expectedNotes === undefined ? (
        <span>Pressed: {formatNotes(pressedNotes)}</span>
      ) : (
        <span>Expected: {formatNotes(expectedNotes)}</span>
      )}
    </p>
  )
}
