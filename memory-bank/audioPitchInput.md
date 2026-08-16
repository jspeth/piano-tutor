# M10a — Audio pitch input (monophonic, wait-mode only, room microphone)

Working plan for the audio-listening input feature. Agreed with the user
2026-08-16. Supplements [PLAN.md](../PLAN.md); fold a milestone summary back
into PLAN.md and [progress.md](progress.md) when the work lands.

## Framing (governs every tradeoff below)

An explicitly **best-effort, experimental nice-to-have**: let someone with a
digital keyboard but no MIDI cable use wait-for-key mode by having the browser
listen to the keyboard's built-in speakers through the built-in laptop
microphone.

User's framing, verbatim: *"let's try for no extra hardware, no cables, no
headphones. do the best we can with built in mic. it's mostly a nice to have
and if you want better, get a cheap usb cable."*

Consequences:

- **Optimize for legible failure, not detection rate.** A room mic imposes a
  hard accuracy ceiling. The valuable property is that the user can always see
  *why* it isn't working (too quiet, too noisy, mic processing, note out of
  range), not that we squeezed out a few more percent.
- **"Get a USB-MIDI cable" is a designed, first-class outcome** the UI points
  at when detection struggles — not a limitation buried in a README.
- **Labelled experimental at the point of use**, so a missed note doesn't read
  as a bug.
- **Simple and robust over clever and fragile**, everywhere there's a
  tradeoff.

## Agreed constraints

1. **Monophonic only** — one note-on per onset. (Chord steps still work; see
   "Chord steps" below.)
2. **Wait mode only** — detection publishes note-ons only while wait mode is
   holding on a step. This deliberately sidesteps the app's own sampler
   bleeding into the mic, since the transport is paused while waiting.
3. **Built-in room microphone is the only design target** — no line-in, no
   cables, no headphones, no USB audio interface.
4. **DSP, not ML** — no ONNX/TensorFlow/basic-pitch. Keep the bundle small
   and the code reasonable-about-able.
5. **Candidate-set scoring, not open transcription** — wait mode already
   knows the expected pitches, so this is *verification*, not transcription.
   That is what makes it tractable.

## Key architectural decisions

### AnalyserNode, not AudioWorklet + hand-rolled FFT

Two `AnalyserNode`s (2048 for spectral-flux onset detection, 8192 for pitch
scoring), both with `smoothingTimeConstant = 0`, polled from the existing
shared rAF loop in [frameLoop.ts](../src/lib/frameLoop.ts) (~16.7 ms hop).

Rationale: browser-native C++ FFTs for free, no DSP infrastructure to write
and validate, and it avoids a real Vite problem (TS AudioWorklet modules don't
load cleanly in dev — the workarounds are a raw-JS file or a Blob-URL code
string, both ugly). Costs: Blackman window instead of Hann (fine, better
sidelobes), and ~100–300 ms detection latency from the 8192 window (~171 ms at
48 kHz) — irrelevant for wait mode's indefinite hold. `LONG_FFT_SIZE` stays a
tunable constant; 4096 halves latency at the cost of bass resolution, decided
empirically during tuning.

### player.ts needs no new API

`onExpectedNotesChange` already delivers the current step's pitches to
`App.tsx` state (`expectedNotes`). The hook takes `{ waitHoldActive,
candidates }` derived from existing App state. **[player.ts](../src/lib/player.ts)
and [steps.ts](../src/lib/steps.ts) are untouched by this milestone.**

### The one downstream break: sampler double-sounding

Everything downstream of the note-input bus works unchanged (lit keys,
`NoteReadout`, wait-mode step advancement, correct/incorrect feedback) —
same as Web MIDI in M5 — with exactly one exception:

[App.tsx:128-139](../src/App.tsx) attacks the sampler on pressed-set 0→1
transitions, deliberately source-agnostically. An audio note-on would re-sound
the sampler *over the user's actual piano*.

Fix: [noteInput.ts](../src/lib/noteInput.ts) gains a second derived snapshot,
**sounding notes** — the pressed set minus sources whose sound already exists
physically in the room:

```ts
const SILENT_SOURCES: ReadonlySet<NoteInputSource> = new Set(['audio'])
```

with `getSoundingNotes()` / `subscribeSounding()` exports maintained alongside
`pressedSnapshot` (the `holders` map already carries per-source counts, so
this is a filter, not new bookkeeping). App's sampler effect switches to
`subscribeSounding`; the full pressed set (lit keys, readout,
`usePressedNotes`) still includes audio.

Note MIDI keyboards must keep sounding the sampler — many are silent
controllers. Only `'audio'` is silent-by-definition.

Tradeoff accepted: `noteInput.ts` stops being 100% policy-free. The
alternative (App-local raw subscription with its own hold counts) duplicates
the hold-count logic this module exists to own. One commented constant is the
cheaper cost.

### Chord steps work without polyphony

Wait-mode satisfaction *accumulates* fresh note-ons — added originally so a
single mouse pointer can play a chord one note at a time (see PLAN.md's
wait-mode section). A **rolled** chord through the mic rides the identical
mechanism: each rolled note is its own onset → its own argmax note-on →
accumulates. Already-sounding pitches are excluded from the argmax, so
ringing chord notes don't block the next one.

Degradation is legible: if a rolled note isn't heard, the step just doesn't
advance and the monitor shows what was (not) heard. Rejected: skipping chord
steps (silently teaches the piece wrong), disabling audio for chord steps
(confusing mid-song modality switch).

## New files

### `src/lib/audioPitch/detector.ts`

Pure, framework-free, DOM-free state machine. No Web Audio, no React — fully
testable against synthetic `Float32Array`s.

```ts
interface DetectorConfig { sampleRate: number; longFftSize: number; shortFftSize: number }
interface FrameInput {
  longDb: Float32Array      // analyser 8192 getFloatFrequencyData
  shortDb: Float32Array     // analyser 2048 getFloatFrequencyData
  timeDomain: Float32Array  // for RMS level
  timeMs: number
}
type DetectorEvent = { type: 'noteon' | 'noteoff'; midi: number }
interface DetectorMonitor {
  levelDb: number; noiseFloorDb: number
  lastHeardMidi: number | null; soundingMidis: number[]
  lastOnsetMs: number | null; unproductiveOnsets: number
  signal: 'none' | 'weak' | 'good'
}
class PitchDetector {
  constructor(config: DetectorConfig)
  setCandidates(expected: ReadonlySet<number>): void
  processFrame(f: FrameInput): DetectorEvent[]
  forceRelease(): DetectorEvent[]
  getMonitor(): DetectorMonitor
}
```

All thresholds are named constants at the top of the file, tuned empirically
in the lab.

**Noise floor** — a rolling **low percentile** (`NOISE_FLOOR_PERCENTILE`,
0.2) of frame levels over a `NOISE_FLOOR_WINDOW_MS` (12s) window, backed by a
decimated ring buffer (one sample per `NOISE_FLOOR_SAMPLE_INTERVAL_MS`, 150ms
— a few dozen points, not one per frame).

> **This supersedes the original min-tracking-with-capped-rise design (and
> its own "correction," below) — both are dead ends, found in real-room
> testing after step 5 shipped.** The original design: the floor falls
> instantly to a new, quieter level, and rises at a capped `FLOOR_RISE_DB_PER_SEC`
> (3 dB/s).
>
> **Correction to the original plan (caught in review, before any code
> existed):** the floor must **only rise during frames with no note sounding
> and no recent onset.** A ringing piano note is sustained energy; an
> unconditional 3 dB/s rise lets the floor creep toward it and suppress
> subsequent detection — 20–30 dB over a slow practice passage, worse with
> the sustain pedal down.
>
> **That correction was itself the bug, discovered testing with a real
> laptop mic in a real room** (see the "Noise-bed bug-fix pass" section
> below for the full writeup): `!soundingNow && !recentOnset` sounds like a
> narrow, defensible guard in isolation, but it is a **deadlock condition**
> once the tonality gate didn't exist yet to stop broadband room noise from
> hallucinating notes. In a genuinely noisy room, phantom "notes" are
> sounding and onsets are firing more or less continuously — so the one
> condition that would ever let the floor rise (*nothing* sounding, *no*
> recent onset) never actually occurred. The floor stayed pinned near its
> `INITIAL_FLOOR_DB` seed (-100dB, decaying toward the RMS numeric floor)
> indefinitely. Observed live: `Level: -56.0dB`, `Signal: good`, and
> `Unproductive onsets: 134` and climbing, in an **empty room with nobody
> playing anything** — a real -56dB room read as ~124dB of headroom. The
> false detections locked the floor down, and the locked-down floor
> perpetuated the false detections: a true deadlock, not just a slow
> convergence.
>
> **The fix is a different mechanism, not a relaxed guard.** A rolling low
> percentile has no equivalent deadlock state, by construction: it doesn't
> ask what the detector currently *believes* is sounding, only what level
> most of a multi-second window actually sat at. A sustained ringing note
> (or a run of false onsets) only ever occupies a fraction of a 12s window,
> so a low-enough percentile can't be dragged up by it — the original
> anti-creep motivation is satisfied for free, with no conditional logic and
> no failure mode where the condition is never true. Genuine ambient level,
> being the majority of any real-world window, dominates the low percentile
> regardless of detection state. Verified: the original motivating case (the
> floor must not creep upward during a sustained ringing note) still holds —
> `noise floor does not creep during sustain` passes 5/5 with the noise bed
> enabled — and the empty-room case now reads its true ambient level within
> a couple of seconds of the noise bed switching on, with signal correctly
> reporting `none`.

**Onset** — spectral flux on the short spectrum (sum of positive per-bin
magnitude increases, converted to linear from the analyser's dB), compared
against a rolling median of recent flux × ~2.5, gated on
`level > floor + ONSET_MARGIN_DB` (~10). An onset opens a ~400 ms *strike
window*.

**Candidate scoring** (only inside a strike window, only over the active
candidate set): for candidate pitch `p`, `f0 = 440 · 2^((p-69)/12)`;

```
score(p) = Σ h=1..8  (1/h) · SNR(h·f0)
```

where `SNR` is the parabolic-interpolated peak power within ±3 bins of
`h·f0` divided by the local spectral median — so scores are noise-relative,
not absolute. This is the second half of the room-mic adaptation.

**Tonality gate** — added in the noise-bed bug-fix pass (see below): a
candidate may not fire a note-on unless at least `MIN_HARMONICS_CLEARING`
(3) of its harmonics *individually* clear a per-harmonic SNR bar
(`HARMONIC_CLEAR_SNR`, 4×), in addition to the summed `score(p)` clearing
`SCORE_ON`. This is the missing discriminator that let real room noise
hallucinate notes even with a correctly-behaving noise floor: summing eight
harmonics' worth of noise-level "SNR" (each bin's magnitude over a *local*
median that is itself just more noise, so ratios hover around 1–2 from local
variance alone) can clear the same summed threshold a real struck note does
— a handful of mildly-elevated noise bins add up to the same total as three
or four genuinely sharp harmonic peaks. A struck piano note produces sharp,
narrow peaks that individually stand out from their local neighborhood at
harmonic bins; broadband noise doesn't reliably produce three-plus bins that
each individually clear a 4× local-median bar at exactly the harmonic
frequencies of some candidate pitch. See the noise-bed section below for
the measurement this was tuned against and the options considered.

Working candidate set = expected step pitches ∪ their ±12-semitone octaves
(for the guard and octave-error feedback) ∪ currently-sounding pitches (so
note-offs keep tracking after a step advances).

**Octave guard** — when `p` and `p+12` both clear threshold, prefer `p`
unless `p`'s odd-harmonic contribution (h = 1, 3, 5, 7 — the harmonics `p+12`
cannot produce) is under ~25% of its score.

**One note-on per onset** — at most the argmax candidate above threshold
fires per strike window. Expected pitches use `SCORE_ON`; non-expected
(octave) candidates use a stricter `2 × SCORE_ON` — eager to confirm,
conservative to accuse. Multiple pitches may still be concurrently *sounding*
(legato, rolled chords), each from its own onset.

> **Added in the bottom-two-octave tuning pass:** the argmax winner must also
> be *stable* — the same candidate must win `ARGMAX_CONFIRM_FRAMES` (2)
> consecutive frames for an expected pitch, or `ARGMAX_CONFIRM_FRAMES_STRICT`
> (4) for a non-expected (octave-accusing) one — before it actually fires.
> This rejects a onset-transient race specific to the bottom two octaves; see
> the detailed writeup after the onset-gate bug-fix note below. A window that
> has already fired no longer requires its successor's onset to clear
> `SUPERSEDE_FLUX_RATIO`, so closely-spaced rolled-chord onsets (measured
> 350ms apart, inside the 400ms strike window) aren't blocked from opening
> their own window — see the rolled-chord writeup in the same place.

**Re-strike** — if an onset's argmax is already sounding and its score jumps
≥ ~1.5× its pre-onset value, emit noteoff+noteon. Required for repeated-note
steps: a still-ringing note must never satisfy the next step, but a genuine
re-strike must.

> **Bug found and fixed during the step-5 tuning pass (misdiagnosed once,
> then corrected):** the repeated-note lab scenario failed, and the first
> pass blamed phase cancellation between re-struck sine oscillators in the
> synthetic test tone. That was wrong — a level trace across the re-strike
> showed a clean +15 dB jump (−33.6 dB → −18.7 dB), not the amplitude drop
> destructive interference would cause. The real defects were in the onset
> gate itself, both in `detector.ts`:
>
> 1. **No absolute floor on the flux test.** The gate was
>    `level > floor + 10dB && flux > fluxMedian * 2.5` — purely relative.
>    During a sustained note's decay, `noiseFloorDb` is (correctly) pinned by
>    the anti-creep guard above, so the level margin test is trivially true
>    and provides no protection; that leaves only the flux-vs-median test,
>    and during a decay the rolling flux median collapses toward zero, so
>    trivial bin-to-bin fluctuations clear "2.5× of near-zero." A single
>    decaying note with no re-strike produced false onsets (verified: t≈375,
>    775, 1125 ms in one trace, each incrementing `unproductiveOnsets`, while
>    level decayed monotonically). Fixed by adding
>    `ABSOLUTE_FLUX_ENERGY_RATIO` — the flux gate is now
>    `max(fluxMedian * ONSET_FLUX_MULTIPLIER, shortEnergy * ABSOLUTE_FLUX_ENERGY_RATIO)`,
>    where `shortEnergy` is the current frame's total short-spectrum linear
>    energy. Scaling to *current* signal energy (not a fixed dB constant)
>    keeps the gate level-relative — required for this to survive different
>    room levels and mic gains, same rationale as everything else in this
>    design.
> 2. **An open strike window couldn't be superseded.** A window only opened
>    when `strikeWindowEndMs === null`; a false onset (from defect 1) that
>    opened a window could hold it open for the full 400 ms and swallow a
>    genuine re-strike landing inside it. Fixed with `SUPERSEDE_FLUX_RATIO`:
>    a new onset may open a fresh window over an already-open one if its flux
>    exceeds the flux that opened the current window by this multiple —
>    substantial enough that a marginal bump can't retrigger, but a real
>    hammer strike clearly can.
>
> Re-verified after the fix: the decaying-note regression check (§ below)
> now holds `unproductiveOnsets === 0` for the full decay tail (verified out
> to 6 s in the lab), and the repeated-note scenario passes reliably across
> repeated runs (4/4 in the re-check). Latency sweep, octave-pair,
> rolled-chord, and noise-floor-flatness cases show no regression. This
> matters beyond the failing test: `unproductiveOnsets` is the signal the
> step-8 escape hatch uses to detect a "struggling" user — false onsets
> during normal decay would have made it cry wolf during perfectly
> successful practice.
>
> **Regression check added:** a single decaying note with no re-strike must
> produce **zero** unproductive onsets over its entire decay. This property
> was silently broken once; verify it explicitly in any future tuning pass.

> **Harness-correctness lesson (caught in a later tuning pass, before trusting
> any further measurement):** the lab's headless sweep script asserted only
> that *some* pitch was detected (`lastHeardMidi !== null`), never that it
> matched the note actually played. A sub-octave miss (C2 played, C1 heard)
> was logged as `detected in ~128ms` and counted as a pass — it read like a
> latency figure, not a failure. This masked a real accuracy problem across
> two full tuning passes. **Fixed the harness first, before touching the
> detector**: every detection assertion now checks `heardMidi === playedMidi`
> and reports a mismatch as `FAIL`, tallied by what was actually heard (e.g.
> `wrong (C1)`). The sweep also runs each note **5–10 times**, not once —
> these failures are intermittent (frame-timing-dependent), so a single run
> characterizes nothing. Report per-note success *rates*, never a single
> sample. General lesson: a test harness that only checks "something
> happened" instead of "the right thing happened" is worse than no harness —
> it actively hides the bug it was built to catch.
>
> **Bottom-two-octave sub-octave bug, found with the corrected harness:**
> baseline (10 runs each via the corrected sweep) — C2 3/5, D2 2/5, E2 1/5
> correct, all wrong runs a clean sub-octave (C1/D1/E1); G2 and C3–C6 already
> 5/5. Root cause, confirmed by instrumenting `pickArgmax`'s candidate scores
> frame-by-frame (temporary `debugLastScores()`, removed after the pass): in
> the first few frames after an onset, the long-window FFT (8192 samples,
> ~171ms) hasn't yet absorbed enough of the real tone for its scores to
> settle — a single early frame can show the octave-below candidate's total
> score *and* odd-harmonic ratio both spuriously high (measured oddRatio
> 0.87–0.97 from pure onset-transient noise, actually *higher* than a genuine
> note's own steady-state ratio of ~0.7–0.8). That single noisy frame was
> enough for `pickArgmax` to hand the octave guard's exclusion to the wrong
> (lower) candidate before the true note's score caught up. This hits the
> bottom two octaves hardest because the octave-below candidate's fundamental
> sits in bins where a few Hz covers a lot of relative frequency, so leakage
> and near-DC transient artifacts are disproportionately visible there. The
> false reading never survived past 1–2 frames (~17–35ms) in every case
> observed — it collapsed as fast as it appeared, which is what made the fix
> tractable: **require the same argmax candidate to win on
> `ARGMAX_CONFIRM_FRAMES` (2) consecutive frames** before acting on it at all,
> and **`ARGMAX_CONFIRM_FRAMES_STRICT` (4) consecutive frames** for
> non-expected (octave-accusing) candidates specifically — extending the
> design's existing eager-to-confirm/conservative-to-accuse asymmetry
> (`SCORE_ON_STRICT_MULTIPLIER`) to the confirmation streak, not just the
> score threshold. (2 frames alone still let the C1 candidate fire a
> short-lived, misleading "wrong octave" false-positive note-on in ~3/8 runs,
> even though the *final* heard pitch came out correct once C2 itself
> confirmed a moment later — 4 frames eliminated it in 10/10 further runs.)
> Approaches considered and set aside: tightening the odd-ratio threshold
> alone doesn't work (genuine signal and onset-transient noise produce
> overlapping ratios, ~0.6–0.97 either way — it's a timing problem, not a
> ratio-calibration problem); narrowing/widening the harmonic search radius
> wasn't tried once the timing root cause was confirmed, since it wouldn't
> address a transient that resolves within 1–2 frames regardless of radius.
> **Result after the fix: 20/20 across two full 10-run sweeps for every note
> C2–C6** (previously as low as 1/5 at E2). Added latency: one extra frame
> (~17–20ms) for expected pitches, up to three extra frames for octave-guard
> accusations — negligible against wait mode's indefinite hold. **C3–C6 showed
> no regression** (still 10/10 across both sweeps, latencies within a few ms
> of baseline).
>
> **Rolled-chord dropped-note bug, investigated with the corrected multi-run
> harness (previously dismissed as "pre-existing harness jitter" without
> multi-run evidence):** the rolled-chord scenario (C4, E4, G4 struck 350ms
> apart) dropped G4 in 3/8 to 8/8 runs depending on exact build — this is a
> **real, mechanistically-explained detector bug**, not test jitter: notes are
> struck 350ms apart, but a strike window stays open `STRIKE_WINDOW_MS` (400)
> ms, so G4's onset frequently arrives *before* E4's window has closed. An
> onset arriving inside an already-open window must clear
> `SUPERSEDE_FLUX_RATIO` (2×) the window-opening flux to reopen — a bar a
> same-loudness third note often doesn't clear once two notes are already
> ringing underneath it (their sustained energy raises the baseline flux is
> measured against). Fix: **a window that has already fired its note-on no
> longer needs its successor to clear the supersede ratio** — `supersedesOpenWindow
> = windowOpen && (this.strikeFired || flux > windowOpeningFlux *
> SUPERSEDE_FLUX_RATIO)`. The supersede ratio's job is to stop a *stale,
> still-deciding* window (opened by a false onset) from swallowing a genuine
> strike behind it — once a window has already done its job, there's no
> "swallowing" left to protect against, and the next real onset should open
> cleanly regardless of its relative flux. Verified this doesn't reopen the
> earlier false-onset-during-decay bug: the decaying-note regression check
> (zero unproductive onsets) still holds 5/5 after this change, since a false
> onset during decay never reaches `strikeFired = true` in the first place —
> the new supersede-bypass only applies to windows that already succeeded.
> **Result: G4 registered 10/10 in two full 10-run passes after the fix**
> (previously 3/8 immediately before it).
>
> **Regression suite re-verified after all three fixes above** (5 runs each
> via the lab's headless driver): zero unproductive onsets across a full
> decay, a repeated note still produces a genuine re-strike (off+on, distinct
> from the initial onset) at the 0.9s re-strike mark, an octave pair (C4+C5
> simultaneous) resolves to C4 every run, a note ringing across a step change
> never satisfies the new step, and the noise floor stays flat (no creep)
> across a ~4.5s sustained note.
>
> **Follow-up pass: the "known pre-existing artifact" above was not benign —
> two real bugs, found by instrumenting the detector directly.** The note
> above dismissed a `NOTE ON → note off → NOTE ON` pair on the same pitch as
> harmless because audio note-ons are silent by design. That reasoning only
> covered sampler double-sounding. It missed two real consequences: **wait
> mode's step stepper advances on fresh note-ons**, so a repeated-note step
> (expected pitch N same as N+1) gets satisfied twice by one physical
> keypress; and **lit keys flash lit → unlit → lit** on every strike, since
> they derive from the pressed set. A corrected unfiltered capture (previous
> sweeps only asserted on `NOTE ON` lines, never `note off` — the same
> harness-correctness lesson as the sub-octave bug two entries up, recurring
> in a new place) showed this on **6/6 runs of a single struck note**, not
> "occasionally" — every strike produced 2-3 complete note-on/note-off
> cycles. **Harness fix first, again:** any script that filters an event log
> to `NOTE ON` only cannot see a paired on/off/on bug — every scratch harness
> in this project now captures the full unfiltered log and asserts
> `onCount === 1 && offCount === 1` for a single strike before checking
> anything else.
>
> Two independent, unrelated defects were producing this, found by
> instrumenting `processFrame` with temporary per-frame debug logging (score,
> level, sounding state, onset/restrike decisions) and removed once each was
> diagnosed and fixed:
>
> 1. **Attack-transient re-triggering (in `detector.ts`).** A single physical
>    strike's attack ramp routinely produces several onset-gate-passing flux
>    upticks a few ms apart (measured onsets 9-25ms apart from one strike, all
>    clearing the onset gate legitimately — a fast amplitude ramp genuinely
>    looks like several flux spikes to a 2048-sample short window). Once the
>    first uptick fires a note-on, `strikeFired` is true, and the existing "an
>    already-fired window can always be superseded" rule (added earlier in
>    this pass for rolled chords) had **no floor on how soon** — so every
>    later uptick from the *same* attack reopened a fresh window, ran its own
>    2-frame confirm sequence, and landed in the re-strike branch, where
>    `postScore >= preScore * RESTRIKE_SCORE_RATIO` (1.5x) passed trivially:
>    the note's own SNR-normalized score was still climbing by 10-1000x
>    through the attack (an artifact of scoring being *noise-relative* — the
>    local-median "noise" around each harmonic bin falls faster than the
>    harmonic peak itself, so score keeps rising well past when the tone has
>    audibly stabilized). **This was not the note-off-hysteresis-during-attack
>    mechanism originally suspected going into this pass** — instrumentation
>    showed the sounding candidate's score climbing monotonically through the
>    whole window, never dipping toward `SCORE_OFF`. An elapsed-time gate on
>    re-strike *acceptance* was tried first and rejected: the climbing score
>    property meant a fixed "haven't settled yet" window just delayed the
>    spurious cycle rather than removing it (observed: with a 200ms settle
>    gate, the duplicate still fired, just later — the ratio jump was still
>    trivially satisfied). The fix that held: **`MIN_SUPERSEDE_GAP_MS` (150)**
>    — an already-fired window can only be superseded by a *later* onset if
>    at least 150ms has passed since it fired, unless the new onset is loud
>    enough to clear the ordinary `SUPERSEDE_FLUX_RATIO` outright. Rolled-chord
>    onsets (350ms apart) clear this gap comfortably; same-attack noise
>    (9-25ms apart) doesn't.
> 2. **Decay-tail digital silence (in `detector.ts` + the lab's synthetic tone
>    generator, `AudioLab.tsx`).** After the fix above, a *second* spurious
>    cycle remained, this one at the very end of the tone's scripted decay,
>    not the attack. Root cause, again via instrumentation: `playPianoTone`'s
>    gain envelope only `exponentialRampToValueAtTime`s toward a small nonzero
>    floor (it can't reach literal 0 — that's a curve, not a line), so cutting
>    the oscillator off there with `osc.stop()` truncated its raw waveform
>    mid-cycle at a non-zero-crossing point: a genuine, audible click. The
>    detector correctly heard this click as a real onset. A first attempt
>    spliced in a final linear ramp to true 0 just before `stopTime` — this
>    *backfired*: switching ramp shapes mid-decay (curve to line) is itself a
>    slope discontinuity and produced its own small transient at the splice
>    point, just moving the false onset a few tens of ms earlier (still 100%
>    reproducible). The fix that held for the tone generator: keep a single
>    continuous exponential ramp for the whole decay, targeting a much lower
>    floor (`peak * 1e-7`, ~140dB below peak) so any residual discontinuity at
>    the eventual hard stop is far below what the onset detector's
>    level-relative gates can register. Separately, `detector.ts` gained a
>    real, general-purpose defense for the underlying class of bug: **a fixed
>    `SILENCE_LEVEL_DB` (-150) gate** — below this level a frame is literal
>    digital silence (the RMS floor is `20*log10(EPSILON)` = -180dB), and onset
>    detection is skipped outright regardless of flux. This is the one
>    absolute (non-level-relative) threshold added in this file, deliberately:
>    the failure mode is specifically that `ABSOLUTE_FLUX_ENERGY_RATIO`'s own
>    protection collapses when the *current frame's* energy is itself at the
>    numeric floor (both sides of the ratio scale to ~0 together, so
>    floating-point noise trivially clears "a fraction of near-zero"). -150dB
>    is far below any plausible real mic signal (a room's own analog noise
>    floor sits well above it), so this only screens out numerically
>    degenerate silence, never real quiet audio.
>
> **Verified after both fixes** (all via the corrected, unfiltered harness):
> single struck note produces exactly one note-on/note-off pair, **12/12**
> runs (previously 2-3 cycles on 6/6). Full regression re-run: single-note
> pitch accuracy C2-C6 **40/40** (5 runs each), rolled chord all-three-register
> **8/8**, octave pair resolves to lower **8/8**, decaying note zero
> unproductive onsets **5/5**, ringing note across a step change never
> satisfies the new step **5/5**, noise floor flat (0.0dB drift) across a
> ~4.5s sustained note. **Genuine re-strikes explicitly re-verified, since
> that's the key tension this fix could have broken**: a real re-strike still
> produces a fresh note-on at both a 0.5s gap and a 1.5s gap, **6/6** each,
> and the built-in 0.9s-gap scenario still produces a genuine off+on **6/6**.
> `MIN_SUPERSEDE_GAP_MS` (150ms) sits comfortably below every gap tested here
> — a human physically re-striking a single key faster than ~150ms would be
> an extremely fast trill, well outside this feature's design target (wait
> mode's indefinite hold), so this is not expected to cost anything in
> practice, but it is the one place a future tuning pass should look first if
> very fast repeated notes ever get reported as swallowed.
>
> **General lesson, worth restating because it bit this project twice now:**
> a test harness that filters an event log to only the event type it expects
> cannot see a bug that produces a *spurious pair* of the type it's filtering
> away. The sub-octave bug earlier in this doc was hidden by checking
> "something was detected" instead of "the right thing was detected"; this
> bug was hidden by checking "a note-on happened" instead of "exactly the
> right note-on/note-off events happened." Every scratch harness for this
> feature now captures unfiltered logs and asserts exact on/off counts before
> anything else.

> **Noise-bed bug-fix pass (post-step-5, triggered by real-room testing):**
> the user tested the lab with a real laptop mic in a real room and it
> hallucinated notes continuously from ambient noise. Observed live: `Level:
> -56.0dB`, `Signal: good`, noise-floor tick pinned at the extreme left of
> the meter, `Unproductive onsets: 134` and climbing, `Heard: D4` — with a
> spectrum showing no tonal peaks whatsoever, just broadband room noise
> (HVAC rumble, strongest at the low end). The user separately measured that
> actually playing a note raises the level ~20dB or more above the idle
> room noise, so the SNR is genuinely workable — this was two bugs, not a
> physics problem.
>
> **Root cause, harness side: the synthetic test source had no noise bed at
> all.** Every threshold in this file (`SCORE_ON`, `ONSET_FLUX_MULTIPLIER`,
> `ABSOLUTE_FLUX_ENERGY_RATIO`, the octave guard's odd-ratio bar, all of
> it) was tuned and re-verified across multiple prior tuning passes against
> a world with a literally flat, near-zero spectrum everywhere a test tone
> wasn't — i.e. a noise floor of ~-180dB, nothing like a real room. That is
> precisely why both bugs below survived several "all tests pass" tuning
> sessions: the harness could not have caught them, by construction. Fixed
> by adding a synthetic noise bed to the lab (`createNoiseBed` in
> `src/dev/AudioLab.tsx`) — a looped white-noise buffer through a `lowshelf`
> filter (+15dB below 300Hz, approximating HVAC rumble) into a gain node
> whose level is expressed as "dB below the tone's peak gain," so the lab's
> noise control means the same thing the user's own measurement did. Every
> regression check in this file was re-run with the noise bed on at ~20dB
> tone-to-noise SNR (the user's measured real-room condition) before
> trusting any of the fixes below.
>
> **Bug 1 (noise floor): a deadlock, not a slow-convergence problem.** See
> the noise-floor section above for the full writeup — the original
> min-tracking-with-capped-rise design's anti-creep guard
> (`!soundingNow && !recentOnset`) never actually held true in a noisy room
> (phantom onsets/notes are continuous), so the floor could never rise off
> its seed. Replaced with a rolling low-percentile tracker, which has no
> equivalent deadlock state.
>
> **Bug 2 (tonality): nothing required the signal to be tonal.** See the
> tonality-gate description above. Added `MIN_HARMONICS_CLEARING` (a
> candidate needs 3+ individually-clearing harmonics, not just a summed
> score) as the primary fix. **Two alternative/additional approaches were
> tried and reverted, not shipped:**
> - **An analogous individual-clearing gate on the octave guard's own
>   odd-harmonic ratio** (`oddSum/total`), to fix a specific case where a
>   rolled chord's already-ringing notes plus low-frequency-tilted noise
>   fooled the guard into picking the wrong octave (a real G4 misheard as
>   G3, because the noise bed's low-frequency boost sits close to G3's
>   fundamental and inflated its apparent odd-harmonic ratio). This *did*
>   fix that specific case, but it flipped the guard's default away from
>   "trust the lower octave" — the deliberate, hard-won default from the
>   bottom-two-octave tuning pass — whenever the individual-harmonic check
>   didn't confirm fast enough. That measurably broke the clean-signal (no
>   noise at all) octave-pair regression (8/8 → 5/8) and the plain
>   single-strike regression (12/12 → 5/12). Reverted. The noisy
>   rolled-chord octave misattribution is accepted as a documented
>   limitation instead of chasing a fix that costs the solid clean-signal
>   baseline.
> - **Ranking the argmax pool by score-rise-since-window-open
>   (`score - preOnsetScore`) instead of raw score**, to fix a *different*
>   noisy rolled-chord failure mode where a note's own still-settling long-
>   window score could out-rank a genuinely new onset for the first
>   confirm frame or two, causing the new note to be dropped or the old one
>   to re-fire. This also worked for the specific noisy-chord case it
>   targeted, but changed which candidate confirms first in the unsettled
>   frames widely enough to reproduce the *same* clean-signal wrong-octave
>   regression as above (rolled chord 8/8 → 0/8, consistently misreading
>   G3 for G4, in silence). Reverted.
>
> Both reverted attempts targeted real, reproducible noisy-chord failure
> modes and are legitimate leads for a future pass — but neither is worth
> the clean-signal regression it caused, and this pass's priority was "do
> not break what already worked" over "make every noisy edge case perfect."
>
> **Bug 3 (process): the harness fantasy hid both bugs above.** Documented
> above in the "harness side" paragraph; the permanent fix is the noise bed
> itself plus two new checks in the acceptance criteria (see below).
>
> **An incidental fourth bug, found only once the noise bed existed to
> reveal it:** the lab's synthetic tone (`playPianoTone` in
> `src/dev/AudioLab.tsx`) decays exponentially from peak to a
> `1e-7 × peak` click-avoidance floor over the *whole* `decaySec` window —
> and because an exponential amplitude ramp is linear in dB, that fixes the
> ramp's dB/sec rate at ~90dB/sec regardless of `decaySec`. Against a
> ~-180dB synthetic floor this was invisible (the tone stayed "audible"
> until essentially `stopTime`), but against a realistic ~20dB-below-peak
> noise floor the tone crossed into "indistinguishable from noise" within a
> few hundred ms no matter how long `decaySec` said the note should ring —
> every decaying/sustained-note scenario released roughly 10x faster than
> intended. Fixed with a two-segment envelope: the audible portion falls
> only to `AUDIBLE_FLOOR_RATIO` (-40dB) over the scripted `decaySec`
> (matching what that parameter is meant to represent), and only the
> remainder — sized via `SILENCE_TAIL_SEC` to keep its own dB/sec rate close
> to the original single-segment design's — continues down to the
> click-avoidance floor. **A first attempt used a short, fixed (~100ms)
> tail for that remainder and reintroduced the exact decay-tail
> digital-silence bug** the original single-ramp design was built to avoid
> (see the re-strike section above): a ~10x-faster crash to silence
> crashes `levelDb` (fast, per-frame RMS) to the numeric floor before the
> long-window candidate score (which still holds ~171ms of pre-silence
> energy) can catch up, producing a spurious extra note-on/note-off cycle
> right at the tone's end — measured 2/6 runs with the short tail, versus
> 0/12 with `SILENCE_TAIL_SEC` sized properly. This is a lab/test-harness
> fix only; `detector.ts` was not touched for this one.
>
> **Measured results, at ~20dB tone-to-noise SNR (5 runs per check unless
> noted), after all fixes above:** single-strike exactly-one-pair 10/10;
> single-note pitch accuracy C2–C6 **40/40** (no degradation from the
> clean-signal baseline); rolled chord all-three-register 8/8; octave pair
> resolves to lower 8/8; decaying note zero *additional* unproductive
> onsets 5/5 (see below on what "additional" means); ringing note does not
> satisfy new step 5/5; genuine re-strike still off+on 6/6; noise floor
> does not creep during a ~4.5s sustained note 5/5; **noise-only, no tone,
> candidate set applied → zero note-ons over 11s** (the screenshot case) —
> confirmed, with the floor converging to the true ambient level within
> ~2s of the noise bed switching on. The clean-signal (no noise at all)
> regression suite was re-run in full after every change and holds at the
> same numbers reported in the sections above (12/12, 40/40, 8/8, 8/8, 5/5,
> 5/5, 6/6) — this pass added no regression to the no-noise case.
>
> **One legitimate, permanent artifact of turning the noise bed on: a
> single unproductive onset at calibration time, not "134 and climbing."**
> Enabling the noise bed is itself a real, audible event (silence to
> ambient noise, near-instantly) — the percentile floor needs a couple of
> seconds of history to catch up, and during that gap the sudden new
> ambient level can clear the onset gate once. This is not a bug: turning on
> a real noise source (an HVAC unit, a fridge compressor) is a genuine
> onset in the physical sense, and it happens exactly once, well before any
> tone is ever played, never repeating and never during a note's own decay.
> The "decaying note zero unproductive onsets" check was corrected to
> measure the *delta* from just-before-play rather than an absolute count,
> for exactly this reason — see the harness-correctness lesson pattern
> earlier in this doc; the same mistake (checking an absolute/coarse
> condition instead of the one that actually matters) would have "hidden"
> this artifact as a false regression instead of naming it.
>
> **Report at a harsher SNR, for honesty about the ceiling:** at 10dB
> tone-to-noise (louder noise, closer to a poorly-calibrated setup than the
> user's measured ~20dB), single-note accuracy across C2–C6 drops sharply —
> most misses are **"not detected"** (1/5 to 4/5 not-detected per note,
> spread across the whole register, not concentrated in the bass) rather
> than wrong-pitch reads. This is the tonality gate failing safe exactly as
> designed: it would rather report nothing than guess wrong. **This is a
> real, expected degradation, not something to chase away by loosening the
> gate** — 10dB SNR is a worse condition than what was designed for and
> documented (§ Known limitations: "Keyboard volume too low relative to the
> room = no detection"). Bass-register reliability at the *design* SNR
> (~20dB) showed no special weakness in this pass (C2–C3 held 5/5 same as
> every other note); the degradation only shows up once SNR is pushed well
> below the documented target.

**Note-off** — a sounding pitch releases after ~8 consecutive frames below
`SCORE_OFF` (≈ 0.4 × `SCORE_ON`, hysteresis) or `level < floor + 6 dB`.

**Struggle signal** — counts *unproductive onsets* (clear onset, no candidate
confirmed within the window). Feeds the escape hatch.

### `src/lib/audioPitch/engine.ts`

Framework-free Web Audio wrapper. Owns a **dedicated plain `AudioContext`** —
deliberately not Tone's, which keeps `audioPitch/` free of Tone, independently
usable in the lab page, and startable on the pill-click gesture without
touching `Tone.start()` gating.

`getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false,
autoGainControl: false, channelCount: 1 } })` — the voice-tuned processing
destroys harmonic content. MediaStreamSource → the two AnalyserNodes →
per-frame pump via `subscribeFrame`.

API: `start(source?: AudioNode)` (the optional injected source is the
lab/testing path — an oscillator instead of the mic), `stop()` (stops tracks,
closes context, returns `forceRelease()` events), `setCandidates()`,
`onEvent` callback, `getMonitor()`.

No mic-device picker in v1 — default device only, but structure the
`getUserMedia` call so adding `deviceId` later is trivial.

### `src/hooks/useAudioInput.ts`

Mirrors [useWebMidiInput.ts](../src/hooks/useWebMidiInput.ts)'s discipline.
One engine instance per mount.

```ts
useAudioInput({ waitHoldActive, candidates }): AudioInputControl
// -> { status, enable, disable, getMonitor }
```

`status` is coarse React state: `'idle' | 'starting' | 'listening' | 'denied'
| 'error' | 'unsupported'`, plus `struggling: boolean` and `error: string |
null`. Per-frame values (level, floor, heard note) are **not** React state —
the popover reads `getMonitor()` on the shared frame loop and writes DOM
directly, same pattern as `TimeReadout`.

Publishing rules (the load-bearing part):

- A note-on publishes to the bus (`source: 'audio'`) only while the gate is
  open: `enabled && waitHoldActive`. Gate closed ⇒ `setCandidates(∅)` — the
  engine keeps running for the monitor but cannot emit note-ons.
- The hook tracks `publishedHeld: Set<number>`; a note-off publishes whenever
  its note-on was, **regardless of gate state**. The gate closing mid-note
  must not strand a hold count — that is exactly the stuck-lit-key class of
  bug `useWebMidiInput` guards against.
- Disable/unmount: `engine.stop()` → force-release → matching note-offs
  published. Teardown never leaves the mic capturing. Fast-Refresh-safe: the
  effect's cleanup fully closes its own engine, and there is no singleton
  shared state to race (unlike WebMidi).

### `src/components/AudioPill.tsx`

Toolbar pill + anchored monitor popover, styled in `Toolbar.css` alongside
`.midi-pill` (MidiPill has no own CSS file — follow that).

> **Deliberate deviation from PLAN.md resolved decision #3.** That decision
> makes the MIDI pill status-only. The audio pill *cannot* be: mic capture
> requires an explicit user gesture (permission prompt, recording indicator)
> and the monitor UI is load-bearing. Record this deviation in PLAN.md.

Pill: dot + text `Mic` with an explicit `beta` tag in the label. Dot states —
dim (off), green (listening, good signal), amber (listening but struggling /
weak), red (error or denied). Click toggles the popover; the popover contains
the enable button, so the mic never starts without an explicit click inside
it.

Popover content — this is the calibration + monitor UI, and it is load-bearing:

1. **Off state** — "Microphone input (experimental) — lets wait mode hear
   your keyboard through the laptop mic. Works best in a quiet room with
   keyboard volume up." + Enable button. Prominent: *"macOS: turn OFF Voice
   Isolation in Control Center's mic mode — it silences piano."*
2. **Calibration** (first few seconds after enable; soft, not a modal wizard)
   — "Stay quiet a moment…" (seeds the floor, ~1.5 s) → "Now play one note" →
   on a confirmed onset + tonal peak, show measured headroom: "Good signal" /
   "Weak — raise keyboard volume or move closer." Guidance only; the rolling
   floor keeps adapting forever, so nothing is stored and it can't go stale.
3. **Live monitor** (always while listening) — horizontal level meter with a
   noise-floor tick, "Heard: C4" (last detected note, mono font via
   `formatNoteName`), signal-quality word, and a hint line ("In Wait mode,
   play chords one note at a time").
4. **Escape hatch** — see below.

### Dev lab (throwaway, dev-only, built before any app wiring)

- `audio-lab.html` — second Vite HTML entry. Works automatically under
  `npm run dev` at `/audio-lab.html`; deliberately **not** added to
  `build.rollupOptions.input`, so it never ships.
- `src/dev/audioLabMain.tsx` + `src/dev/AudioLab.tsx` — standalone React page
  (inline styles are fine, it's a tool): source selector (mic vs. injected
  synthetic source), candidate-set picker, live level/floor meters,
  long-spectrum visualization with candidate-harmonic overlay markers,
  scrolling timestamped event log, and buttons synthesizing piano-like test
  tones (fundamental + 8 harmonics at 1/h amplitude, exponential decay, plain
  oscillators into `engine.start(source)`) covering the hard cases: repeated
  note, octave pair, rolled chord, decaying-note-across-step-change.

The lab is the highest-value part of this milestone — tuning the detector
blind is impossible, and it is also how the DSP gets tested without a keyboard
or a room.

> **Added in the noise-bed bug-fix pass:** a synthetic ambient-noise bed
> (`createNoiseBed` in `src/dev/AudioLab.tsx`) — a looped white-noise buffer
> through a `lowshelf` filter (+15dB below 300Hz, approximating HVAC rumble)
> into a gain node, with an "enable" checkbox and a "level, in dB below tone
> peak" number input in the lab UI. Runs continuously once enabled,
> independent of the test-tone scenario buttons — this is what makes the
> noise-only, no-tone acceptance case (§ below) possible. Added specifically
> because the lab previously had **no noise bed at all**, which is why two
> real detector bugs (noise-floor deadlock, missing tonality gate) survived
> multiple "all tests pass" tuning sessions — see the noise-bed section
> above for the full writeup. Every regression check in this file should be
> re-run with the noise bed on at a realistic SNR (~20dB, the user's
> measured real-room condition) in any future tuning pass, not just with it
> off.

## Escape hatch (first-class, designed)

The detector counts unproductive onsets. Hook-level rule: ≥4 unproductive
onsets while holding a single step, **or** 3 consecutive steps each held
>10 s with onsets heard ⇒ `struggling: true` ⇒ amber pill dot, and the
popover shows a diagnosis block:

1. What we're seeing — "Hearing sound, but can't identify notes" / "Barely
   hearing anything"
2. Ordered fixes — volume up, move closer, quieter room, macOS Voice
   Isolation OFF
3. *"For reliable detection, a cheap USB-MIDI cable is the real fix — this
   app supports MIDI input directly."*

Popover content plus the amber dot only. No toast, no interruption. Auto-
clears after a run of productive detections; the expanded hint renders at most
once per session unless reopened. Worded as physics, not apology.

Thresholds (4 onsets / 3 slow steps / 10 s) are guesses — tunables to settle
in real-room testing, not spec.

## Feedback flash policy

Fire the correct/incorrect flash for audio notes. By construction audio can
only emit note-ons for candidates — never open-spectrum — so room noise cannot
produce an arbitrary red. Correct flashes work exactly as with MIDI.

Incorrect flashes occur only for **octave errors**, which are genuinely useful
("right key, wrong octave") and require the 2× strict threshold.

**Dropped for v1:** ±1/±2-semitone wrong-key candidates. That is where false
reds live, and wrong-key feedback is a nice-to-have on a nice-to-have.
Consequence to document: with mic input most wrong notes produce *no* feedback
at all — the step just doesn't advance, and the monitor's "Heard: —" is the
tell. If octave reds misfire in real-room testing, the fallback is one line
(drop octave candidates from publishing, keep them for the guard).

## Step sequence

Scope agreed with the user: **trim the heavy end-to-end testing.** Keep the
lab page and synthetic-source tuning; drop the headless fake-mic WAV
wait-mode session in favour of a manual pass.

1. **Bus groundwork** — `noteInput.ts` (`'audio'` source, sounding-notes
   snapshot/exports); `App.tsx` `subscribeSounding` swap. Verify: tsc/lint;
   mouse/keyboard still sound the sampler; a console-published
   `source:'audio'` noteon lights the key *silently*.
2. **`audioPitch/detector.ts`** (pure). Verify: tsc/lint + a scratch
   synthetic-spectrum script — tone+onset ⇒ noteon; sustained tone without
   onset ⇒ nothing; decay ⇒ noteoff; octave pair ⇒ guard picks lower;
   re-strike ⇒ off+on; **floor does not creep during a sustained note**.
3. **`audioPitch/engine.ts`**. Verify: tsc/lint (behavioural proof lands in 4).
4. **Audio lab page** (dev-only entry + `src/dev/`). Verify: manual browser
   pass with synthetic sources.
5. **Tuning pass** in the lab against the acceptance criteria below; freeze
   the constants; note the `LONG_FFT_SIZE` 8192-vs-4096 outcome. Include a
   first real-mic spot check.
6. **`useAudioInput.ts`** — gating, `publishedHeld`, force-release,
   Fast-Refresh-safe teardown. Verify: keys light without sampler
   double-sounding; disabling mid-note leaves nothing stuck.
7. **`AudioPill` + popover** — calibration copy (Voice Isolation warning),
   monitor meters on the frame loop, beta label, struggle states. Verify:
   headless screenshots, light and dark.
8. **End-to-end wiring + escape hatch** — Toolbar/App plumbing, struggle
   thresholds. Manual wait-mode session; confirm the correct-flash fires and
   that pause/mode-change closes the gate cleanly.
9. **Docs** — PLAN.md milestone entry (including the decision-#3 deviation,
   rolled chords, feedback policy) and known limitations; memory bank
   (`activeContext`, `progress`, `systemPatterns`, `techContext`).
10. **Real-room manual acceptance** with the actual keyboard: cold-run the
    calibration flow, play a section in wait mode, then deliberately degrade
    (volume down, background noise, Voice Isolation on) and confirm the
    failures are legible and the escape hatch fires.

### Tuning acceptance criteria (step 5)

- Single notes C2–C6 detected within 300 ms at good SNR, **and the detected
  pitch must equal the played pitch** — a sub-octave or other wrong-pitch
  detection is a fail, not a slow success. (Made explicit after a harness bug
  let this slide for two tuning passes; see the harness-correctness lesson
  above.)
- Zero note-ons from speech, claps, or silence at moderate level over a 60 s
  noise sample.
- A repeated note requires a genuine re-strike.
- A note still ringing across a step change never satisfies the new step.
- Octave pairs resolve to the lower pitch.
- The noise floor does not creep upward during sustained notes.
- **A single struck note produces exactly one note-on and exactly one
  note-off — never a spurious extra on/off cycle.** Added after a bug
  (attack-transient re-triggering + a decay-tail digital-silence false onset,
  both in `detector.ts`; see the writeup above) produced 2-3 complete
  note-on/note-off cycles per strike on 6/6 unfiltered runs, previously
  dismissed as a benign, occasional artifact because every sweep script
  filtered its captured log to `NOTE ON` lines only and never looked at
  `note off`. **Any script driving the lab for this feature must capture the
  full, unfiltered event log and assert `onCount === 1 && offCount === 1` for
  a single strike before checking anything else** — filtering away the event
  type a paired-event bug produces in duplicate is exactly what let this hide
  for as long as it did. This is the one check in this list that isn't about
  latency or pitch correctness — it protects wait mode's step advancement
  (a repeated-note step must not be double-satisfied by one keypress) and the
  lit-key display (must not flash lit → unlit → lit on a normal strike).
- **Every check above must be run at least 5 times, not once** — the failure
  modes found here (sub-octave misreads, dropped rolled-chord notes, the
  duplicate on/off cycle) are frame-timing-dependent and intermittent; a
  single run cannot characterize pass/fail. Report a rate (e.g. `8/10`), not
  a single sample.
- **Added in the noise-bed bug-fix pass — every check above must also be run
  with the synthetic noise bed enabled at a realistic SNR (~20dB tone-to-
  noise, the user's measured real-room condition), not only against a
  noise-free synthetic source.** A noise-free harness is exactly what let
  the noise-floor-deadlock and missing-tonality-gate bugs both survive
  multiple prior "all tests pass" tuning sessions — see the noise-bed
  section above.
- **Noise bed only, no tone, candidate set applied → zero note-ons**, held
  for at least 10s. This is the literal screenshot case that started the
  noise-bed bug-fix pass (empty room, `Signal: good`, notes hallucinated
  from broadband noise) and is now a permanent, standing check.
- **Single-note pitch accuracy C2–C6 at ~20dB SNR, multi-run** (5+ runs per
  note), asserting `heardMidi === playedMidi` exactly as the clean-signal
  sweep does — not just "something detected." Report per-note rates, same
  discipline as the clean-signal sweep above.

## Deliberately dropped (pull back if these turn out to matter)

- AudioWorklet + hand-rolled FFT (AnalyserNode instead).
- Semitone-neighbour wrong-key detection (false-red source; octave only).
- Headless fake-mic WAV end-to-end session tests (scope call).
- Mic device picker (default device in v1).
- Persisting the mic-enabled preference — auto-reopening the mic on page load
  without a gesture is hostile. Theme stays the sole persistence exception.
- Programmatic Voice Isolation detection (no API; heuristics are fragile —
  prominent copy instead).
- A speaker-loopback self-test in calibration (tests laptop-speakers→mic, not
  keyboard→mic; actively misleading).
- Velocity estimation, latency compensation, audio input in
  listen/practice/free-play, any polyphonic or ML path.

## Known limitations (document in PLAN.md; surface in popover copy where user-facing)

- **macOS Voice Isolation** (Control Center mic mode) actively suppresses
  non-speech audio and breaks detection outright — must be off.
- OS/hardware mic AGC or "voice enhancement" outside the browser's constraint
  reach can still gate piano.
- Detection latency ~100–300 ms — fine for wait mode's indefinite hold,
  unsuitable for any future rhythm scoring.
- Sustain pedal blurs onsets and prolongs ringing; expect degraded
  repeated-note and rolled-chord detection with heavy pedal.
- Fast repeated notes while ringing need a clearly separated re-strike.
- Low bass (below ~C2): laptop mics roll off the fundamental; harmonics carry
  it, but reliability drops.
- Simultaneous chord strikes register at most one note per strike — roll
  chords instead.
- Background noise, music, TV, or talking raise the floor and suppress
  detection. By design, and legible in the meter.
- Keyboard volume too low relative to the room = no detection; the
  meter/floor display is the diagnostic.
- Sampler sound from concurrent mouse/keyboard input can be picked up by the
  mic. Harmless — it can only ever double-confirm an expected pitch.
- **Added in the noise-bed bug-fix pass:** at SNRs worse than the ~20dB
  design target (measured at 10dB), single-note accuracy degrades sharply
  across the *whole* register, not just the bass — but degrades as
  **"nothing detected,"** not wrong-pitch reads, because the tonality gate
  fails safe. This is the intended shape of degradation for this design
  (legible failure over guessing), but it does mean a too-quiet keyboard or
  too-loud room produces silence rather than a confident wrong answer, and
  the meter/floor display remains the only diagnostic.
- **A specific rolled-chord + low-frequency-noise combination can still
  resolve to the wrong octave.** If a chord contains a note whose lower
  octave partner's fundamental happens to sit in a noise bed's
  boosted-low-frequency region (e.g. G4 struck while G3 sits under HVAC
  rumble), the octave guard can occasionally attribute the energy to the
  wrong (lower) octave. Two targeted fixes for this were tried and reverted
  because they broke the solid clean-signal baseline instead — see the
  noise-bed bug-fix pass writeup above. Accepted as a documented limitation
  rather than risk the regression.

## Open questions (settle empirically, not up front)

1. **Mic lifetime** — keep the stream open whenever the pill is enabled
   (monitor stays live between holds; the browser shows a continuous
   recording indicator) vs. auto-stopping outside wait mode. *Recommended:
   stays open while enabled; the pill is a one-click off switch.*
2. **Octave-error reds** — publish (recommended, strict threshold) vs.
   suppress all non-expected audio note-ons. Final call belongs to real-room
   results.
3. **Amber `--warning` semantic token** — add one token vs. reuse an existing
   colour for the struggling dot. *Recommended: add the token*, decided
   against the M9 palette during step 7.
