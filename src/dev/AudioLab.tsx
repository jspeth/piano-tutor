// Dev-only lab page for the audio-pitch-input detector/engine (M10a, step 4).
// Throwaway tool, not product UI: inline styles, no design tokens, no shared
// components. Purpose: drive `AudioPitchEngine` from either the real mic or
// synthetic oscillator tones (no mic/keyboard required) so the detector can
// be watched and tuned (step 5) without an app session. See
// memory-bank/audioPitchInput.md.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioPitchEngine } from '../lib/audioPitch/engine'
import type { DetectorEvent, DetectorMonitor } from '../lib/audioPitch/detector'
import { subscribeFrame } from '../lib/frameLoop'
import { midiToNoteName } from '../lib/noteNames'

type SourceMode = 'mic' | 'synthetic'
type ScenarioKind = 'single' | 'repeated' | 'octave' | 'chord' | 'decay-step'

interface LogEntry {
  id: number
  ts: string
  text: string
}

interface ToneOptions {
  /** Delay from "now" before the tone starts, in seconds. */
  at?: number
  /** Exponential-decay time constant, in seconds. */
  decaySec?: number
  /** Peak linear gain of the fundamental. */
  peakGain?: number
}

const NOTE_NAME_TO_PC: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

/** Parses a single note name like "C4", "F#3", or "Bb2" into a MIDI number.
 * Dev-tool-local: the app has no `noteNameToMidi` (only the inverse), and
 * this parser doesn't need production-grade robustness. */
function parseNoteName(raw: string): number | null {
  const match = /^([A-Ga-g])(#|b)?(-?\d+)$/.exec(raw.trim())
  if (!match) return null
  const [, letter, accidental = '', octaveStr] = match
  const pc = NOTE_NAME_TO_PC[`${letter.toUpperCase()}${accidental}`]
  if (pc === undefined) return null
  const octave = Number(octaveStr)
  return (octave + 1) * 12 + pc
}

function parseCandidates(text: string): Set<number> {
  const midis = new Set<number>()
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue
    const midi = parseNoteName(token)
    if (midi !== null) midis.add(midi)
  }
  return midis
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * Plain-oscillator piano-like tone: fundamental + 8 harmonics at 1/h peak
 * amplitude, each with a fast attack and an independent exponential decay —
 * per the plan's synthetic-test-tone spec. Connects straight into `dest`
 * (the engine's mix bus) and self-cleans via `onended`.
 *
 * Earlier note here blamed the repeated-note lab scenario's failures on
 * phase cancellation between re-struck sine oscillators. That diagnosis was
 * wrong — a level trace across the re-strike showed a clean +15 dB jump, not
 * the kind of amplitude drop destructive interference would produce. The
 * real bug was in the detector's onset gate (`detector.ts`): during a
 * decaying note the rolling flux median collapses toward zero, so the
 * relative-only onset test (`flux > median * multiplier`) let trivial
 * fluctuations fire false onsets, and each false onset held a strike window
 * open long enough to swallow the genuine re-strike that followed. Fixed by
 * adding an absolute flux floor (`ABSOLUTE_FLUX_ENERGY_RATIO`) and letting a
 * clearly louder onset supersede an already-open window
 * (`SUPERSEDE_FLUX_RATIO`). See memory-bank/audioPitchInput.md for the full
 * writeup. This synthetic tone generator was never the problem.
 */
function playPianoTone(ctx: AudioContext, dest: AudioNode, midi: number, opts: ToneOptions = {}): void {
  const { at = 0, decaySec = 1.5, peakGain = TONE_PEAK_GAIN } = opts
  // A small fixed lookahead, not just `ctx.currentTime`: scheduling a node to
  // start at-or-before the context's current processing time is a known Web
  // Audio footgun — some engines silently drop the very first sample block,
  // which showed up here as an intermittently silent first note right after
  // `resume()`. Real-world synthesis code always schedules a bit ahead; this
  // just does the same.
  const startTime = ctx.currentTime + 0.03 + at
  const stopTime = startTime + decaySec + SILENCE_TAIL_SEC
  const f0 = 440 * 2 ** ((midi - 69) / 12)

  for (let h = 1; h <= 9; h++) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f0 * h

    const gain = ctx.createGain()
    const peak = peakGain / h
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.005)
    // `exponentialRampToValueAtTime` can't reach true 0 (it's a curve, not a
    // line), so it always targets a small nonzero floor; cutting the
    // oscillator off there with `osc.stop()` truncates its raw waveform
    // mid-cycle at a non-zero-crossing point — a genuine, audible click.
    // Found instrumenting the single-note lab scenario (see
    // memory-bank/audioPitchInput.md): the detector correctly heard this
    // click as a real onset, producing a spurious extra note-on/note-off pair
    // right at the tone's natural stop time in every run. A real piano note
    // fades continuously to true silence and never does this — it's purely
    // an artifact of this synthetic generator's hard stop.
    //
    // A first attempt spliced in a final linear ramp to literal 0 just before
    // `stopTime`. That backfired: switching ramp *shapes* mid-decay (curve to
    // line) is itself a discontinuity in the envelope's slope, and produces
    // its own small transient at the splice point — moving the false onset
    // a few tens of ms earlier instead of removing it (still reproduced every
    // run). The fix that actually holds: keep every ramp segment exponential
    // (only downward slope *rate* changes across the breakpoint below, never
    // ramp shape) — the onset detector's flux gate only ever counts *rising*
    // energy (`if (diff > 0) flux += diff`), so a steeper downward slope
    // can't itself masquerade as an onset the way a curve-to-line kink could.
    //
    // Two-segment decay, added in the noise-bed bug-fix pass (see
    // memory-bank/audioPitchInput.md): a single ramp spanning the full ~140dB
    // from peak to `1e-7` over `decaySec` decays at a *constant dB/sec rate*
    // (because an exponential amplitude ramp is linear in dB) — for any
    // `decaySec` in this file's scenarios (1.5-3s) that rate is roughly
    // 50-90dB/sec, so the tone crosses a realistic ~20dB-below-peak noise
    // floor within a few hundred ms, no matter how long `decaySec` says the
    // note should audibly ring. That was invisible before the noise bed
    // existed (compared against a ~-180dB floor, "audible" meant "not yet
    // literal digital silence," which held until near `stopTime`), but with a
    // real noise floor in the picture it made every decaying/sustained note
    // release ~10x faster than intended. Splitting the ramp fixes this: the
    // first, audible segment falls only to `AUDIBLE_FLOOR_RATIO` (-40dB) over
    // the full `decaySec` — matching what `decaySec` is meant to represent —
    // and only the remainder races on down to true silence for the
    // click-avoidance floor.
    //
    // `SILENCE_TAIL_SEC` (not a short fixed ~100ms, as a first attempt used)
    // is sized to keep this final segment's own dB/sec rate close to the
    // original single-segment design's ~90dB/sec, not an order of magnitude
    // steeper. A first attempt used a short fixed tail, which reintroduced
    // the *exact* decay-tail digital-silence bug this exponential-floor
    // design was built to fix (see memory-bank/audioPitchInput.md): silence
    // that arrives ~10x faster crashes `levelDb` (from the fast, per-frame
    // RMS) to the numeric floor well before the *long*-window candidate
    // score (which still holds ~171ms of pre-silence energy) can catch up,
    // reproducing a spurious extra note-on/note-off cycle right at the
    // tone's end (measured 2/6 runs with a 100ms tail; the original design
    // held this to 0/12).
    const audibleFloor = Math.max(peak * AUDIBLE_FLOOR_RATIO, 1e-8)
    gain.gain.exponentialRampToValueAtTime(audibleFloor, startTime + decaySec)
    gain.gain.exponentialRampToValueAtTime(Math.max(peak * 1e-7, 1e-8), stopTime)

    osc.connect(gain)
    gain.connect(dest)
    osc.start(startTime)
    osc.stop(stopTime)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }
}

/**
 * Fundamental peak linear gain used by `playPianoTone`'s default and the
 * noise bed's own level calibration below — kept as one named constant so
 * the noise bed's "dB relative to tone peak" slider means what it says.
 */
const TONE_PEAK_GAIN = 0.2

/**
 * -40dB (0.01x peak): the "audible decay" floor `playPianoTone`'s envelope
 * falls to over the scripted `decaySec`, before a short fixed tail races on
 * down to true digital silence. See the decay-envelope comment inside
 * `playPianoTone` for why a single ramp all the way to silence stopped being
 * a realistic stand-in for a piano's decay once a real noise floor entered
 * the picture.
 */
const AUDIBLE_FLOOR_RATIO = 0.01

/**
 * Duration (seconds) of the final ramp segment from `AUDIBLE_FLOOR_RATIO`
 * down to the click-avoidance floor (`peak * 1e-7`), after the audible
 * `decaySec` segment. See the decay-envelope comment inside `playPianoTone`:
 * this needs to be long enough that the segment's own dB/sec rate stays in
 * the same ballpark as the original single-segment design (~90dB/sec) —
 * a short, fast tail reintroduces the decay-tail digital-silence bug that
 * design was built to avoid.
 */
const SILENCE_TAIL_SEC = 1.2

/**
 * Synthetic ambient-noise bed (M10a bug-fix pass): broadband noise with a
 * low-frequency tilt, approximating the HVAC rumble + room hiss the user
 * measured with a real laptop mic in a real room. Added because the original
 * synthetic test source had *no* noise bed at all — every threshold in
 * `detector.ts` was tuned against a world with a literally flat, near-zero
 * spectrum everywhere a test tone wasn't, which is exactly why two real bugs
 * (noise-floor deadlock, no tonality gate) survived multiple "all tests
 * pass" tuning sessions. See memory-bank/audioPitchInput.md.
 *
 * A single continuously-looping white-noise buffer through a low-shelf
 * filter (boosts everything below ~300Hz, leaves the rest broadband) feeding
 * a gain node whose level is expressed as "dB below the tone's peak gain" —
 * so the lab's noise-level control means the same thing the user's own
 * measurement did ("actually playing a note raises the level by 20dB or
 * more above the idle room noise").
 */
function createNoiseBed(ctx: AudioContext, dest: AudioNode): { gain: GainNode; stop: () => void } {
  const bufferSeconds = 2
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * bufferSeconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const tilt = ctx.createBiquadFilter()
  tilt.type = 'lowshelf'
  tilt.frequency.value = 300
  tilt.gain.value = 15

  const gain = ctx.createGain()
  gain.gain.value = 0

  source.connect(tilt)
  tilt.connect(gain)
  gain.connect(dest)
  source.start()

  return {
    gain,
    stop: () => {
      source.stop()
      source.disconnect()
      tilt.disconnect()
      gain.disconnect()
    },
  }
}

const SCENARIOS: { kind: ScenarioKind; label: string; description: string }[] = [
  { kind: 'single', label: 'Single note (C4)', description: 'One onset, one candidate.' },
  {
    kind: 'repeated',
    label: 'Repeated note (C4 re-strike)',
    description: 'C4 struck, then re-struck at 0.9s while still ringing — must yield off+on, not nothing.',
  },
  {
    kind: 'octave',
    label: 'Octave pair (C4 + C5)',
    description: 'Both fundamentals simultaneously — the octave guard must resolve to C4.',
  },
  {
    kind: 'chord',
    label: 'Rolled chord (C4 E4 G4)',
    description: 'Staggered onsets 350ms apart — each should register as its own note-on.',
  },
  {
    kind: 'decay-step',
    label: 'Decay across step change',
    description: 'C4 rings for 3s; candidates switch to D4 at 0.6s — the ringing C4 must not satisfy D4.',
  },
]

export function AudioLab() {
  const [sourceMode, setSourceMode] = useState<SourceMode>('synthetic')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidatesText, setCandidatesText] = useState('C4')
  const [log, setLog] = useState<LogEntry[]>([])
  const [noiseEnabled, setNoiseEnabled] = useState(false)
  const [noiseLevelDb, setNoiseLevelDb] = useState(20)

  const engineRef = useRef<AudioPitchEngine | null>(null)
  const mixBusRef = useRef<GainNode | null>(null)
  const noiseBedRef = useRef<{ gain: GainNode; stop: () => void } | null>(null)
  const expectedRef = useRef<Set<number>>(new Set())
  const logIdRef = useRef(0)
  const spectrumBufRef = useRef<Float32Array<ArrayBuffer> | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const logScrollRef = useRef<HTMLDivElement>(null)
  const levelBarRef = useRef<HTMLDivElement>(null)
  const floorTickRef = useRef<HTMLDivElement>(null)
  const levelTextRef = useRef<HTMLSpanElement>(null)
  const heardRef = useRef<HTMLSpanElement>(null)
  const signalRef = useRef<HTMLSpanElement>(null)
  const unproductiveRef = useRef<HTMLSpanElement>(null)

  const appendLog = useCallback((text: string) => {
    logIdRef.current += 1
    const entry: LogEntry = { id: logIdRef.current, ts: new Date().toISOString().slice(11, 23), text }
    setLog((prev) => [...prev.slice(-299), entry])
  }, [])

  const handleEvent = useCallback(
    (event: DetectorEvent) => {
      appendLog(`${event.type === 'noteon' ? 'NOTE ON ' : 'note off'}  ${midiToNoteName(event.midi)} (${event.midi})`)
    },
    [appendLog],
  )

  const setCandidatesFromText = useCallback(
    (text: string) => {
      setCandidatesText(text)
      const midis = parseCandidates(text)
      expectedRef.current = midis
      engineRef.current?.setCandidates(midis)
      const names = [...midis].sort((a, b) => a - b).map(midiToNoteName)
      appendLog(`candidates: ${names.length > 0 ? names.join(', ') : '(none)'}`)
    },
    [appendLog],
  )

  const start = useCallback(async () => {
    setError(null)
    const engine = new AudioPitchEngine({ onEvent: handleEvent })
    try {
      if (sourceMode === 'synthetic') {
        const mixBus = engine.getContext().createGain()
        mixBus.gain.value = 1
        mixBusRef.current = mixBus
        await engine.start(mixBus)
        noiseBedRef.current = createNoiseBed(engine.getContext(), mixBus)
        noiseBedRef.current.gain.gain.value = noiseEnabled
          ? TONE_PEAK_GAIN * 10 ** (-noiseLevelDb / 20)
          : 0
      } else {
        mixBusRef.current = null
        await engine.start()
      }
      engine.setCandidates(expectedRef.current)
      engineRef.current = engine
      setRunning(true)
      appendLog(`engine started (${sourceMode})`)
      // Debug seam for scripted tuning passes (e.g. a headless Playwright
      // driver reading `getMonitor()` directly) — dev-lab-only, never ships.
      ;(window as unknown as { __audioLabEngine?: AudioPitchEngine }).__audioLabEngine = engine
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      mixBusRef.current = null
    }
  }, [sourceMode, handleEvent, appendLog, noiseEnabled, noiseLevelDb])

  const stop = useCallback(() => {
    const engine = engineRef.current
    engineRef.current = null
    mixBusRef.current = null
    setRunning(false)
    noiseBedRef.current?.stop()
    noiseBedRef.current = null
    if (engine) {
      engine.stop()
      appendLog('engine stopped')
    }
  }, [appendLog])

  // Keeps the noise bed's gain in sync with the enabled checkbox and level
  // slider, including while it's already running (so it's audible/measurable
  // to toggle mid-session, not just at start()).
  useEffect(() => {
    if (!noiseBedRef.current) return
    noiseBedRef.current.gain.gain.value = noiseEnabled ? TONE_PEAK_GAIN * 10 ** (-noiseLevelDb / 20) : 0
  }, [noiseEnabled, noiseLevelDb, running])

  // Unmount-only teardown; refs stay current so this never needs deps.
  useEffect(() => {
    return () => {
      engineRef.current?.stop()
    }
  }, [])

  // Plays the first note in the current candidate set as a single struck
  // tone. Lets the candidate-set field double as an arbitrary-note player
  // (e.g. for sweeping C2-C6 latency during tuning) without a dedicated
  // per-note UI.
  const playCandidateNote = useCallback(() => {
    const engine = engineRef.current
    const mixBus = mixBusRef.current
    if (!engine || !mixBus) {
      setError('Start the synthetic-source engine first.')
      return
    }
    const midi = [...expectedRef.current][0]
    if (midi === undefined) {
      setError('Set a candidate note first.')
      return
    }
    appendLog(`▶ play candidate note: ${midiToNoteName(midi)}`)
    playPianoTone(engine.getContext(), mixBus, midi, { decaySec: 1.5 })
  }, [appendLog])

  const playScenario = useCallback(
    (kind: ScenarioKind) => {
      const engine = engineRef.current
      const mixBus = mixBusRef.current
      if (!engine || !mixBus) {
        setError('Start the synthetic-source engine first (scenarios need the mix bus).')
        return
      }
      const ctx = engine.getContext()
      switch (kind) {
        case 'single':
          appendLog('▶ scenario: single note (C4)')
          playPianoTone(ctx, mixBus, 60, { decaySec: 1.5 })
          break
        case 'repeated':
          appendLog('▶ scenario: repeated note (C4, re-strike at 0.9s)')
          playPianoTone(ctx, mixBus, 60, { decaySec: 2.5 })
          playPianoTone(ctx, mixBus, 60, { at: 0.9, decaySec: 2.5 })
          break
        case 'octave':
          appendLog('▶ scenario: octave pair (C4 + C5, simultaneous)')
          playPianoTone(ctx, mixBus, 60, { decaySec: 1.5 })
          playPianoTone(ctx, mixBus, 72, { decaySec: 1.5 })
          break
        case 'chord':
          appendLog('▶ scenario: rolled chord (C4, E4, G4, 350ms apart)')
          playPianoTone(ctx, mixBus, 60, { decaySec: 1.5 })
          playPianoTone(ctx, mixBus, 64, { at: 0.35, decaySec: 1.5 })
          playPianoTone(ctx, mixBus, 67, { at: 0.7, decaySec: 1.5 })
          break
        case 'decay-step':
          appendLog('▶ scenario: C4 (3s decay); candidates -> D4 at 0.6s while it rings')
          playPianoTone(ctx, mixBus, 60, { decaySec: 3 })
          setTimeout(() => setCandidatesFromText('D4'), 600)
          break
      }
    },
    [appendLog, setCandidatesFromText],
  )

  // Live monitor + spectrum: written straight to refs/canvas on the shared
  // frame loop (TimeReadout's pattern) rather than React state, since this
  // ticks at ~60fps and none of it needs to trigger a re-render.
  useEffect(() => {
    return subscribeFrame(() => {
      const engine = engineRef.current
      const monitor: DetectorMonitor | null = engine?.getMonitor() ?? null

      if (levelTextRef.current) {
        levelTextRef.current.textContent = monitor ? `${monitor.levelDb.toFixed(1)} dB` : '—'
      }
      if (levelBarRef.current) {
        const pct = monitor ? clamp01((monitor.levelDb + 100) / 100) * 100 : 0
        levelBarRef.current.style.width = `${pct}%`
      }
      if (floorTickRef.current) {
        const pct = monitor ? clamp01((monitor.noiseFloorDb + 100) / 100) * 100 : 0
        floorTickRef.current.style.left = `${pct}%`
      }
      if (heardRef.current) {
        heardRef.current.textContent = monitor?.lastHeardMidi != null ? midiToNoteName(monitor.lastHeardMidi) : '—'
      }
      if (signalRef.current) signalRef.current.textContent = monitor?.signal ?? 'none'
      if (unproductiveRef.current) {
        unproductiveRef.current.textContent = String(monitor?.unproductiveOnsets ?? 0)
      }

      drawSpectrum(canvasRef.current, engine, spectrumBufRef, expectedRef.current)
    })
  }, [])

  useEffect(() => {
    if (logScrollRef.current) logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
  }, [log])

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Audio Pitch Lab (dev)</h1>
      <p style={styles.note}>
        Throwaway tuning tool for M10a's <code>audioPitch/detector.ts</code> + <code>engine.ts</code>. Not shipped —
        see <code>audio-lab.html</code>.
      </p>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Source</h2>
        <label style={styles.radioLabel}>
          <input
            type="radio"
            name="source"
            checked={sourceMode === 'synthetic'}
            disabled={running}
            onChange={() => setSourceMode('synthetic')}
          />
          Synthetic (oscillator test tones, no mic)
        </label>
        <label style={styles.radioLabel}>
          <input
            type="radio"
            name="source"
            checked={sourceMode === 'mic'}
            disabled={running}
            onChange={() => setSourceMode('mic')}
          />
          Microphone (getUserMedia)
        </label>
        <div style={{ marginTop: 8 }}>
          {!running ? (
            <button style={styles.button} onClick={() => void start()}>
              Start engine
            </button>
          ) : (
            <button style={styles.button} onClick={stop}>
              Stop engine
            </button>
          )}
          <span style={styles.statusText}>{running ? `running (${sourceMode})` : 'idle'}</span>
        </div>
        {error && <div style={styles.error}>{error}</div>}
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Ambient noise bed (synthetic source only)</h2>
        <p style={styles.note}>
          Broadband noise with a low-frequency tilt, approximating a real room's HVAC rumble + hiss. Runs
          continuously once enabled, independent of the test-tone buttons below — this is what makes the
          "noise-only, no tone" acceptance case possible.
        </p>
        <label style={styles.radioLabel}>
          <input
            type="checkbox"
            checked={noiseEnabled}
            disabled={sourceMode !== 'synthetic'}
            onChange={(e) => setNoiseEnabled(e.target.checked)}
          />
          Enable noise bed
        </label>
        <label style={{ ...styles.radioLabel, display: 'flex', alignItems: 'center', gap: 8 }}>
          Level: tone peak minus
          <input
            type="number"
            style={{ ...styles.textInput, width: 60, marginRight: 0 }}
            value={noiseLevelDb}
            disabled={sourceMode !== 'synthetic'}
            onChange={(e) => setNoiseLevelDb(Number(e.target.value))}
          />
          dB
        </label>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Candidate set</h2>
        <input
          style={styles.textInput}
          value={candidatesText}
          onChange={(e) => setCandidatesText(e.target.value)}
          placeholder="e.g. C4 E4 G4"
        />
        <button style={styles.button} onClick={() => setCandidatesFromText(candidatesText)}>
          Apply
        </button>
        <button style={styles.button} onClick={playCandidateNote}>
          Play as single note
        </button>
        <div style={{ marginTop: 6 }}>
          {['C4', 'C4 C5', 'C4 E4 G4', 'C2', 'C6', 'D4'].map((preset) => (
            <button key={preset} style={styles.presetButton} onClick={() => setCandidatesFromText(preset)}>
              {preset}
            </button>
          ))}
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Live monitor</h2>
        <div style={styles.meterRow}>
          <span style={styles.meterLabel}>Level</span>
          <div style={styles.meterTrack}>
            <div ref={levelBarRef} style={styles.meterFill} />
            <div ref={floorTickRef} style={styles.floorTick} />
          </div>
          <span ref={levelTextRef} style={styles.meterValue}>
            —
          </span>
        </div>
        <div style={styles.statsRow}>
          <span>
            Heard: <strong ref={heardRef}>—</strong>
          </span>
          <span>
            Signal: <strong ref={signalRef}>none</strong>
          </span>
          <span>
            Unproductive onsets: <strong ref={unproductiveRef}>0</strong>
          </span>
        </div>
        <canvas ref={canvasRef} width={900} height={220} style={styles.canvas} />
        <p style={styles.note}>
          Green = long-spectrum magnitude (0–5000Hz). Amber verticals = harmonics 1–8 of the current candidate set.
        </p>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Synthetic test tones</h2>
        <p style={styles.note}>Requires the synthetic-source engine to be running.</p>
        {SCENARIOS.map((s) => (
          <div key={s.kind} style={{ marginBottom: 6 }}>
            <button style={styles.button} onClick={() => playScenario(s.kind)}>
              {s.label}
            </button>
            <span style={styles.scenarioDesc}>{s.description}</span>
          </div>
        ))}
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Event log</h2>
        <div ref={logScrollRef} style={styles.logBox} data-testid="log-box">
          {log.map((entry) => (
            <div key={entry.id} style={styles.logLine} data-testid="log-line">
              <span style={styles.logTs}>{entry.ts}</span> {entry.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function drawSpectrum(
  canvas: HTMLCanvasElement | null,
  engine: AudioPitchEngine | null,
  bufRef: React.RefObject<Float32Array<ArrayBuffer> | null>,
  expected: Set<number>,
): void {
  if (!canvas) return
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return
  const width = canvas.width
  const height = canvas.height

  ctx2d.fillStyle = '#111827'
  ctx2d.fillRect(0, 0, width, height)

  const analyser = engine?.getLongAnalyser() ?? null
  if (!analyser) return

  if (!bufRef.current || bufRef.current.length !== analyser.frequencyBinCount) {
    bufRef.current = new Float32Array(analyser.frequencyBinCount)
  }
  const buf = bufRef.current
  analyser.getFloatFrequencyData(buf)

  const sampleRate = engine!.getContext().sampleRate
  const fftSize = buf.length * 2
  const binHz = sampleRate / fftSize
  const maxFreq = 5000
  const maxBin = Math.max(1, Math.min(buf.length - 1, Math.floor(maxFreq / binHz)))

  ctx2d.strokeStyle = '#4ade80'
  ctx2d.lineWidth = 1
  ctx2d.beginPath()
  for (let i = 0; i <= maxBin; i++) {
    const norm = clamp01((buf[i] + 140) / 140)
    const x = (i / maxBin) * width
    const y = height - norm * height
    if (i === 0) ctx2d.moveTo(x, y)
    else ctx2d.lineTo(x, y)
  }
  ctx2d.stroke()

  ctx2d.strokeStyle = 'rgba(250, 204, 21, 0.75)'
  ctx2d.lineWidth = 1
  for (const midi of expected) {
    const f0 = 440 * 2 ** ((midi - 69) / 12)
    for (let h = 1; h <= 8; h++) {
      const freq = f0 * h
      if (freq > maxFreq) break
      const bin = freq / binHz
      const x = (bin / maxBin) * width
      ctx2d.beginPath()
      ctx2d.moveTo(x, 0)
      ctx2d.lineTo(x, height)
      ctx2d.stroke()
    }
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    background: '#0b0f16',
    color: '#e5e7eb',
    minHeight: '100vh',
    padding: '20px 24px 60px',
    maxWidth: 960,
    margin: '0 auto',
  },
  h1: { fontSize: 20, marginBottom: 4 },
  h2: { fontSize: 15, marginBottom: 8, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  note: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  panel: { background: '#161c27', border: '1px solid #232b3a', borderRadius: 8, padding: 14, marginTop: 16 },
  radioLabel: { display: 'block', fontSize: 14, marginBottom: 6, cursor: 'pointer' },
  button: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    marginRight: 8,
  },
  presetButton: {
    background: '#1f2937',
    color: '#e5e7eb',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    marginRight: 6,
  },
  statusText: { fontSize: 13, color: '#9ca3af' },
  error: { marginTop: 8, color: '#fca5a5', fontSize: 13 },
  textInput: {
    background: '#0b0f16',
    color: '#e5e7eb',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 13,
    marginRight: 8,
    width: 220,
  },
  meterRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  meterLabel: { width: 50, fontSize: 13 },
  meterTrack: {
    position: 'relative',
    flex: 1,
    height: 14,
    background: '#0b0f16',
    border: '1px solid #374151',
    borderRadius: 4,
    overflow: 'hidden',
  },
  meterFill: { position: 'absolute', left: 0, top: 0, bottom: 0, background: '#22c55e', width: '0%' },
  floorTick: { position: 'absolute', top: 0, bottom: 0, width: 2, background: '#f97316', left: '0%' },
  meterValue: { width: 80, fontSize: 12, fontFamily: 'monospace', textAlign: 'right' },
  statsRow: { display: 'flex', gap: 20, fontSize: 13, marginBottom: 10 },
  canvas: { width: '100%', height: 180, display: 'block', borderRadius: 4 },
  scenarioDesc: { fontSize: 12, color: '#9ca3af', marginLeft: 4 },
  logBox: {
    height: 220,
    overflowY: 'auto',
    background: '#0b0f16',
    border: '1px solid #232b3a',
    borderRadius: 6,
    padding: 8,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  logLine: { whiteSpace: 'pre-wrap', marginBottom: 2 },
  logTs: { color: '#6b7280' },
}
