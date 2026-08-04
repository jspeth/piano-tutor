import { useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { parseMidiFile } from './lib/midiParser'
import { PianoKeyboard } from './components/PianoKeyboard'
import type { ParsedTrack } from './types'
import './App.css'

function App() {
  const [tracks, setTracks] = useState<ParsedTrack[]>([])
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null)
  const [tempo, setTempo] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const synthRef = useRef<Tone.PolySynth | null>(null)
  const partRef = useRef<Tone.Part | null>(null)

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setError(null)
      stopPlayback()
      const parsed = await parseMidiFile(file)
      setTracks(parsed.tracks)
      setSelectedTrackIndex(parsed.tracks[0]?.index ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse MIDI file')
      setTracks([])
      setSelectedTrackIndex(null)
    }
  }

  function getSynth() {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination()
    }
    return synthRef.current
  }

  async function startPlayback() {
    if (!selectedTrack || selectedTrack.notes.length === 0) return
    await Tone.start()

    Tone.Transport.stop()
    Tone.Transport.cancel()
    partRef.current?.dispose()
    setActiveNotes(new Set())

    const synth = getSynth()
    const scaled = selectedTrack.notes.map((n) => ({
      time: n.time / tempo,
      midi: n.midi,
      name: n.name,
      duration: n.duration / tempo,
      velocity: n.velocity,
    }))

    const part = new Tone.Part((time, note) => {
      synth.triggerAttackRelease(note.name, note.duration, time, note.velocity)
      Tone.Draw.schedule(() => {
        setActiveNotes((prev) => new Set(prev).add(note.midi))
      }, time)
      Tone.Draw.schedule(() => {
        setActiveNotes((prev) => {
          const next = new Set(prev)
          next.delete(note.midi)
          return next
        })
      }, time + note.duration)
    }, scaled)

    part.start(0)
    partRef.current = part
    Tone.Transport.start()
    setIsPlaying(true)
  }

  function pausePlayback() {
    Tone.Transport.pause()
    setIsPlaying(false)
  }

  function stopPlayback() {
    Tone.Transport.stop()
    Tone.Transport.cancel()
    partRef.current?.dispose()
    partRef.current = null
    setActiveNotes(new Set())
    setIsPlaying(false)
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
                    onChange={() => {
                      stopPlayback()
                      setSelectedTrackIndex(track.index)
                    }}
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
          <button onClick={isPlaying ? pausePlayback : startPlayback}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={stopPlayback}>Stop</button>
          <label className="tempo">
            Tempo: {Math.round(tempo * 100)}%
            <input
              type="range"
              min={0.25}
              max={1.5}
              step={0.05}
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
            />
          </label>
        </section>
      )}

      <section className="panel keyboard-panel">
        <PianoKeyboard
          activeNotes={activeNotes}
          lowNote={noteRange.low}
          highNote={noteRange.high}
        />
      </section>
    </div>
  )
}

export default App
