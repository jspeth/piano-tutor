import type { CSSProperties } from 'react'

export interface OklchParts {
  l: number
  c: number
  h: number
}

/** The handoff's 4 base track hues — near L 0.70-0.76, C 0.12-0.15, so no track dominates. */
const BASE: OklchParts[] = [
  { l: 0.7, c: 0.15, h: 250 }, // blue
  { l: 0.76, c: 0.14, h: 78 }, // amber
  { l: 0.72, c: 0.12, h: 205 }, // cyan
  { l: 0.68, c: 0.15, h: 348 }, // pink
]

/** Reserved for green (correct/expected) and red (wrong) semantics — never a track hue. */
const FORBIDDEN_BANDS: Array<[number, number]> = [
  [130, 170],
  [10, 40],
]

function avoidForbiddenBands(hue: number): number {
  let h = ((hue % 360) + 360) % 360
  for (const [start, end] of FORBIDDEN_BANDS) {
    if (h >= start && h <= end) h = end + 1
  }
  return h
}

/**
 * Hue for a given track index, rotating +70deg per wrap past the 4 base
 * hues and steering clear of the reserved green/red bands. Keyed on
 * `track.index` (stable per session), never lane position.
 */
export function trackColorParts(trackIndex: number): OklchParts {
  const index = ((trackIndex % BASE.length) + BASE.length) % BASE.length
  const base = BASE[index]
  const wraps = Math.floor(trackIndex / BASE.length)
  const h = avoidForbiddenBands(base.h + wraps * 70)
  return { l: base.l, c: base.c, h }
}

export function trackColor(trackIndex: number, alpha = 1): string {
  const { l, c, h } = trackColorParts(trackIndex)
  return `oklch(${l} ${c} ${h} / ${alpha})`
}

/**
 * Inline custom properties for a track's hue and its alpha variants, ready
 * to spread into a React `style` prop. Chips, lane labels, and `PianoKeyboard`
 * (per lit key) all spread these the same way, so `.key.active { fill:
 * var(--track) }` etc. keep state logic in CSS with one shared vocabulary.
 */
export function trackColorVars(trackIndex: number): CSSProperties {
  return {
    '--track': trackColor(trackIndex),
    '--track-55': trackColor(trackIndex, 0.55),
    '--track-20': trackColor(trackIndex, 0.2),
    '--track-glow': trackColor(trackIndex, 0.9),
  } as CSSProperties
}
