import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { PianoRoll } from './components/PianoRoll'
import { NoteReadout } from './components/NoteReadout'
import type { ParsedTrack } from './types'
import './App.css'

function App() {
  const [tracks, setTracks] = useState<ParsedTrack[]>([])
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null)
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

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.index === selectedTrackIndex) ?? null,
    [tracks, selectedTrackIndex],
  )

  const noteRange = useMemo(() => {
    if (!selectedTrack || selectedTrack.notes.length === 0) return { low: 21, high: 108 }
    const midis = selectedTrack.notes.map((n) => n.midi)
    return {
      low: Math.max(21, Math.min(...midis) - 2),
      high: Math.min(108, Math.max(...midis) + 2),
    }
  }, [selectedTrack])

  const trackDuration = useMemo(
    () => selectedTrack?.notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0) ?? 0,
    [selectedTrack],
  )

  useEffect(() => {
    player.setNotes(selectedTrack?.notes ?? [])
    setRegion(null)
    player.setRegion(null)
  }, [selectedTrack])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setError(null)
      const parsed = await parseMidiFile(file)
      setTracks(parsed.tracks)
      setSelectedTrackIndex(parsed.tracks[0]?.index ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse MIDI file')
      setTracks([])
      setSelectedTrackIndex(null)
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

      {selectedTrack && (
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
          {tracks.length > 0 && (
            <label className="parts-select">
              Part:
              <select
                value={selectedTrackIndex ?? ''}
                onChange={(e) => setSelectedTrackIndex(Number(e.target.value))}
              >
                {tracks.map((track) => (
                  <option key={track.index} value={track.index}>
                    {track.name} &mdash; {track.instrument} ({track.notes.length} notes)
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {selectedTrack && (
        <section className="panel piano-roll-panel">
          <PianoRoll
            notes={selectedTrack.notes}
            duration={trackDuration}
            lowNote={noteRange.low}
            highNote={noteRange.high}
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
            lowNote={noteRange.low}
            highNote={noteRange.high}
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
