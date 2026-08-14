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
import { isFormTarget, useComputerKeyboardInput } from './hooks/useComputerKeyboardInput'
import { useWebMidiInput } from './hooks/useWebMidiInput'
import { PianoKeyboard } from './components/PianoKeyboard'
import { PianoRoll, type RollLane } from './components/PianoRoll'
import { NoteReadout } from './components/NoteReadout'
import { laneSelectionReducer, noteRangeFor, type LaneAction, type LaneSelection } from './lib/laneSelection'
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
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set())
  const [region, setRegion] = useState<Region | null>(null)
  const [mode, setMode] = useState<PlaybackMode>('listen')
  const [expectedNotes, setExpectedNotes] = useState<Set<number> | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [instrumentLoaded, setInstrumentLoaded] = useState(isInstrumentLoaded)
  const [instrumentError, setInstrumentError] = useState(() => !!getInstrumentLoadError())
  const [feedbackNotes, setFeedbackNotes] = useState<Map<number, 'correct' | 'incorrect'>>(new Map())
  const [showFullKeyboard, setShowFullKeyboard] = useState(false)

  const pressedNotes = usePressedNotes()
  const { baseOctave, layout, setLayout } = useComputerKeyboardInput()
  const midiStatus = useWebMidiInput()
  const feedbackTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isFormTarget(e.target)) return
      e.preventDefault()
      if (isPlaying) player.pause()
      else if (instrumentLoaded) void player.play()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, instrumentLoaded])

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

  const noteRange = useMemo(() => {
    if (laneRanges.length === 0) return { low: 21, high: 108 }
    return {
      low: Math.min(...laneRanges.map((r) => r.low)),
      high: Math.max(...laneRanges.map((r) => r.high)),
    }
  }, [laneRanges])

  const keyboardNoteRange = showFullKeyboard ? { low: 21, high: 108 } : noteRange

  const trackDuration = useMemo(
    () =>
      laneTracks.reduce(
        (end, t) => t.notes.reduce((e, n) => Math.max(e, n.time + n.duration), end),
        0,
      ),
    [laneTracks],
  )

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
      <header className="header">
        <h1>Piano Tutor</h1>
        <label className="file-input">
          <span>Load MIDI file</span>
          <input type="file" accept=".mid,.midi" onChange={handleFileChange} />
        </label>
        {error && <p className="error">{error}</p>}
      </header>

      {laneTracks.length > 0 && (
        <section className="panel controls">
          <button
            className="play-pause"
            disabled={!instrumentLoaded}
            onClick={() => (isPlaying ? player.pause() : player.play())}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => player.stop()}>Stop</button>
          {!instrumentLoaded && (
            <span className="hint">
              {instrumentError ? 'Failed to load piano sound. Try reloading the page.' : 'Loading piano…'}
            </span>
          )}
          <div className="mode-toggle" role="group" aria-label="Playback mode">
            <button
              className={mode === 'listen' ? 'active' : ''}
              onClick={() => handleModeChange('listen')}
            >
              Listen
            </button>
            <button
              className={mode === 'practice' ? 'active' : ''}
              onClick={() => handleModeChange('practice')}
            >
              Practice
            </button>
            <button
              className={mode === 'wait' ? 'active' : ''}
              onClick={() => handleModeChange('wait')}
            >
              Wait
            </button>
          </div>
          <label className="tempo">
            Tempo: {Math.round(tempo * 100)}%
            <input
              type="range"
              min={0.25}
              max={1.5}
              step={0.05}
              value={tempo}
              onChange={(e) => handleTempoChange(Number(e.target.value))}
            />
          </label>
          {region && (
            <span className="region-info">
              Loop: {region.start.toFixed(1)}s &ndash; {region.end.toFixed(1)}s
              <button onClick={() => handleRegionChange(null)}>Clear</button>
            </span>
          )}
          <label className="full-keyboard-toggle">
            <input
              type="checkbox"
              checked={showFullKeyboard}
              onChange={(e) => setShowFullKeyboard(e.target.checked)}
            />
            Full keyboard
          </label>
          {tracks.length > 0 && (
            <div className="track-chips" role="group" aria-label="Tracks">
              {tracks.map((track) => {
                const isFocused = selection?.focus === track.index
                const isSelected = selection?.lanes.includes(track.index) ?? false
                const className = isFocused ? 'active' : isSelected ? 'selected' : ''
                return (
                  <button
                    key={track.index}
                    className={className}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        dispatchLaneAction({ type: 'toggle', trackIndex: track.index })
                      } else {
                        dispatchLaneAction({ type: 'solo', trackIndex: track.index })
                      }
                    }}
                  >
                    {track.name} &mdash; {track.instrument} ({track.notes.length} notes)
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {laneTracks.length > 0 && selection && (
        <section className="panel piano-roll-panel">
          <PianoRoll
            key={fileGeneration}
            lanes={rollLanes}
            focusedTrackIndex={selection.focus}
            duration={trackDuration}
            region={region}
            onRegionChange={handleRegionChange}
            onSeek={(t) => player.seek(t)}
            getPlayheadTime={() => player.getSongTime()}
            isPlaying={isPlaying}
          />
          <p className="hint">
            Drag to select a practice loop; drag an edge to resize, click to clear, tap to seek.
          </p>
        </section>
      )}

      <section className="panel keyboard-panel">
        <div className="keyboard-scroll">
          <PianoKeyboard
            activeNotes={activeNotes}
            pressedNotes={pressedNotes}
            feedbackNotes={feedbackNotes}
            lowNote={keyboardNoteRange.low}
            highNote={keyboardNoteRange.high}
          />
        </div>
        <NoteReadout pressedNotes={pressedNotes} expectedNotes={expectedNotes} activeNotes={activeNotes} />
        <div className="mode-toggle" role="group" aria-label="Computer keyboard layout">
          <button className={layout === 'daw' ? 'active' : ''} onClick={() => setLayout('daw')}>
            DAW
          </button>
          <button
            className={layout === 'two-hand' ? 'active' : ''}
            onClick={() => setLayout('two-hand')}
          >
            Two-Hand
          </button>
        </div>
        <p className="hint status-row">
          <span>Octave: {midiToNoteName((baseOctave + 1) * 12)} (Z/X to shift)</span>
          <span>
            {!midiStatus.supported && 'MIDI: not supported in this browser'}
            {midiStatus.supported &&
              midiStatus.enabled &&
              (midiStatus.inputNames.length > 0
                ? `MIDI: connected (${midiStatus.inputNames.join(', ')})`
                : 'MIDI: enabled, no device connected')}
            {midiStatus.supported &&
              !midiStatus.enabled &&
              (midiStatus.error ? `MIDI: ${midiStatus.error}` : 'MIDI: connecting…')}
          </span>
        </p>
      </section>
    </div>
  )
}

export default App
