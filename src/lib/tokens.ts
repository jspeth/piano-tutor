import { useSyncExternalStore } from 'react'
import { subscribeTheme } from './theme'

/**
 * Canvas-consumed chrome tokens. CSS stays the source of truth; the canvas
 * reads a cached snapshot instead of calling `getComputedStyle` per frame —
 * that would force a style recalc every frame, exactly the class of bug M8's
 * canvas perf work fixed.
 */
const CANVAS_TOKEN_NAMES = [
  '--surface-roll',
  '--grid-major',
  '--grid-minor',
  '--text-faint',
  '--accent',
  '--accent-wash',
  '--accent-line',
  '--border-subtle',
  '--playhead',
  '--wrong',
  '--correct',
  '--font-mono',
] as const

type CanvasTokenName = (typeof CANVAS_TOKEN_NAMES)[number]

export type CanvasTokens = Record<CanvasTokenName, string>

let cache: CanvasTokens | null = null

function readCanvasTokens(): CanvasTokens {
  const style = getComputedStyle(document.documentElement)
  const tokens = {} as CanvasTokens
  for (const name of CANVAS_TOKEN_NAMES) {
    const value = style.getPropertyValue(name).trim()
    if (!value && import.meta.env.DEV) {
      console.warn(`[tokens] ${name} resolved to an empty value`)
    }
    tokens[name] = value
  }
  return tokens
}

/** Cached snapshot of the canvas-consumed tokens; recomputed on theme change. */
export function getCanvasTokens(): CanvasTokens {
  if (!cache) cache = readCanvasTokens()
  return cache
}

/** Clears the cache and notifies `cb` whenever the color scheme changes. */
export function subscribeCanvasTokens(cb: () => void): () => void {
  return subscribeTheme(() => {
    cache = null
    cb()
  })
}

/** React binding over the module-level cache, for components (not the rAF loop). */
export function useCanvasTokens(): CanvasTokens {
  return useSyncExternalStore(subscribeCanvasTokens, getCanvasTokens, getCanvasTokens)
}
