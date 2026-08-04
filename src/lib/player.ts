import * as Tone from 'tone'
import type { ParsedNote } from '../types'

export interface Region {
  start: number
  end: number
}

export type PlaybackMode = 'listen' | 'practice'

// A same-pitch note that immediately follows another would otherwise light
// the key on, off, and back on again within a single scheduled tick, which
// React (and the eye) coalesces into one continuous press. Delaying its
// "key lit" draw call by this long (but never past the note's own end)
// guarantees the "off" frame is rendered before the "on" one, so a repeated
// note visibly blinks off and back on instead of looking like one sustain.
const RETRIGGER_BLINK_SEC = 0.06

/** Notes whose pitch was also played by an earlier note (in time). */
function findRetriggers(notes: ParsedNote[]): Set<ParsedNote> {
  const lastByPitch = new Map<number, ParsedNote>()
  const retriggers = new Set<ParsedNote>()
  for (const note of [...notes].sort((a, b) => a.time - b.time)) {
    if (lastByPitch.has(note.midi)) retriggers.add(note)
    lastByPitch.set(note.midi, note)
  }
  return retriggers
}

interface NoteEvent {
  time: number
  note: ParsedNote
}

/**
 * Owns the Tone.js Transport, synth, and scheduled Part. All public times are
 * in song seconds; the single song-time ↔ transport-time conversion is
 * `transport = song / tempo`. Loop points and the playhead both go through it.
 */
class Player {
  onActiveNotesChange?: (notes: Set<number>) => void
  onPlayStateChange?: (playing: boolean) => void

  private synth: Tone.PolySynth | null = null
  private part: Tone.Part<NoteEvent> | null = null
  private notes: ParsedNote[] = []
  private songEnd = 0
  private tempo = 1
  private region: Region | null = null
  private activeNotes = new Set<number>()
  private playing = false
  private pendingAttacks = new Map<number, Promise<void>>()
  private mode: PlaybackMode = 'listen'

  /**
   * In 'practice' mode, scheduled playback still moves the playhead and
   * lights up the keys (`activeNotes`), but doesn't sound the synth — only
   * the player's own key presses (via `attack`/`release`) do.
   */
  setMode(mode: PlaybackMode) {
    this.mode = mode
  }

  setNotes(notes: ParsedNote[]) {
    this.stop()
    this.notes = notes
    this.songEnd = notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0)
  }

  /** Sounds a note from live (non-playback) input, e.g. mouse or computer keyboard. */
  attack(midi: number) {
    const started = Tone.start().then(() => {
      this.getSynth().triggerAttack(Tone.Frequency(midi, 'midi').toNote(), Tone.now(), 0.8)
    })
    this.pendingAttacks.set(midi, started)
    void started.then(() => {
      if (this.pendingAttacks.get(midi) === started) this.pendingAttacks.delete(midi)
    })
  }

  /**
   * Releases a note previously started via `attack`. If the AudioContext
   * hasn't finished starting yet, waits for that note's `attack` to land
   * first so a fast tap can't order release-before-attack and leave the
   * synth's `triggerAttack` as the last call — which would sound forever.
   */
  release(midi: number) {
    const pending = this.pendingAttacks.get(midi)
    if (pending) {
      void pending.then(() => this.getSynth().triggerRelease(Tone.Frequency(midi, 'midi').toNote()))
    } else {
      this.getSynth().triggerRelease(Tone.Frequency(midi, 'midi').toNote())
    }
  }

  setTempo(tempo: number) {
    if (tempo === this.tempo) return
    const songTime = this.getSongTime()
    this.tempo = tempo
    if (this.part) {
      this.buildPart()
      Tone.getTransport().seconds = songTime / tempo
    }
    this.applyLoopPoints()
  }

  /**
   * `commit: false` is a live preview during a drag — the region is stored
   * (so play/tempo pick it up) but the transport is left alone until the
   * drag commits, to avoid re-seeking and re-looping on every pointermove.
   */
  setRegion(region: Region | null, commit = true) {
    this.region = region
    if (!commit) return
    this.applyLoopPoints()
    if (region && this.playing) {
      const t = this.getSongTime()
      if (t < region.start || t >= region.end) this.seek(region.start)
    }
  }

  getSongTime(): number {
    return Tone.getTransport().seconds * this.tempo
  }

  async play() {
    if (this.notes.length === 0) return
    await Tone.start()
    if (!this.part) this.buildPart()
    this.applyLoopPoints()
    const t = this.getSongTime()
    if (this.region && (t < this.region.start || t >= this.region.end)) {
      this.seek(this.region.start)
    }
    Tone.getTransport().start()
    this.setPlaying(true)
  }

  pause() {
    Tone.getTransport().pause()
    this.setPlaying(false)
  }

  stop() {
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel()
    Tone.getDraw().cancel()
    this.part?.dispose()
    this.part = null
    // Also silences any notes currently held via live input (mouse/computer
    // keyboard via `attack`/`release`) — accepted M3 limitation, not a bug.
    this.synth?.releaseAll()
    this.setActiveNotes(new Set())
    this.setPlaying(false)
  }

  /** Moves the playhead to an arbitrary song time, e.g. from a piano-roll tap. */
  seek(songTime: number) {
    Tone.getTransport().seconds = songTime / this.tempo
  }

  private buildPart() {
    const transport = Tone.getTransport()
    this.part?.dispose()
    transport.cancel()
    Tone.getDraw().cancel()

    const synth = this.getSynth()
    const events: NoteEvent[] = this.notes.map((note) => ({
      time: note.time / this.tempo,
      note,
    }))
    const retriggers = findRetriggers(this.notes)

    this.part = new Tone.Part<NoteEvent>((time, { note }) => {
      const duration = note.duration / this.tempo
      if (this.mode === 'listen') {
        synth.triggerAttackRelease(note.name, duration, time, note.velocity)
      }
      const blink = retriggers.has(note) ? Math.min(RETRIGGER_BLINK_SEC, duration * 0.4) : 0
      Tone.getDraw().schedule(() => this.noteOn(note.midi), time + blink)
      Tone.getDraw().schedule(() => this.noteOff(note.midi), time + duration)
    }, events)
    this.part.start(0)

    // Stop at the end of the song; when a region loop is active the transport
    // never reaches this point.
    transport.scheduleOnce((time) => {
      Tone.getDraw().schedule(() => this.stop(), time)
    }, this.songEnd / this.tempo + 0.05)
  }

  private applyLoopPoints() {
    const transport = Tone.getTransport()
    if (this.region) {
      transport.setLoopPoints(this.region.start / this.tempo, this.region.end / this.tempo)
      transport.loop = true
    } else {
      transport.loop = false
    }
  }

  private getSynth(): Tone.PolySynth {
    if (!this.synth) {
      this.synth = new Tone.PolySynth(Tone.Synth).toDestination()
    }
    return this.synth
  }

  private noteOn(midi: number) {
    const next = new Set(this.activeNotes)
    next.add(midi)
    this.setActiveNotes(next)
  }

  private noteOff(midi: number) {
    const next = new Set(this.activeNotes)
    next.delete(midi)
    this.setActiveNotes(next)
  }

  private setActiveNotes(notes: Set<number>) {
    this.activeNotes = notes
    this.onActiveNotesChange?.(notes)
  }

  private setPlaying(playing: boolean) {
    if (playing === this.playing) return
    this.playing = playing
    this.onPlayStateChange?.(playing)
  }
}

export const player = new Player()
