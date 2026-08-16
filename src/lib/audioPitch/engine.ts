// Framework-free Web Audio wrapper around `PitchDetector` (M10a). No React —
// this is the seam between the pure detector and the browser's mic/analyser
// APIs, and it is the piece the dev lab drives directly with synthetic
// oscillators instead of a microphone. See memory-bank/audioPitchInput.md.
//
// Deliberately owns its own plain `AudioContext`, separate from Tone.js's:
// keeps this module Tone-free, independently usable from the lab page, and
// startable on a user gesture (mic permission prompt) without touching
// `Tone.start()`'s gating.

import { subscribeFrame } from '../frameLoop'
import { PitchDetector, type DetectorEvent, type DetectorMonitor } from './detector'

// Long-window FFT size for pitch/candidate scoring. Lab-tuned (step 5):
// measured directly against the lab's synthetic C2-C6 sweep. At 8192
// (5.86Hz/bin @ 48kHz) every note in the sweep resolved correctly. At 4096
// (11.7Hz/bin) G2 (MIDI 43) was consistently misidentified as its octave G3
// (MIDI 55) — the coarser bins blur odd-harmonic separation enough to fool
// the octave guard in the bottom two octaves. The latency win from halving
// the window (measured ~94ms vs ~72ms at good SNR — a difference nowhere
// near wait mode's indefinite-hold tolerance) isn't worth trading away
// correct low-bass octave resolution for. Kept at 8192.
export const LONG_FFT_SIZE = 8192

// Short-window FFT size for spectral-flux onset detection. Lab-tuned: 2048
// gives onset detection a ~43ms hop at 48kHz, comfortably faster than the
// long window's own latency, so onsets are never the bottleneck.
export const SHORT_FFT_SIZE = 2048

export interface AudioEngineOptions {
  onEvent?: (event: DetectorEvent) => void
}

/**
 * `getUserMedia` audio constraints. Structured as its own object (rather than
 * inlined) so a future `deviceId` (device picker) is a one-line addition;
 * `channelCount: 1` and disabling every voice-tuned processing flag are load
 * bearing — echo cancellation/noise suppression/AGC all destroy the harmonic
 * content candidate scoring depends on.
 */
function buildAudioConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    // deviceId: undefined, // TODO(device picker): plug a selected deviceId in here.
  }
}

/**
 * Owns one `AudioContext` for its whole lifetime: created in the constructor
 * (not `start()`) so a caller — the dev lab, in particular — can build nodes
 * (e.g. oscillators) against `getContext()` *before* calling `start(source)`
 * with them. A Web Audio node can only ever belong to the context it was
 * created with, so the context has to exist first.
 *
 * One engine instance is good for exactly one start/stop lifecycle; `stop()`
 * closes the context. Callers that need to restart (the lab's "Enable mic"
 * toggle, `useAudioInput`'s future hook) construct a fresh instance.
 */
export class AudioPitchEngine {
  readonly context: AudioContext

  private stream: MediaStream | null = null
  private longAnalyser: AnalyserNode | null = null
  private shortAnalyser: AnalyserNode | null = null
  private detector: PitchDetector | null = null
  private unsubscribeFrame: (() => void) | null = null
  private readonly onEvent: ((event: DetectorEvent) => void) | undefined

  // Typed explicitly as `Float32Array<ArrayBuffer>` (not the bare
  // `Float32Array` alias) because the DOM lib's `getFloat*Data` methods
  // require that exact generic parameter — `new Float32Array(n)` satisfies
  // it, but an unparameterized field type widens to `ArrayBufferLike` and
  // fails to typecheck against them.
  private longDb: Float32Array<ArrayBuffer> | null = null
  private shortDb: Float32Array<ArrayBuffer> | null = null
  private timeDomain: Float32Array<ArrayBuffer> | null = null

  private started = false

  constructor(options: AudioEngineOptions = {}) {
    this.onEvent = options.onEvent
    this.context = new AudioContext()
  }

  getContext(): AudioContext {
    return this.context
  }

  /** Debug/visualization seam for the dev lab's spectrum canvas — not used by
   * the detector itself (it reads frames via `pump()`), and not part of the
   * app-facing API surface. */
  getLongAnalyser(): AnalyserNode | null {
    return this.longAnalyser
  }

  /**
   * Starts capture and analysis. With no `source`, opens the mic via
   * `getUserMedia`. With an injected `source` (an `AudioNode` already
   * belonging to `this.context`, e.g. an oscillator graph the lab built),
   * `getUserMedia` is never called at all — this is the synthetic-source
   * testing seam.
   */
  async start(source?: AudioNode): Promise<void> {
    if (this.started) return
    this.started = true

    await this.context.resume()

    let inputNode: AudioNode
    if (source) {
      inputNode = source
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(),
      })
      this.stream = stream
      inputNode = this.context.createMediaStreamSource(stream)
    }

    const longAnalyser = this.context.createAnalyser()
    longAnalyser.fftSize = LONG_FFT_SIZE
    longAnalyser.smoothingTimeConstant = 0

    const shortAnalyser = this.context.createAnalyser()
    shortAnalyser.fftSize = SHORT_FFT_SIZE
    shortAnalyser.smoothingTimeConstant = 0

    inputNode.connect(longAnalyser)
    inputNode.connect(shortAnalyser)

    this.longAnalyser = longAnalyser
    this.shortAnalyser = shortAnalyser
    this.longDb = new Float32Array(longAnalyser.frequencyBinCount)
    this.shortDb = new Float32Array(shortAnalyser.frequencyBinCount)
    this.timeDomain = new Float32Array(shortAnalyser.fftSize)

    this.detector = new PitchDetector({
      sampleRate: this.context.sampleRate,
      longFftSize: LONG_FFT_SIZE,
      shortFftSize: SHORT_FFT_SIZE,
    })

    this.unsubscribeFrame = subscribeFrame(() => this.pump())
  }

  private pump(): void {
    const { longAnalyser, shortAnalyser, detector, longDb, shortDb, timeDomain } = this
    if (!longAnalyser || !shortAnalyser || !detector || !longDb || !shortDb || !timeDomain) return

    longAnalyser.getFloatFrequencyData(longDb)
    shortAnalyser.getFloatFrequencyData(shortDb)
    shortAnalyser.getFloatTimeDomainData(timeDomain)

    const events = detector.processFrame({
      longDb,
      shortDb,
      timeDomain,
      timeMs: performance.now(),
    })
    for (const event of events) this.onEvent?.(event)
  }

  setCandidates(expected: ReadonlySet<number>): void {
    this.detector?.setCandidates(expected)
  }

  getMonitor(): DetectorMonitor | null {
    return this.detector?.getMonitor() ?? null
  }

  /**
   * Stops the frame pump, force-releases any still-sounding pitches (so no
   * note is left hanging on the input bus), stops media tracks, and closes
   * the context. Returns the force-release events so a caller (the future
   * `useAudioInput` hook) can publish matching note-offs.
   */
  stop(): DetectorEvent[] {
    this.unsubscribeFrame?.()
    this.unsubscribeFrame = null

    const events = this.detector?.forceRelease() ?? []
    for (const event of events) this.onEvent?.(event)

    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }

    this.longAnalyser = null
    this.shortAnalyser = null
    this.detector = null
    this.longDb = null
    this.shortDb = null
    this.timeDomain = null

    void this.context.close()

    return events
  }
}
