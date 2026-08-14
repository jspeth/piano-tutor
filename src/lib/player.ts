import * as Tone from 'tone'
import type { ParsedNote } from '../types'
import { groupIntoSteps, type Step } from './steps'
import { subscribe } from './noteInput'
import { getInstrument, whenInstrumentLoaded } from './instrument'

export interface Region {
  start: number
  end: number
}

export type PlaybackMode = 'listen' | 'practice' | 'wait'

export interface PlayerLane {
  trackIndex: number
  notes: ParsedNote[]
}

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

/** A parsed note tagged with which lane/track it came from, once lanes are
 * flattened into a single playback timeline. */
interface LaneNote {
  note: ParsedNote
  trackIndex: number
}

interface NoteEvent {
  time: number
  note: ParsedNote
  trackIndex: number
}

/**
 * Owns the Tone.js Transport and scheduled Part (the sampled piano instrument
 * itself lives in `instrument.ts` as a module-level singleton). All public
 * times are in song seconds; the single song-time ↔ transport-time
 * conversion is `transport = song / tempo`. Loop points and the playhead
 * both go through it.
 */
class Player {
  onActiveNotesChange?: (notes: Map<number, number>) => void
  onPlayStateChange?: (playing: boolean) => void
  onExpectedNotesChange?: (notes: Set<number> | null) => void
  onNoteFeedback?: (midi: number, kind: 'correct' | 'incorrect') => void

  private part: Tone.Part<NoteEvent> | null = null
  private notes: LaneNote[] = []
  private steps: Step[] = []
  private songEnd = 0
  private tempo = 1
  private region: Region | null = null
  private activeNotes = new Map<number, number>()
  private playing = false
  private pendingAttacks = new Map<number, Promise<void>>()
  private mode: PlaybackMode = 'listen'
  private lanes: PlayerLane[] = []
  private focusTrackIndex = -1

  // 'wait' mode state: the Transport never runs; advancing is a manual
  // seek-and-subscribe stepper (see class doc comment).
  private waitSteps: Step[] = []
  private waitStepIndex = -1
  private waitSatisfied = new Set<number>()
  private waitUnsubscribe: (() => void) | null = null

  /**
   * In 'practice' mode, scheduled playback still moves the playhead and
   * lights up the keys (`activeNotes`), but doesn't sound the synth — only
   * the player's own key presses (via `attack`/`release`) do. 'wait' mode
   * behaves the same way for audio, but the Transport never runs — see the
   * `waitSteps`/`waitStepIndex` stepper below instead of `part`/loop points.
   */
  setMode(mode: PlaybackMode) {
    const wasWait = this.mode === 'wait'
    const willBeWait = mode === 'wait'
    // Don't attempt a seamless hot-swap between the transport-driven modes
    // and the manual wait stepper — pause and require the user to press
    // Play again. listen<->practice keeps today's hot-swap behavior.
    if (this.playing && wasWait !== willBeWait) this.pause()
    if (wasWait && !willBeWait) {
      // Leaving wait mode entirely (not just pausing within it) — the
      // expected-notes readout and lit keys no longer apply, and stale
      // `waitSteps` (from a since-changed region) must not be reused if the
      // user later seeks back in without pressing Play in wait mode again.
      this.waitStepIndex = -1
      this.setActiveNotes(new Map())
      this.onExpectedNotesChange?.(null)
    }
    if (!wasWait && willBeWait) {
      // Cancel pending draw callbacks so a late `noteOff` can't clobber the
      // wait step's key lighting, but that also strands any keys sounding
      // at the pause moment as still-lit — clear them like the reverse
      // (leaving wait mode) already does above.
      Tone.getDraw().cancel()
      this.setActiveNotes(new Map())
    }
    this.mode = mode
  }

  /**
   * Replaces the set of layered lanes and which one drives the readout/
   * wait-mode step logic. Non-focus lanes still contribute their notes to
   * playback/scheduling, but only the focus lane's onsets are grouped into
   * wait-mode steps. Freezing non-focus lanes during a wait-mode hold needs
   * no extra logic here: the Transport never `.start()`s in wait mode (see
   * class doc comment), so every lane's scheduled `Tone.Part` callbacks
   * simply never fire while a wait step is held, regardless of how many
   * lanes are merged into `this.notes`.
   */
  setLanes(lanes: PlayerLane[], focusTrackIndex: number) {
    const laneSetChanged =
      lanes.length !== this.lanes.length ||
      lanes.some((lane, i) => lane.trackIndex !== this.lanes[i]?.trackIndex || lane.notes !== this.lanes[i]?.notes)

    this.lanes = lanes
    const focusLane = lanes.find((l) => l.trackIndex === focusTrackIndex) ?? null
    this.focusTrackIndex = focusTrackIndex
    this.notes = lanes.flatMap((l) => l.notes.map((note) => ({ note, trackIndex: l.trackIndex })))
    this.songEnd = this.notes.reduce((end, n) => Math.max(end, n.note.time + n.note.duration), 0)
    this.steps = groupIntoSteps(focusLane?.notes ?? [])

    // An active wait-mode session (playing, mid-hold) must survive lane
    // add/remove/focus changes — same "no interruption" contract as
    // `setRegion`'s wait branch — even though the lane set changed. Only
    // listen/practice playback (and a wait mode that isn't actively
    // running) gets the full stop()+rebuild treatment below.
    if (this.isWaitSessionActive()) {
      if (laneSetChanged && this.part) {
        // The transport never runs during a wait session, so a `Tone.Part`
        // can only be here as a leftover from listen/practice playback
        // before switching to wait mode. Its scheduled events (including
        // the end-of-song `scheduleOnce` stop) are keyed to the *old* lane
        // set/`songEnd` — drop them so a later switch back to listen mode
        // rebuilds against the current notes instead of silently replaying
        // the stale ones.
        this.part.dispose()
        this.part = null
        Tone.getTransport().cancel()
      }
      this.waitSteps = this.computeWaitSteps()
      if (this.waitSteps.length === 0) {
        this.pauseWaitSession()
        return
      }
      this.startWaitStep(this.findStepIndexAtOrAfter(this.getSongTime()))
      return
    }

    if (laneSetChanged) {
      this.stop()
      return
    }

    // Only the focus changed, and no wait session is actively running —
    // `this.steps` above already reflects the new focus lane; the next
    // `play()` in wait mode will call `computeWaitSteps()` fresh.
  }

  /** Sounds a note from live (non-playback) input, e.g. mouse or computer keyboard. */
  attack(midi: number) {
    const started = Promise.all([Tone.start(), whenInstrumentLoaded()]).then(() => {
      getInstrument().triggerAttack(Tone.Frequency(midi, 'midi').toNote(), Tone.now(), 0.8)
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
   * sampler's `triggerAttack` as the last call — which would sound forever.
   */
  release(midi: number) {
    const pending = this.pendingAttacks.get(midi)
    if (pending) {
      void pending.then(() => getInstrument().triggerRelease(Tone.Frequency(midi, 'midi').toNote()))
    } else {
      getInstrument().triggerRelease(Tone.Frequency(midi, 'midi').toNote())
    }
  }

  setTempo(tempo: number) {
    if (tempo === this.tempo) return
    const songTime = this.getSongTime()
    this.tempo = tempo
    // No Tone.Part exists in wait mode, but a wait step's song-time position
    // still needs to be preserved across the tempo change, same as the Part
    // path below.
    if (this.part || this.isWaitSessionActive()) {
      if (this.part) this.buildPart()
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
    if (this.isWaitSessionActive()) {
      this.waitSteps = this.computeWaitSteps()
      if (this.waitSteps.length === 0) {
        this.pauseWaitSession()
        return
      }
      this.startWaitStep(this.findStepIndexAtOrAfter(this.getSongTime()))
      return
    }
    if (region && this.playing) {
      const t = this.getSongTime()
      if (t < region.start || t >= region.end) this.seekTransport(region.start)
    }
  }

  getSongTime(): number {
    return Tone.getTransport().seconds * this.tempo
  }

  async play() {
    if (this.notes.length === 0) return
    if (this.mode === 'wait') {
      await Promise.all([Tone.start(), whenInstrumentLoaded()])
      this.waitSteps = this.computeWaitSteps()
      if (this.waitSteps.length === 0) {
        this.pauseWaitSession()
        return
      }
      const index = this.findStepIndexAtOrAfter(this.getSongTime())
      this.setPlaying(true)
      this.startWaitStep(index)
      return
    }
    await Promise.all([Tone.start(), whenInstrumentLoaded()])
    if (!this.part) this.buildPart()
    this.applyLoopPoints()
    const t = this.getSongTime()
    if (this.region && (t < this.region.start || t >= this.region.end)) {
      this.seekTransport(this.region.start)
    }
    Tone.getTransport().start()
    this.setPlaying(true)
  }

  pause() {
    if (this.isWaitSessionActive()) {
      this.unsubscribeWait()
      this.setPlaying(false)
      return
    }
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
    this.unsubscribeWait()
    this.waitStepIndex = -1
    this.onExpectedNotesChange?.(null)
    // Also silences any notes currently held via live input (mouse/computer
    // keyboard via `attack`/`release`) — accepted M3 limitation, not a bug.
    getInstrument().releaseAll()
    this.setActiveNotes(new Map())
    this.setPlaying(false)
  }

  /** Moves the playhead to an arbitrary song time, e.g. from a piano-roll tap. */
  seek(songTime: number) {
    if (this.isWaitSessionActive()) {
      if (this.waitSteps.length === 0) return
      this.startWaitStep(this.findStepIndexAtOrAfter(songTime))
      return
    }
    this.seekTransport(songTime)
  }

  private seekTransport(songTime: number) {
    Tone.getTransport().seconds = songTime / this.tempo
  }

  private isWaitSessionActive(): boolean {
    return this.mode === 'wait' && this.waitStepIndex !== -1
  }

  /** Full track steps, filtered to the active region (if any). */
  private computeWaitSteps(): Step[] {
    if (!this.region) return this.steps
    const { start, end } = this.region
    return this.steps.filter((s) => s.time >= start && s.time < end)
  }

  /**
   * First wait step at/after `time`, wrapping to the first step if none.
   * `time` is usually read back from `getSongTime()`, which round-trips
   * through the transport's tick domain and can land a hair above the step
   * time it was seeked to — a strict `>=` would then skip that very step.
   * Steps are always more than `epsilon` apart (see `groupIntoSteps`), so
   * this tolerance can't reach into the previous step.
   */
  private findStepIndexAtOrAfter(time: number): number {
    const index = this.waitSteps.findIndex((s) => s.time >= time - 0.025)
    return index === -1 ? 0 : index
  }

  /**
   * Seeks to and lights the wait step at `index`. Only arms the
   * satisfaction listener if a session is actually playing — a paused wait
   * session (e.g. a piano-roll tap or region change while paused) should
   * still move the playhead and relight keys, but must not silently listen
   * and advance while the UI shows "Play".
   */
  private startWaitStep(index: number) {
    this.waitStepIndex = index
    const step = this.waitSteps[index]
    this.seekTransport(step.time)
    this.waitSatisfied = new Set()
    this.setActiveNotes(new Map(step.midis.map((m) => [m, this.focusTrackIndex])))
    this.onExpectedNotesChange?.(new Set(step.midis))
    this.unsubscribeWait()
    if (this.playing) this.subscribeWait(step)
  }

  /**
   * Accumulates fresh `noteon` events (not notes already held when the step
   * activated) into `waitSatisfied`; advances once every pitch in the step
   * has been struck. Wrong notes are ignored — no penalty, no reset.
   *
   * Arming the next step's listener is deferred a microtask: `noteInput`'s
   * `publish()` iterates its raw-listener Set live, so a listener added
   * during that same iteration (as `advanceWait` does, synchronously, from
   * inside this very callback) would still be visited by it — replaying the
   * note that just satisfied this step against the next step and skipping
   * it without a fresh keypress. Deferring avoids that re-entrant delivery.
   */
  private subscribeWait(step: Step) {
    queueMicrotask(() => {
      // Bail if this step is no longer current (advanced, paused, stopped,
      // or superseded by another activation) by the time this runs.
      if (this.waitSteps[this.waitStepIndex] !== step || !this.playing) return
      // Guard against a same-task double activation queuing two of these:
      // the second would otherwise overwrite `waitUnsubscribe` and leak the
      // first listener forever.
      this.unsubscribeWait()
      this.waitUnsubscribe = subscribe((e) => {
        if (e.type !== 'noteon') return
        if (!step.midis.includes(e.midi)) {
          this.onNoteFeedback?.(e.midi, 'incorrect')
          return
        }
        this.onNoteFeedback?.(e.midi, 'correct')
        this.waitSatisfied.add(e.midi)
        if (step.midis.every((m) => this.waitSatisfied.has(m))) this.advanceWait()
      })
    })
  }

  private unsubscribeWait() {
    this.waitUnsubscribe?.()
    this.waitUnsubscribe = null
  }

  private advanceWait() {
    const nextIndex = this.waitStepIndex + 1
    if (nextIndex < this.waitSteps.length) {
      this.startWaitStep(nextIndex)
    } else if (this.region) {
      // Region set == loop, same convention as the transport-driven modes.
      this.startWaitStep(0)
    } else {
      // stop() resets the transport to 0, so seek to songEnd after it, not
      // before, to leave the playhead parked at the end of the song.
      this.stop()
      this.seekTransport(this.songEnd)
    }
  }

  /** No steps in the (newly filtered) region — pause without crashing. */
  private pauseWaitSession() {
    this.unsubscribeWait()
    this.waitStepIndex = -1
    this.setActiveNotes(new Map())
    this.onExpectedNotesChange?.(null)
    this.setPlaying(false)
  }

  private buildPart() {
    const transport = Tone.getTransport()
    this.part?.dispose()
    transport.cancel()
    Tone.getDraw().cancel()

    const instrument = getInstrument()
    const events: NoteEvent[] = this.notes.map(({ note, trackIndex }) => ({
      time: note.time / this.tempo,
      note,
      trackIndex,
    }))
    const retriggers = findRetriggers(this.notes.map((n) => n.note))

    this.part = new Tone.Part<NoteEvent>((time, { note, trackIndex }) => {
      const duration = note.duration / this.tempo
      if (this.mode === 'listen') {
        instrument.triggerAttackRelease(note.name, duration, time, note.velocity)
      }
      const blink = retriggers.has(note) ? Math.min(RETRIGGER_BLINK_SEC, duration * 0.4) : 0
      Tone.getDraw().schedule(() => this.noteOn(note.midi, trackIndex), time + blink)
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

  private noteOn(midi: number, trackIndex: number) {
    const next = new Map(this.activeNotes)
    next.set(midi, trackIndex)
    this.setActiveNotes(next)
  }

  private noteOff(midi: number) {
    const next = new Map(this.activeNotes)
    next.delete(midi)
    this.setActiveNotes(next)
  }

  private setActiveNotes(notes: Map<number, number>) {
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
