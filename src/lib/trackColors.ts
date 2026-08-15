import type { CSSProperties } from 'react'
import { getTheme, type Theme } from './theme'

export interface OklchParts {
  l: number
  c: number
  h: number
}

/** The handoff's 4 base track hues — near L 0.70-0.76, C 0.12-0.15, tuned to
 * sit on the dark roll (L 0.135), so no track dominates. */
const BASE_DARK: OklchParts[] = [
  { l: 0.7, c: 0.15, h: 250 }, // blue
  { l: 0.76, c: 0.14, h: 78 }, // amber
  { l: 0.72, c: 0.12, h: 205 }, // cyan
  { l: 0.68, c: 0.15, h: 348 }, // pink
]

/**
 * Same hues, ~0.2 darker and slightly more chromatic, to sit on the light
 * roll (L 0.965) — L 0.50 keeps a note's contrast against the roll (~5:1)
 * above everything else drawn on it, so notes stay the loudest element.
 * Amber is the exception at L 0.55 (it goes muddy lower) and rotates
 * 78 -> 70, since at this lightness the original hue reads brown against
 * white.
 */
const BASE_LIGHT: OklchParts[] = [
  { l: 0.5, c: 0.19, h: 250 },
  { l: 0.55, c: 0.16, h: 70 },
  { l: 0.5, c: 0.14, h: 205 },
  { l: 0.5, c: 0.2, h: 348 },
]

/** Non-focused-lane ghosting alpha, keyed by theme: 0.55 over the near-black
 * dark roll still holds ~2.9:1, but the same alpha over the 0.965 paper roll
 * collapses to ~2:1, so light mode needs far more alpha to read at all. */
const GHOST_ALPHA = { dark: 0.55, light: 0.85 } as const

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
export function trackColorParts(trackIndex: number, theme: Theme = getTheme()): OklchParts {
  const base = theme === 'light' ? BASE_LIGHT : BASE_DARK
  const index = ((trackIndex % base.length) + base.length) % base.length
  const wraps = Math.floor(trackIndex / base.length)
  const h = avoidForbiddenBands(base[index].h + wraps * 70)
  return { l: base[index].l, c: base[index].c, h }
}

export function trackColor(trackIndex: number, alpha = 1, theme: Theme = getTheme()): string {
  const { l, c, h } = trackColorParts(trackIndex, theme)
  return `oklch(${l} ${c} ${h} / ${alpha})`
}

/** Ghosting alpha for a non-focused lane's notes, themed so it stays legible
 * whichever surface (dark roll vs. paper roll) it's drawn against. */
export function trackGhostAlpha(theme: Theme = getTheme()): number {
  return GHOST_ALPHA[theme]
}

/**
 * Inline custom properties for a track's hue and its alpha variants, ready
 * to spread into a React `style` prop. Chips, lane labels, and `PianoKeyboard`
 * (per lit key) all spread these the same way, so `.key.active { fill:
 * var(--track) }` etc. keep state logic in CSS with one shared vocabulary.
 */
export function trackColorVars(trackIndex: number, theme: Theme = getTheme()): CSSProperties {
  return {
    '--track': trackColor(trackIndex, 1, theme),
    '--track-55': trackColor(trackIndex, GHOST_ALPHA[theme], theme),
    '--track-20': trackColor(trackIndex, theme === 'light' ? 0.16 : 0.2, theme),
    '--track-glow': trackColor(trackIndex, 0.9, theme),
  } as CSSProperties
}
