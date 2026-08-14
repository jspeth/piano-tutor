const callbacks = new Set<() => void>()
let rafId: number | null = null

function tick() {
  for (const cb of callbacks) cb()
  rafId = callbacks.size > 0 ? requestAnimationFrame(tick) : null
}

/**
 * Shared `requestAnimationFrame` loop: one rAF for however many consumers
 * subscribe, started on the first subscriber and cancelled when the last
 * one unsubscribes. `PianoRoll` and `TimeReadout` share this instead of each
 * running a private loop.
 */
export function subscribeFrame(cb: () => void): () => void {
  callbacks.add(cb)
  if (rafId === null) rafId = requestAnimationFrame(tick)
  return () => {
    callbacks.delete(cb)
    if (callbacks.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }
}
