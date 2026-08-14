import { Fragment } from 'react'
import { formatNoteName } from '../lib/noteNames'

interface NoteReadoutProps {
  pressedNotes: Set<number>
  expectedNotes?: Set<number>
  activeNotes: Map<number, number>
}

function formatNotes(notes: Set<number>): string {
  if (notes.size === 0) return '—'
  return [...notes]
    .sort((a, b) => a - b)
    .map(formatNoteName)
    .join(' · ')
}

/**
 * Renders each pressed note name individually so it can be colored by
 * whether it's in `expectedNotes` (wait mode's correct/incorrect coloring),
 * rather than as one joined string — a chord with some right and some wrong
 * notes shows mixed colors, per note.
 */
function PressedNotes({
  pressedNotes,
  expectedNotes,
}: {
  pressedNotes: Set<number>
  expectedNotes: Set<number>
}) {
  if (pressedNotes.size === 0) return <>—</>
  const midis = [...pressedNotes].sort((a, b) => a - b)
  return (
    <>
      {midis.map((midi, i) => (
        <Fragment key={midi}>
          {i > 0 && ' · '}
          <span className={expectedNotes.has(midi) ? 'note-correct' : 'note-incorrect'}>
            {formatNoteName(midi)}
          </span>
        </Fragment>
      ))}
    </>
  )
}

/**
 * Always renders both the Expected and Played columns — in listen/practice
 * mode there's no expected note, so Expected shows "—" and Played shows the
 * currently-sounding notes rather than omitting a column. This keeps the
 * row's height/layout from jumping when switching modes.
 */
export function NoteReadout({ pressedNotes, expectedNotes, activeNotes }: NoteReadoutProps) {
  const waitMode = expectedNotes !== undefined
  const anyWrong = waitMode && [...pressedNotes].some((midi) => !expectedNotes.has(midi))
  const allCorrect = waitMode && pressedNotes.size > 0 && !anyWrong

  const playedState = !waitMode ? 'neutral' : anyWrong ? 'wrong' : allCorrect ? 'correct' : 'neutral'
  const playedLabel = !waitMode ? 'PLAYING' : allCorrect ? 'CLEAN' : 'YOU PLAYED'

  return (
    <div className="note-readout">
      <div className="note-readout-expected">
        <span className="note-readout-expected-label">EXPECTED</span>
        <span className="note-readout-expected-value">
          {waitMode ? formatNotes(expectedNotes) : '—'}
        </span>
      </div>
      <div className="note-readout-divider" />
      <div className={`note-readout-played note-readout-played--${playedState}`}>
        <span className="note-readout-played-label">{playedLabel}</span>
        <span className="note-readout-played-value">
          {waitMode ? (
            <PressedNotes pressedNotes={pressedNotes} expectedNotes={expectedNotes} />
          ) : (
            formatNotes(new Set(activeNotes.keys()))
          )}
        </span>
      </div>
    </div>
  )
}
