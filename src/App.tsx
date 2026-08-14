import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { parseMidiFile } from './lib/midiParser'
import { player, type PlaybackMode, type Region } from './lib/player'
import { subscribePressed, usePressedNotes } from './lib/noteInput'
import {
  getInstrumentLoadError,
  isInstrumentLoaded,
  subscribeInstrumentLoaded,
  subscribeInstrumentLoadError,
} from './lib/instrument'
import { midiToNoteName } from './lib/noteNames'
import { useComputerKeyboardInput } from './hooks/useComputerKeyboardInput'
import { useWebMidiInput } from './hooks/useWebMidiInput'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { PianoKeyboard } from './components/PianoKeyboard'
import { PianoRoll, type RollLane } from './components/PianoRoll'
import { NoteReadout } from './components/NoteReadout'
import { EmptyState } from './components/EmptyState'
import { Toolbar } from './components/Toolbar'
import { TrackChips } from './components/TrackChips'
import {
  keyboardRangeFor,
  laneSelectionReducer,
  noteRangeFor,
  type LaneAction,
  type LaneSelection,
} from './lib/laneSelection'
import type { ParsedTrack } from './types'
import './App.css'

/**
 * Wraps `laneSelectionReducer` to allow a `null` state (no file loaded yet).
 * `solo` never reads the previous state, so it's safe to dispatch it to seed
 * the initial selection right after a file loads; any other action while
 * `state` is null is a no-op (the track chips aren't rendered without a
 * selection, so this shouldn't normally happen).
 */
type SelectionAction = LaneAction | { type: 'clear' }

function selectionReducer(state: LaneSelection | null, action: SelectionAction): LaneSelection | null {
  if (action.type === 'clear') return null
  if (action.type === 'solo') return laneSelectionReducer({ lanes: [], focus: -1 }, action)
  if (!state) return state
  return laneSelectionReducer(state, action)
}

function App() {
  const [tracks, setTracks] = useState<ParsedTrack[]>([])
  const [selection, dispatchLaneAction] = useReducer(
    selectionReducer,
    null as LaneSelection | null,
  )
  const [fileGeneration, setFileGeneration] = useState(0)
  const [tempo, setTempo] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeNotes, setActiveNotes] = useState<Map<number, number>>(new Map())
  const [region, setRegion] = useState<Region | null>(null)
  const [mode, setMode] = useState<PlaybackMode>('listen')
  const [expectedNotes, setExpectedNotes] = useState<Set<number> | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [instrumentLoaded, setInstrumentLoaded] = useState(isInstrumentLoaded)
  const [instrumentError, setInstrumentError] = useState(() => !!getInstrumentLoadError())
  const [feedbackNotes, setFeedbackNotes] = useState<Map<number, 'correct' | 'incorrect'>>(new Map())
  const [showFullKeyboard, setShowFullKeyboard] = useState(false)
  const [songName, setSongName] = useState<string | null>(null)
  const [bpm, setBpm] = useState<number | undefined>(undefined)
  const [songDuration, setSongDuration] = useState(0)

  const pressedNotes = usePressedNotes()
  const { baseOctave, layout, setLayout } = useComputerKeyboardInput()
  const midiStatus = useWebMidiInput()
  const feedbackTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  // Shared by the toolbar's trigger and the empty-state's trigger, so both
  // can open the same native file picker without duplicating the input.
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => subscribeInstrumentLoaded(setInstrumentLoaded), [])
  useEffect(() => subscribeInstrumentLoadError(() => setInstrumentError(true)), [])

  useEffect(() => {
    const timers = feedbackTimersRef.current
    player.onActiveNotesChange = setActiveNotes
    player.onPlayStateChange = setIsPlaying
    player.onExpectedNotesChange = (notes) => setExpectedNotes(notes ?? undefined)
    player.onNoteFeedback = (midi, kind) => {
      const existing = timers.get(midi)
      if (existing) clearTimeout(existing)
      setFeedbackNotes((prev) => {
        const next = new Map(prev)
        next.set(midi, kind)
        return next
      })
      timers.set(
        midi,
        setTimeout(() => {
          timers.delete(midi)
          setFeedbackNotes((prev) => {
            if (!prev.has(midi)) return prev
            const next = new Map(prev)
            next.delete(midi)
            return next
          })
        }, 400),
      )
    }
    return () => {
      player.onActiveNotesChange = undefined
      player.onPlayStateChange = undefined
      player.onExpectedNotesChange = undefined
      player.onNoteFeedback = undefined
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // Leaving wait mode (expectedNotes -> undefined) must not let a stale
  // flash linger into another mode.
  useEffect(() => {
    if (expectedNotes !== undefined) return
    for (const timer of feedbackTimersRef.current.values()) clearTimeout(timer)
    feedbackTimersRef.current.clear()
    setFeedbackNotes(new Map())
  }, [expectedNotes])

  // Sounds the synth for live input (mouse/computer keyboard) by diffing
  // pressed-set transitions: 0->1 attacks that midi, 1->0 releases it.
  useEffect(() => {
    let prev = new Set<number>()
    return subscribePressed((pressed) => {
      for (const midi of pressed) {
        if (!prev.has(midi)) player.attack(midi)
      }
      for (const midi of prev) {
        if (!pressed.has(midi)) player.release(midi)
      }
      prev = pressed
    })
  }, [])

  useAppShortcuts({
    isPlaying,
    instrumentLoaded,
    onPlayPause: () => (isPlaying ? player.pause() : void player.play()),
    onOpenFile: () => fileInputRef.current?.click(),
  })

  // Selected lanes, in selection order, and the one that drives the
  // readout/wait-mode logic.
  const laneTracks = useMemo(
    () =>
      selection
        ? (selection.lanes.map((i) => tracks.find((t) => t.index === i)).filter(Boolean) as ParsedTrack[])
        : [],
    [tracks, selection],
  )

  const laneRanges = useMemo(() => laneTracks.map((t) => noteRangeFor(t.notes)), [laneTracks])

  const noteRange = useMemo(() => keyboardRangeFor(laneRanges), [laneRanges])

  const keyboardNoteRange = showFullKeyboard ? { low: 21, high: 108 } : noteRange

  const rollLanes: RollLane[] = useMemo(
    () =>
      laneTracks.map((t, i) => ({
        trackIndex: t.index,
        name: t.name,
        notes: t.notes,
        lowNote: laneRanges[i].low,
        highNote: laneRanges[i].high,
      })),
    [laneTracks, laneRanges],
  )

  useEffect(() => {
    if (!selection) return
    player.setLanes(
      laneTracks.map((t) => ({ trackIndex: t.index, notes: t.notes })),
      selection.focus,
    )
  }, [laneTracks, selection])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // A new file load resets everything, including an in-progress wait
    // session — `setLanes`'s "keep an active wait session running through
    // lane changes" contract is scoped to the *same* loaded file, not
    // across a file swap. `stop()` also disposes any stale `Tone.Part` and
    // clears the transport before the lane-selection effect below runs.
    player.stop()
    try {
      setError(null)
      const parsed = await parseMidiFile(file)
      setTracks(parsed.tracks)
      setSongName(file.name.replace(/\.[^./]+$/, ''))
      setBpm(parsed.bpm)
      setSongDuration(parsed.duration)
      const firstIndex = parsed.tracks[0]?.index
      if (firstIndex !== undefined) {
        dispatchLaneAction({ type: 'solo', trackIndex: firstIndex })
      } else {
        dispatchLaneAction({ type: 'clear' })
      }
      setFileGeneration((g) => g + 1)
      setRegion(null)
      player.setRegion(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse MIDI file')
      setTracks([])
      setSongName(null)
      setBpm(undefined)
      setSongDuration(0)
      dispatchLaneAction({ type: 'clear' })
      setFileGeneration((g) => g + 1)
      setRegion(null)
      player.setRegion(null)
    }
  }

  const handleRegionChange = useCallback((r: Region | null, commit = true) => {
    setRegion(r)
    player.setRegion(r, commit)
  }, [])

  // Stable identity so TimeReadout/PianoRoll's per-frame subscription isn't
  // torn down and rebuilt on every App re-render (player is a module-level
  // singleton, so this never needs to change).
  const getSongTime = useCallback(() => player.getSongTime(), [])

  function handleTempoChange(value: number) {
    setTempo(value)
    player.setTempo(value)
  }

  function handleModeChange(next: PlaybackMode) {
    setMode(next)
    player.setMode(next)
  }

  return (
    <div className="app">
      {/* Hidden native file input, shared by the toolbar button and the
          empty-state button — both just call fileInputRef.current?.click(). */}
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".mid,.midi"
        onChange={handleFileChange}
      />

      <Toolbar
        songName={songName}
        partCount={tracks.length}
        error={error}
        onOpenFile={() => fileInputRef.current?.click()}
        isPlaying={isPlaying}
        instrumentLoaded={instrumentLoaded}
        instrumentError={instrumentError}
        onPlayPause={() => (isPlaying ? player.pause() : void player.play())}
        onStop={() => player.stop()}
        region={region}
        onClearRegion={() => handleRegionChange(null)}
        getSongTime={getSongTime}
        duration={songDuration}
        mode={mode}
        onModeChange={handleModeChange}
        tempo={tempo}
        onTempoChange={handleTempoChange}
        bpm={bpm}
        showFullKeyboard={showFullKeyboard}
        onToggleFullKeyboard={() => setShowFullKeyboard((v) => !v)}
        midiStatus={midiStatus}
      />

      <TrackChips
        tracks={tracks}
        selection={selection}
        onSelect={(trackIndex, additive) =>
          dispatchLaneAction(
            additive ? { type: 'toggle', trackIndex } : { type: 'solo', trackIndex },
          )
        }
      />

      <div className="roll-area">
        {laneTracks.length > 0 && selection ? (
          <PianoRoll
            key={fileGeneration}
            lanes={rollLanes}
            focusedTrackIndex={selection.focus}
            duration={songDuration}
            region={region}
            onRegionChange={handleRegionChange}
            onSeek={(t) => player.seek(t)}
            getPlayheadTime={getSongTime}
            isPlaying={isPlaying}
          />
        ) : (
          <EmptyState onOpenFile={() => fileInputRef.current?.click()} />
        )}
      </div>

      <div className="keyboard-band">
        <div className="keyboard-scroll">
          <PianoKeyboard
            activeNotes={activeNotes}
            pressedNotes={pressedNotes}
            expectedNotes={expectedNotes}
            feedbackNotes={feedbackNotes}
            lowNote={keyboardNoteRange.low}
            highNote={keyboardNoteRange.high}
          />
        </div>
      </div>

      <div className="readout-row">
        <div className="readout-left">
          <p>Drag to select a practice loop; drag an edge to resize, click to clear, tap to seek.</p>
          <p>
            {region
              ? `Loop ${region.start.toFixed(1)}s – ${region.end.toFixed(1)}s`
              : 'No practice loop set'}
          </p>
        </div>

        <NoteReadout pressedNotes={pressedNotes} expectedNotes={expectedNotes} activeNotes={activeNotes} />

        <div className="readout-right">
          <p>
            On-screen octave{' '}
            <span className="readout-mono">{midiToNoteName((baseOctave + 1) * 12)}</span> · Z / X to
            shift
          </p>
          <div className="readout-right-bottom">
            <span className="readout-mono">
              {keyboardNoteRange.high - keyboardNoteRange.low + 1} keys ·{' '}
              {midiToNoteName(keyboardNoteRange.low)}–{midiToNoteName(keyboardNoteRange.high)}
            </span>
            <div className="readout-layout-toggle" role="group" aria-label="Computer keyboard layout">
              <button
                type="button"
                className={layout === 'daw' ? 'active' : ''}
                onClick={() => setLayout('daw')}
              >
                DAW
              </button>
              <button
                type="button"
                className={layout === 'two-hand' ? 'active' : ''}
                onClick={() => setLayout('two-hand')}
              >
                Two-Hand
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
