export type Theme = 'dark' | 'light'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** Current color scheme, mirroring the `@media (prefers-color-scheme: light)` override in index.css. */
export function getTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
}

/**
 * Notifies `cb` whenever the OS/browser color scheme changes. Intentionally
 * thin today — just enough for tokens.ts to invalidate its cache — so a
 * future manual light/dark toggle is a one-line change here rather than a
 * refactor of every consumer.
 */
export function subscribeTheme(cb: (theme: Theme) => void): () => void {
  const query = window.matchMedia(LIGHT_QUERY)
  const listener = () => cb(getTheme())
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
