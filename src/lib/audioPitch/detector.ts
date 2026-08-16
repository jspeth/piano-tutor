// Pure, framework-free pitch-detection state machine for the audio-listening
// input (M10a). No Web Audio, no React, no DOM — it takes plain
// `Float32Array`s in (as if read straight off two `AnalyserNode`s) and
// returns note-on/note-off events, so it can be exercised with synthetic
// spectra in a unit/scratch test without a browser mic or even a real
// AudioContext. See memory-bank/audioPitchInput.md for the full design.

// ---------------------------------------------------------------------------
// Tunable constants. All of these are best-guess starting points; they are
// meant to be frozen empirically against the dev lab (step 5 of the plan),
// not treated as trustworthy out of the gate.
// ---------------------------------------------------------------------------

/** Initial noise-floor estimate (dB) before any frames arrive. */
const INITIAL_FLOOR_DB = -100

/**
 * The noise floor is a rolling *low percentile* of recent frame levels, not
 * the old monotonic min-with-capped-rise tracker. See the superseded
 * approach's comment (kept below, struck through in spirit) for why that
 * design deadlocked in a real room: it only let the floor rise while
 * `!soundingNow && !recentOnset`, which sounds safe in isolation, but in a
 * noisy room phantom "notes" are sounding and onsets are firing more or less
 * continuously (see the tonality-gate comment further down for why), so the
 * floor could never rise off its initial seed. It stayed pinned near -180dB
 * indefinitely, which made a real -56dB room read as ~124dB of headroom —
 * "Signal: good" in an empty room with nobody playing.
 *
 * A rolling percentile has no such deadlock state, by construction: it
 * doesn't care whether anything is "sounding" or an onset "just happened" —
 * it just asks what level most of the recent window sat at. A sustained
 * ringing note (or a run of false onsets) only ever occupies a fraction of a
 * multi-second window, so a low-enough percentile can't be dragged up by it;
 * genuine ambient level, being the *majority* of any real-world window,
 * dominates the low percentile regardless of what the detector currently
 * believes is sounding.
 */
const NOISE_FLOOR_WINDOW_MS = 12000

/**
 * Percentile (0-1) of the rolling level-history window used as the noise
 * floor. Low enough that a single sustained note — occupying at most a few
 * seconds of a 12s window — can't be inside it; high enough to track genuine
 * ambient level (not the single quietest instant, which would be noisy and
 * pessimistic) within a few seconds of a real level change.
 */
const NOISE_FLOOR_PERCENTILE = 0.2

/**
 * Decimation interval (ms) between samples pushed into the level-history ring
 * buffer. The buffer only needs a few dozen points to characterize a 12s
 * window's low percentile — sampling every rAF frame (~16.7ms) would be
 * ~720 samples of memory/sort cost for no accuracy benefit.
 */
const NOISE_FLOOR_SAMPLE_INTERVAL_MS = 150

/** How far above the floor the level must be before an onset can fire. */
const ONSET_MARGIN_DB = 10

/** Rolling-median window (frames) for spectral-flux onset detection. */
const FLUX_MEDIAN_WINDOW = 30

/** Minimum flux-history samples before onset detection is allowed to fire. */
const FLUX_MEDIAN_MIN_SAMPLES = 5

/** Flux must exceed the rolling median by this multiple to count as an onset. */
const ONSET_FLUX_MULTIPLIER = 2.5

/**
 * Absolute floor for the flux gate, as a fraction of the current short-
 * spectrum's total linear energy. During a sustained note's decay the
 * rolling flux median drops toward zero, so the *relative* test above
 * (median * 2.5) stops protecting against anything — trivial bin-to-bin
 * fluctuations clear "2.5x of near-zero" easily. This is the fix for a bug
 * found in the step-5 tuning pass: a single decaying note with no re-strike
 * produced false onsets at regular intervals purely from this unguarded
 * relative test (see memory-bank/audioPitchInput.md). Scaling to *current*
 * signal energy (not a fixed dB constant) keeps the gate level-relative,
 * which is the whole point of the room-mic design — it must survive
 * different mic gains and room loudness, not just the tuning session's.
 * Verified empirically against the lab's decaying-note and repeated-note
 * scenarios (see step-5 tuning notes).
 */
const ABSOLUTE_FLUX_ENERGY_RATIO = 0.08

/**
 * Below this level (dB), a frame is treated as literal digital silence, not
 * merely a quiet room — onset detection is skipped entirely regardless of
 * flux. Found instrumenting the single-note lab scenario's decay tail (see
 * memory-bank/audioPitchInput.md): as a note's gain ramps down toward true
 * zero, `levelDb` can crash abruptly to the RMS floor (`20*log10(EPSILON)` =
 * -180dB, since `rms()` clamps at `EPSILON`) well before the *long*-window
 * candidate score has caught up (that window still holds ~171ms of
 * pre-silence energy). At that same instant, `ABSOLUTE_FLUX_ENERGY_RATIO`'s
 * protection collapses too — it scales with the current frame's short-
 * spectrum energy, which is *also* at the numeric floor, so floating-point
 * noise trivially clears "a fraction of near-zero." The result: a spurious
 * onset fires at the exact moment of digital silence, re-detects the
 * still-elevated candidate score, and produces a second note-on immediately
 * after the (legitimate) level-triggered note-off. A fixed, non-relative
 * silence gate is the right tool here specifically because the failure mode
 * *is* an absolute one (literal floating-point zero, not "quiet") — unlike
 * every other threshold in this file, which must stay level-relative to
 * survive different mic gains and room loudness. -150dB is far below any
 * plausible real signal (a real room mic's own analog noise floor sits well
 * above this), so this only screens out numerically-degenerate silence.
 */
const SILENCE_LEVEL_DB = -150

/**
 * A new onset arriving while a strike window is already open must have flux
 * at least this multiple of the flux that opened the current window to
 * supersede it. Without this, a stale (possibly false) onset can hold a
 * window open for its full duration and swallow a genuine re-strike that
 * lands inside it. The multiple keeps a marginal bump from retriggering —
 * only a *clearly* louder new onset (a real hammer strike) can take over.
 */
const SUPERSEDE_FLUX_RATIO = 2

/** How long a strike window stays open after an onset, in ms. */
const STRIKE_WINDOW_MS = 400

/** Number of harmonics summed for candidate scoring. */
const HARMONIC_COUNT = 8

/** Odd harmonics only (h = 1, 3, 5, 7) — the ones `p+12` cannot produce. */
const ODD_HARMONICS = [1, 3, 5, 7]

/** Search radius (bins) around each harmonic's expected bin for its peak. */
const HARMONIC_BIN_SEARCH_RADIUS = 3

/** Half-width (bins) of the local window used to normalize a harmonic's SNR. */
const LOCAL_MEDIAN_HALF_WIDTH = 20

/**
 * Minimum peak-to-local-median SNR a *single* harmonic must clear to count as
 * "individually tonal" — see MIN_HARMONICS_CLEARING.
 */
const HARMONIC_CLEAR_SNR = 4

/**
 * Tonality/peakiness gate: a candidate may not fire a note-on unless at least
 * this many of its (up to `HARMONIC_COUNT`) harmonics *individually* clear
 * `HARMONIC_CLEAR_SNR`, in addition to its summed score clearing `SCORE_ON`.
 *
 * Found necessary testing against real room-microphone input (see
 * memory-bank/audioPitchInput.md): every threshold above this comment was
 * tuned against synthetic tones with no noise bed at all, i.e. a world with
 * a genuinely flat, near-zero spectrum everywhere the tone wasn't. Real room
 * noise (HVAC rumble, broadband hiss) is not flat-zero, it's flat-*loud* —
 * and summing eight harmonics' worth of noise-level "SNR" (each bin's
 * magnitude divided by a *local* median that is itself just more noise, so
 * ratios hover stubbornly around 1-2 purely from local variance) was enough
 * to clear `SCORE_ON` on broadband noise alone once the noise floor bug
 * (above) let the floor sit near -180dB and the onset gate fire continuously.
 * The missing discriminator is tonality: a struck piano note produces sharp,
 * narrow peaks that individually stand well above their local neighborhood at
 * harmonic bins; noise produces a roughly uniform SNR of ~1 everywhere,
 * including at those same bins, by chance as often as not. Summing hides
 * this — eight noise bins each mildly-elevated by chance can sum to the same
 * total as three or four genuinely sharp harmonic peaks. Requiring a *count*
 * of individually-clearing harmonics (not just a summed total) catches this:
 * noise essentially never produces three-plus bins that independently clear
 * a 4x local-median bar at exactly the harmonic frequencies of some
 * candidate pitch, while a real tone reliably does. Values tuned against the
 * lab's synthetic noise bed at ~20dB tone-to-noise SNR (the user's measured
 * real-room condition) — see the tuning-pass writeup.
 */
const MIN_HARMONICS_CLEARING = 3

/**
 * A variant of this gate applied to the octave guard's own `oddSum`-based
 * ratio (requiring individually-clearing *odd* harmonics, not just a summed
 * ratio) was tried and reverted during the noise-bed tuning pass — see
 * memory-bank/audioPitchInput.md. It fixed a specific noisy rolled-chord
 * octave misattribution, but flipped the guard's default away from "trust
 * the lower octave" (the deliberate, hard-won default from the original
 * bottom-two-octave tuning pass) whenever the individual-harmonic check
 * didn't confirm fast enough — which measurably broke the clean-signal
 * octave-pair and single-strike regressions that had been solid at 8/8 and
 * 12/12. Not worth the trade; the noisy chord octave-misattribution case is
 * accepted as a documented limitation instead.
 */

/** Score threshold for an expected-candidate note-on. */
const SCORE_ON = 6

/**
 * Non-expected candidates (e.g. the octave partner of an expected pitch) use
 * a stricter multiple of `SCORE_ON` — eager to confirm an expected pitch,
 * conservative to accuse an unexpected one.
 */
const SCORE_ON_STRICT_MULTIPLIER = 2

/** Note-off hysteresis threshold, as a fraction of `SCORE_ON`. */
const SCORE_OFF_RATIO = 0.4
const SCORE_OFF = SCORE_ON * SCORE_OFF_RATIO

/** Consecutive below-threshold frames required before a note-off fires. */
const NOTE_OFF_CONSECUTIVE_FRAMES = 8

/** Level margin above the floor below which a sounding note is released. */
const NOTE_OFF_LEVEL_MARGIN_DB = 6

/**
 * Octave guard: when `p` and `p+12` both clear their thresholds, prefer `p`
 * unless its odd-harmonic contribution (which `p+12` cannot produce) is
 * under this fraction of its total score — in which case the energy is more
 * likely actually the upper octave's fundamental plus even harmonics only.
 */
const OCTAVE_GUARD_ODD_RATIO = 0.25

/** A re-strike requires the argmax's score to jump at least this multiple of
 * its pre-onset value. */
const RESTRIKE_SCORE_RATIO = 1.5

/**
 * Minimum time (ms) since a strike window fired its note-on before a *later*
 * onset-flux uptick is allowed to supersede it (reopen a fresh window over an
 * already-successful one). Root cause this guards against (found
 * instrumenting a single-strike lab capture — see
 * memory-bank/audioPitchInput.md): a single physical strike's attack ramp
 * routinely produces several onset-gate-passing flux upticks a few ms apart
 * (the short-FFT frames each report a fresh flux spike while the amplitude
 * ramp and the long window's own settling are still in progress — measured
 * onsets 9-25ms apart from one physical strike). Once the first of these
 * fires a note-on, `strikeFired` is true, and the existing "an already-fired
 * window can always be superseded" rule (added so a same-loudness rolled-
 * chord note ~350ms later isn't blocked by the stricter flux-ratio test)
 * had no floor at all on *how soon* — so every subsequent onset-gate pass
 * from the very same attack reopened a fresh window, re-ran the confirm-frame
 * sequence, and landed in the re-strike branch, where the score comparison
 * trivially passed `RESTRIKE_SCORE_RATIO` (the note's own score keeps
 * climbing for hundreds of ms after onset — see below). Net effect: a
 * spurious note-off+note-on pair for the *same* pitch on essentially every
 * strike (measured 6/6 unfiltered runs, some producing two extra cycles).
 * This is not the note-off-hysteresis-during-attack mechanism originally
 * suspected — instrumentation showed the sounding pitch's score climbing
 * monotonically for hundreds of ms (an SNR-normalization artifact of a clean
 * synthetic tone: the local-median "noise" around each harmonic bin decays
 * faster than the harmonic peak itself, so score keeps rising well past the
 * long window's ~171ms fill time), never dipping toward `SCORE_OFF`. Gating
 * re-strike *acceptance* by elapsed time doesn't work, because that rising
 * score keeps clearing any fixed ratio-jump test regardless of how long is
 * given to "settle" — the fix has to stop the spurious reopen at its source.
 * Rolled-chord onsets (350ms apart) are comfortably above this gap and still
 * supersede freely; only same-attack noise within a few tens of ms is
 * blocked. A same-strike flux spike that somehow still clears
 * `SUPERSEDE_FLUX_RATIO` outright (much louder than the firing onset) can
 * still supersede before this gap elapses — that path is unchanged and is
 * there for a *louder* new event, not a repeat of the one just heard.
 */
const MIN_SUPERSEDE_GAP_MS = 150

/**
 * Consecutive frames the same argmax candidate must win before a note-on (or
 * re-strike) actually fires. Found empirically during the bottom-two-octave
 * tuning pass (see memory-bank/audioPitchInput.md): right after an onset, the
 * long-window FFT (8192 samples, ~171ms at 48kHz) hasn't yet absorbed enough
 * of the real tone to average out onset-transient spectral splatter, which is
 * disproportionately visible in the low bins near the octave-below candidate's
 * fundamental (a few Hz wide bins there cover a lot of relative frequency).
 * That transient noise can — for a single frame — clear both the strict
 * non-expected-candidate threshold *and* the odd-harmonic-ratio guard
 * (measured: ratios of 0.87-0.97 on pure noise, higher than a genuine note's
 * own steady-state ratio of ~0.7-0.8), handing the octave guard's exclusion
 * to the wrong candidate before the true note's score has even caught up.
 * The false reading never survives a second consecutive frame (~17-25ms
 * later) — it collapses as fast as it appeared — so requiring the same
 * candidate to win two frames in a row rejects it almost for free, at the
 * cost of one extra frame of latency (~20ms, negligible against wait mode's
 * indefinite hold).
 */
const ARGMAX_CONFIRM_FRAMES = 2

/**
 * Non-expected candidates (the octave guard's accusing path — "right key,
 * wrong octave" feedback) require more consecutive confirming frames than an
 * expected pitch. Measured need: even with `ARGMAX_CONFIRM_FRAMES = 2`, a C2
 * strike's onset-transient noise at the C1 candidate occasionally survives
 * two consecutive frames (measured 3/8 runs) and fires a real, if short-lived,
 * false note-on for C1 before C2 itself confirms and fires right after — the
 * correct note still ends up `lastHeardMidi`, but the false C1 note-on is
 * exactly the kind of misleading "wrong octave" feedback flash the design
 * doc's strict threshold exists to prevent. This extends the same
 * eager-to-confirm/conservative-to-accuse asymmetry that already governs the
 * score threshold (`SCORE_ON_STRICT_MULTIPLIER`) to the confirmation streak.
 */
const ARGMAX_CONFIRM_FRAMES_STRICT = 4

const MIN_MIDI = 0
const MAX_MIDI = 127

const EPSILON = 1e-9

export interface DetectorConfig {
  sampleRate: number
  longFftSize: number
  shortFftSize: number
}

export interface FrameInput {
  /** `getFloatFrequencyData` from the long (8192) analyser, in dB. */
  longDb: Float32Array
  /** `getFloatFrequencyData` from the short (2048) analyser, in dB. */
  shortDb: Float32Array
  /** Time-domain samples for RMS level. */
  timeDomain: Float32Array
  /** Timestamp of this frame, in ms (e.g. `performance.now()`). */
  timeMs: number
}

export type DetectorEvent = { type: 'noteon' | 'noteoff'; midi: number }

export interface DetectorMonitor {
  levelDb: number
  noiseFloorDb: number
  lastHeardMidi: number | null
  soundingMidis: number[]
  lastOnsetMs: number | null
  unproductiveOnsets: number
  signal: 'none' | 'weak' | 'good'
}

interface SoundingState {
  belowOffCount: number
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20)
}

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Parabolic-interpolated peak magnitude within `radius` bins of
 * `centerBinFloat`, and the local median magnitude around it (used to
 * normalize the peak into a noise-relative SNR). Both operate on a linear
 * magnitude spectrum.
 */
function peakAndLocalMedian(
  spectrum: Float32Array,
  centerBinFloat: number,
  radius: number,
  medianHalfWidth: number,
): { peak: number; median: number } {
  const n = spectrum.length
  const centerBin = Math.round(centerBinFloat)
  if (centerBin < 0 || centerBin >= n) return { peak: 0, median: EPSILON }

  const loSearch = Math.max(0, centerBin - radius)
  const hiSearch = Math.min(n - 1, centerBin + radius)
  let argmax = loSearch
  for (let i = loSearch + 1; i <= hiSearch; i++) {
    if (spectrum[i] > spectrum[argmax]) argmax = i
  }

  const left = argmax > 0 ? spectrum[argmax - 1] : spectrum[argmax]
  const center = spectrum[argmax]
  const right = argmax < n - 1 ? spectrum[argmax + 1] : spectrum[argmax]
  const denom = left - 2 * center + right
  let peak = center
  if (Math.abs(denom) > EPSILON) {
    const p = (0.5 * (left - right)) / denom
    peak = center - 0.25 * (left - right) * p
  }
  peak = Math.max(peak, 0)

  const loMedian = Math.max(0, centerBin - medianHalfWidth)
  const hiMedian = Math.min(n - 1, centerBin + medianHalfWidth)
  const medianWindow: number[] = []
  for (let i = loMedian; i <= hiMedian; i++) {
    if (i >= loSearch && i <= hiSearch) continue // exclude the peak's own bins
    medianWindow.push(spectrum[i])
  }
  const localMedian = Math.max(median(medianWindow), EPSILON)

  return { peak, median: localMedian }
}

/** Per-candidate harmonic-sum score, the odd-harmonic-only subtotal used by
 * the octave guard, and the count of harmonics that individually clear the
 * tonality gate's per-harmonic SNR bar (see MIN_HARMONICS_CLEARING). */
function scoreCandidate(
  midi: number,
  longLinear: Float32Array,
  fftSize: number,
  sampleRate: number,
): { total: number; oddSum: number; harmonicsClearing: number } {
  const f0 = midiToFreq(midi)
  let total = 0
  let oddSum = 0
  let harmonicsClearing = 0
  for (let h = 1; h <= HARMONIC_COUNT; h++) {
    const freq = f0 * h
    const nyquist = sampleRate / 2
    if (freq >= nyquist) break
    const bin = (freq * fftSize) / sampleRate
    const { peak, median: localMedian } = peakAndLocalMedian(
      longLinear,
      bin,
      HARMONIC_BIN_SEARCH_RADIUS,
      LOCAL_MEDIAN_HALF_WIDTH,
    )
    const snr = peak / localMedian
    const contribution = snr / h
    total += contribution
    if (ODD_HARMONICS.includes(h)) oddSum += contribution
    if (snr >= HARMONIC_CLEAR_SNR) harmonicsClearing++
  }
  return { total, oddSum, harmonicsClearing }
}

function rms(timeDomain: Float32Array): number {
  let sumSquares = 0
  for (let i = 0; i < timeDomain.length; i++) {
    sumSquares += timeDomain[i] * timeDomain[i]
  }
  return Math.sqrt(sumSquares / Math.max(timeDomain.length, 1))
}

export class PitchDetector {
  private readonly sampleRate: number
  private readonly longFftSize: number
  // shortFftSize isn't needed internally — spectral flux only diffs
  // same-length short-spectrum bins index-for-index, never converts a bin to
  // a frequency. Kept out of the stored fields (would trip noUnusedLocals)
  // but still part of DetectorConfig for API symmetry with longFftSize.

  private noiseFloorDb = INITIAL_FLOOR_DB
  private levelDb = INITIAL_FLOOR_DB

  // Rolling level history backing the percentile noise floor (see
  // NOISE_FLOOR_WINDOW_MS). Decimated: only one entry is kept per
  // NOISE_FLOOR_SAMPLE_INTERVAL_MS, not one per frame.
  private levelHistory: { t: number; db: number }[] = []
  private lastLevelSampleMs: number | null = null

  private prevShortLinear: Float32Array | null = null
  private fluxHistory: number[] = []

  private lastOnsetMs: number | null = null
  private strikeWindowEndMs: number | null = null
  private strikeFired = false
  /** `timeMs` the current window's note-on (or re-strike) fired, if any — see
   * `MIN_SUPERSEDE_GAP_MS`. */
  private strikeFiredAtMs: number | null = null
  private windowProductive = false
  private windowOpeningFlux = 0
  private preOnsetScores: Map<number, number> = new Map()
  private prevCandidateScores: Map<number, number> = new Map()

  // Cross-frame confirmation state for the argmax decision (see
  // ARGMAX_CONFIRM_FRAMES) — reset whenever a fresh strike window opens.
  private pendingArgmaxMidi: number | null = null
  private pendingArgmaxStreak = 0

  private expected: ReadonlySet<number> = new Set()
  private sounding = new Map<number, SoundingState>()

  private lastHeardMidi: number | null = null
  private unproductiveOnsets = 0

  constructor(config: DetectorConfig) {
    this.sampleRate = config.sampleRate
    this.longFftSize = config.longFftSize
  }

  setCandidates(expected: ReadonlySet<number>): void {
    this.expected = new Set(expected)
  }

  private workingCandidates(): Set<number> {
    const candidates = new Set<number>(this.expected)
    for (const p of this.expected) {
      if (p - 12 >= MIN_MIDI) candidates.add(p - 12)
      if (p + 12 <= MAX_MIDI) candidates.add(p + 12)
    }
    for (const p of this.sounding.keys()) candidates.add(p)
    return candidates
  }

  /**
   * Recomputes the noise floor as the `NOISE_FLOOR_PERCENTILE`-th percentile
   * of a rolling, decimated history of frame levels. Deliberately
   * unconditional — no "only while nothing is sounding" gate of any kind (see
   * NOISE_FLOOR_WINDOW_MS's comment for why that used to exist and why it was
   * a deadlock, not a safeguard). Self-correcting by construction: it always
   * reflects whatever level actually dominated the recent window, whether
   * that's true silence, room hum, or someone holding a chord.
   */
  private updateNoiseFloor(timeMs: number): void {
    if (
      this.lastLevelSampleMs === null ||
      timeMs - this.lastLevelSampleMs >= NOISE_FLOOR_SAMPLE_INTERVAL_MS
    ) {
      this.levelHistory.push({ t: timeMs, db: this.levelDb })
      this.lastLevelSampleMs = timeMs
      const cutoff = timeMs - NOISE_FLOOR_WINDOW_MS
      while (this.levelHistory.length > 0 && this.levelHistory[0].t < cutoff) {
        this.levelHistory.shift()
      }
    }

    if (this.levelHistory.length === 0) {
      this.noiseFloorDb = this.levelDb
      return
    }
    const sorted = this.levelHistory.map((e) => e.db).sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * NOISE_FLOOR_PERCENTILE))
    this.noiseFloorDb = sorted[idx]
  }

  private closeExpiredWindowIfAny(timeMs: number): void {
    if (this.strikeWindowEndMs === null) return
    if (timeMs <= this.strikeWindowEndMs) return
    if (!this.windowProductive) this.unproductiveOnsets++
    this.strikeWindowEndMs = null
    this.strikeFired = false
    this.strikeFiredAtMs = null
    this.windowProductive = false
  }

  processFrame(f: FrameInput): DetectorEvent[] {
    const events: DetectorEvent[] = []

    this.levelDb = 20 * Math.log10(Math.max(rms(f.timeDomain), EPSILON))
    this.updateNoiseFloor(f.timeMs)

    // Close out a strike window that expired before this frame, so its
    // unproductive-onset bookkeeping happens before we consider a new onset.
    this.closeExpiredWindowIfAny(f.timeMs)

    const longLinear = new Float32Array(f.longDb.length)
    for (let i = 0; i < f.longDb.length; i++) longLinear[i] = dbToLinear(f.longDb[i])

    const shortLinear = new Float32Array(f.shortDb.length)
    for (let i = 0; i < f.shortDb.length; i++) shortLinear[i] = dbToLinear(f.shortDb[i])

    // Spectral flux, in the linear domain (the analyser gives dB).
    let flux = 0
    if (this.prevShortLinear) {
      for (let i = 0; i < shortLinear.length; i++) {
        const diff = shortLinear[i] - this.prevShortLinear[i]
        if (diff > 0) flux += diff
      }
    }
    this.fluxHistory.push(flux)
    if (this.fluxHistory.length > FLUX_MEDIAN_WINDOW) this.fluxHistory.shift()
    this.prevShortLinear = shortLinear

    // Total linear energy of the current short spectrum — the reference for
    // the absolute flux floor below (see ABSOLUTE_FLUX_ENERGY_RATIO).
    let shortEnergy = 0
    for (let i = 0; i < shortLinear.length; i++) shortEnergy += shortLinear[i]

    const fluxMedian = median(this.fluxHistory)
    const fluxGate = Math.max(fluxMedian * ONSET_FLUX_MULTIPLIER, shortEnergy * ABSOLUTE_FLUX_ENERGY_RATIO)
    const onsetDetected =
      this.levelDb > SILENCE_LEVEL_DB &&
      this.fluxHistory.length >= FLUX_MEDIAN_MIN_SAMPLES &&
      this.levelDb > this.noiseFloorDb + ONSET_MARGIN_DB &&
      flux > fluxGate

    if (onsetDetected) {
      const windowOpen = this.strikeWindowEndMs !== null
      // A window that has already fired its note-on has done its job — the
      // supersede ratio exists to stop a *stale, still-deciding* window (one
      // that opened on a false onset) from swallowing a genuine subsequent
      // strike, not to make every already-successful strike wait out its full
      // 400ms before the next one can be heard. Without this, closely spaced
      // real onsets (a rolled chord: measured 350ms apart, inside the 400ms
      // window) require the new note's flux to clear 2x the previous onset's
      // flux, which a same-loudness note over already-ringing notes often
      // doesn't — the rolled-chord scenario measurably dropped its third note
      // in ~3/8 runs before this. See memory-bank/audioPitchInput.md.
      //
      // The "already fired" bypass must not be unconditional, though: a
      // single physical strike's own attack ramp routinely produces several
      // onset-gate-passing flux upticks a few ms apart (see
      // MIN_SUPERSEDE_GAP_MS's comment) — without a minimum gap since the
      // window's own note-on, every one of those reopened the window and
      // fired a spurious note-off+note-on for the same pitch. Rolled-chord
      // onsets (350ms apart) clear this gap comfortably.
      const firedRecently =
        this.strikeFiredAtMs !== null && f.timeMs - this.strikeFiredAtMs < MIN_SUPERSEDE_GAP_MS
      const supersedesOpenWindow =
        windowOpen &&
        ((this.strikeFired && !firedRecently) || flux > this.windowOpeningFlux * SUPERSEDE_FLUX_RATIO)
      if (!windowOpen || supersedesOpenWindow) {
        this.lastOnsetMs = f.timeMs
        this.strikeWindowEndMs = f.timeMs + STRIKE_WINDOW_MS
        this.strikeFired = false
        this.strikeFiredAtMs = null
        this.windowProductive = false
        this.windowOpeningFlux = flux
        this.preOnsetScores = new Map(this.prevCandidateScores)
        this.pendingArgmaxMidi = null
        this.pendingArgmaxStreak = 0
      }
    }

    // Score every working candidate against the long spectrum.
    const candidates = this.workingCandidates()
    const candidateScores = new Map<number, { total: number; oddSum: number; harmonicsClearing: number }>()
    for (const midi of candidates) {
      candidateScores.set(
        midi,
        scoreCandidate(midi, longLinear, this.longFftSize, this.sampleRate),
      )
    }

    // Note-off hysteresis for currently-sounding pitches.
    for (const [midi, state] of this.sounding) {
      const score = candidateScores.get(midi)?.total ?? 0
      const belowThreshold = score < SCORE_OFF || this.levelDb < this.noiseFloorDb + NOTE_OFF_LEVEL_MARGIN_DB
      if (belowThreshold) {
        state.belowOffCount++
      } else {
        state.belowOffCount = 0
      }
    }
    for (const [midi, state] of [...this.sounding]) {
      if (state.belowOffCount >= NOTE_OFF_CONSECUTIVE_FRAMES) {
        this.sounding.delete(midi)
        events.push({ type: 'noteoff', midi })
      }
    }

    // Argmax selection, only inside an open, not-yet-fired strike window.
    if (this.strikeWindowEndMs !== null && f.timeMs <= this.strikeWindowEndMs && !this.strikeFired) {
      const result = this.pickArgmax(candidates, candidateScores)

      // Require the same candidate to win the argmax on ARGMAX_CONFIRM_FRAMES
      // consecutive frames before acting on it — rejects the single-frame
      // onset-transient false positives described at ARGMAX_CONFIRM_FRAMES's
      // definition without meaningfully hurting latency.
      if (result && result.midi === this.pendingArgmaxMidi) {
        this.pendingArgmaxStreak++
      } else {
        this.pendingArgmaxMidi = result?.midi ?? null
        this.pendingArgmaxStreak = result ? 1 : 0
      }

      const requiredStreak =
        result && this.expected.has(result.midi) ? ARGMAX_CONFIRM_FRAMES : ARGMAX_CONFIRM_FRAMES_STRICT
      if (result && this.pendingArgmaxStreak >= requiredStreak) {
        const { midi, alreadySounding } = result
        if (alreadySounding) {
          const preScore = this.preOnsetScores.get(midi) ?? 0
          const postScore = candidateScores.get(midi)?.total ?? 0
          if (postScore >= preScore * RESTRIKE_SCORE_RATIO) {
            events.push({ type: 'noteoff', midi })
            events.push({ type: 'noteon', midi })
            this.sounding.set(midi, { belowOffCount: 0 })
            this.lastHeardMidi = midi
            this.strikeFired = true
            this.strikeFiredAtMs = f.timeMs
            this.windowProductive = true
          }
          // Not a genuine re-strike: leave the window open, still ringing.
        } else {
          events.push({ type: 'noteon', midi })
          this.sounding.set(midi, { belowOffCount: 0 })
          this.lastHeardMidi = midi
          this.strikeFired = true
          this.strikeFiredAtMs = f.timeMs
          this.windowProductive = true
        }
      }
    }

    const totals = new Map<number, number>()
    for (const [midi, s] of candidateScores) totals.set(midi, s.total)
    this.prevCandidateScores = totals

    return events
  }

  private pickArgmax(
    candidates: Set<number>,
    candidateScores: Map<number, { total: number; oddSum: number; harmonicsClearing: number }>,
  ): { midi: number; alreadySounding: boolean } | null {
    // Resolve octave-guard pairs first: when p and p+12 are both candidates,
    // decide which one "owns" the energy so only one enters the argmax pool.
    const excluded = new Set<number>()
    for (const p of candidates) {
      const upper = p + 12
      if (!candidates.has(upper)) continue
      if (excluded.has(p) || excluded.has(upper)) continue
      const lowerScore = candidateScores.get(p)
      const upperScore = candidateScores.get(upper)
      if (!lowerScore || !upperScore) continue
      const lowerClears =
        lowerScore.total >= this.thresholdFor(p) && lowerScore.harmonicsClearing >= MIN_HARMONICS_CLEARING
      const upperClears =
        upperScore.total >= this.thresholdFor(upper) && upperScore.harmonicsClearing >= MIN_HARMONICS_CLEARING
      if (!lowerClears || !upperClears) continue

      const oddRatio = lowerScore.total > EPSILON ? lowerScore.oddSum / lowerScore.total : 0
      if (oddRatio >= OCTAVE_GUARD_ODD_RATIO) {
        excluded.add(upper)
      } else {
        excluded.add(p)
      }
    }

    // Ranking the pool by score-rise-since-window-open (rather than raw
    // score) was tried during the noise-bed tuning pass to fix a dropped
    // rolled-chord note under noise, but reverted — see
    // memory-bank/audioPitchInput.md. It changed enough about which
    // candidate confirms first in the unsettled frames right after an onset
    // that it introduced a *new*, reproducible wrong-octave regression in
    // the plain rolled-chord scenario (no noise at all), where this had been
    // solid at 8/8. Not worth the trade; back to ranking by raw score.
    let best: number | null = null
    let bestScore = -Infinity
    for (const midi of candidates) {
      if (excluded.has(midi)) continue
      // Publishing suppression for pure octave partners (see
      // isPublishable's comment): a candidate that is only in the working
      // set because it's `p±12` of an expected pitch — not itself expected,
      // and not already a published, currently-sounding pitch — may still
      // decide the octave guard's exclusion above, but may never win the
      // final argmax and fire a note-on. Skipping it here (rather than
      // filtering the input `candidates` set) is deliberate: it must still
      // have been scored and available to the exclusion step above.
      if (!this.isPublishable(midi)) continue
      const score = candidateScores.get(midi)
      if (!score) continue
      const threshold = this.thresholdFor(midi)
      if (score.total < threshold) continue
      // Tonality gate (see MIN_HARMONICS_CLEARING): a summed score alone
      // isn't sufficient — broadband noise can clear it too. Require several
      // harmonics to independently stand out from their own local spectrum.
      if (score.harmonicsClearing < MIN_HARMONICS_CLEARING) continue
      if (score.total > bestScore) {
        bestScore = score.total
        best = midi
      }
    }

    if (best === null) return null
    return { midi: best, alreadySounding: this.sounding.has(best) }
  }

  private thresholdFor(midi: number): number {
    return this.expected.has(midi) ? SCORE_ON : SCORE_ON * SCORE_ON_STRICT_MULTIPLIER
  }

  /**
   * A candidate may win the final argmax and fire a note-on only if it is
   * genuinely expected by the current step, or is already a published,
   * currently-sounding pitch (so note-offs keep tracking a note that was
   * expected by a *previous* step but is still ringing — see
   * `workingCandidates`'s "currently-sounding pitches" clause). This is the
   * fallback named in the plan's "Feedback flash policy" section: octave
   * partners (`p±12`, added to the working set purely for the octave
   * guard's arbitration) still participate in scoring and in
   * `pickArgmax`'s exclusion step above, but can never themselves publish —
   * only decide which of a genuine pair "owns" the energy. Found necessary
   * in real-mic testing: the octave guard's exclusion only engages when
   * *both* the lower and upper candidate clear threshold; if a real C4's
   * own score dips below threshold for a frame (attack transient, room
   * null, noise) while C5's clears — physically expected, since C5's
   * harmonic series sits entirely on C4's even harmonics — the guard skips
   * arbitration and C5 would otherwise win the argmax unopposed. Suppressing
   * publication by "was this only added as an octave partner," not by pitch
   * value, is what lets a step that genuinely expects both C4 and C5 still
   * publish either one normally (both are in `this.expected`, so both are
   * publishable).
   *
   * Consequence, documented in memory-bank/audioPitchInput.md's "Known
   * issues" section: since the working candidate set is expected ∪ octaves
   * ∪ sounding, and only expected/sounding pitches can publish, every
   * published audio note-on is now necessarily an expected pitch — audio
   * input can no longer produce a published wrong-note detection at all,
   * "right key, wrong octave" included. Wrong notes simply fail to advance
   * the step.
   */
  private isPublishable(midi: number): boolean {
    return this.expected.has(midi) || this.sounding.has(midi)
  }

  forceRelease(): DetectorEvent[] {
    const events: DetectorEvent[] = []
    for (const midi of this.sounding.keys()) {
      events.push({ type: 'noteoff', midi })
    }
    this.sounding.clear()
    this.strikeWindowEndMs = null
    this.strikeFired = false
    this.strikeFiredAtMs = null
    this.windowProductive = false
    return events
  }

  getMonitor(): DetectorMonitor {
    let signal: DetectorMonitor['signal'] = 'none'
    if (this.levelDb > this.noiseFloorDb + ONSET_MARGIN_DB) signal = 'good'
    else if (this.levelDb > this.noiseFloorDb + ONSET_MARGIN_DB / 2) signal = 'weak'

    return {
      levelDb: this.levelDb,
      noiseFloorDb: this.noiseFloorDb,
      lastHeardMidi: this.lastHeardMidi,
      soundingMidis: [...this.sounding.keys()],
      lastOnsetMs: this.lastOnsetMs,
      unproductiveOnsets: this.unproductiveOnsets,
      signal,
    }
  }
}
