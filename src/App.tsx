import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseMidiFile } from './lib/midiParser'
import { player, type Region } from './lib/player'
import { subscribePressed, usePressedNotes } from './lib/noteInput'
import { midiToNoteName } from './lib/noteNames'
import { useComputerKeyboardInput } from './hooks/useComputerKeyboardInput'
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
  const [error, setError] = useState<string | null>(null)

  const pressedNotes = usePressedNotes()
  const baseOctave = useComputerKeyboardInput()

  useEffect(() => {
    player.onActiveNotesChange = setActiveNotes
    player.onPlayStateChange = setIsPlaying
    return () => {
      player.onActiveNotesChange = undefined
      player.onPlayStateChange = undefined
    }
  }, [])

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

  return (
    <div className="app">
      <h1>Piano Tutor</h1>

      <section className="panel">
        <label className="file-input">
          Load MIDI file
          <input type="file" accept=".mid,.midi" onChange={handleFileChange} />
        </label>
        {error && <p className="error">{error}</p>}
      </section>

      {tracks.length > 0 && (
        <section className="panel">
          <h2>Parts</h2>
          <ul className="track-list">
            {tracks.map((track) => (
              <li key={track.index}>
                <label>
                  <input
                    type="radio"
                    name="track"
                    checked={selectedTrackIndex === track.index}
                    onChange={() => setSelectedTrackIndex(track.index)}
                  />
                  {track.name} &mdash; {track.instrument} ({track.notes.length} notes)
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selectedTrack && (
        <section className="panel controls">
          <button onClick={() => (isPlaying ? player.pause() : player.play())}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => player.stop()}>Stop</button>
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
        </section>
      )}

      {selectedTrack && (
        <section className="panel">
          <PianoRoll
            notes={selectedTrack.notes}
            duration={trackDuration}
            lowNote={noteRange.low}
            highNote={noteRange.high}
            region={region}
            onRegionChange={handleRegionChange}
            getPlayheadTime={() => player.getSongTime()}
            isPlaying={isPlaying}
          />
          <p className="hint">
            Drag on the roll to select a practice region (playback loops it). Drag a
            region edge to adjust; click anywhere to clear.
          </p>
        </section>
      )}

      <section className="panel keyboard-panel">
        <PianoKeyboard
          activeNotes={activeNotes}
          pressedNotes={pressedNotes}
          lowNote={noteRange.low}
          highNote={noteRange.high}
        />
        <NoteReadout pressedNotes={pressedNotes} />
        <p className="hint">
          Octave: {midiToNoteName((baseOctave + 1) * 12)} (Z/X to shift)
        </p>
      </section>
    </div>
  )
}

export default App
