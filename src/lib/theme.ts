import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
export type ThemePreference = 'auto' | Theme

const STORAGE_KEY = 'pianotutor:theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

function systemTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'auto' || stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage disabled/unavailable (private mode) — fall back to auto.
  }
  return 'auto'
}

function resolve(pref: ThemePreference): Theme {
  return pref === 'auto' ? systemTheme() : pref
}

let preference: ThemePreference = readStoredPreference()
const listeners = new Set<(theme: Theme) => void>()

function applyAndNotify() {
  const theme = resolve(preference)
  // The `data-theme` attribute (not the media query alone) is what index.css
  // keys its light-mode token block off of, so an explicit 'light'/'dark'
  // preference can override the OS scheme instead of just mirroring it.
  document.documentElement.dataset.theme = theme
  for (const cb of listeners) cb(theme)
}

/**
 * Applies the stored preference before the first paint and starts listening
 * for OS scheme changes. Call once, as early as possible (before rendering),
 * so there's no flash of the wrong theme.
 */
export function initTheme(): void {
  document.documentElement.dataset.theme = resolve(preference)
  window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
    if (preference === 'auto') applyAndNotify()
  })
}

export function getThemePreference(): ThemePreference {
  return preference
}

export function setThemePreference(pref: ThemePreference): void {
  preference = pref
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Storage disabled/unavailable — the choice just won't persist.
  }
  applyAndNotify()
}

/** Current *resolved* theme (never 'auto'), mirroring the `data-theme` attribute applied to <html>. */
export function getTheme(): Theme {
  return resolve(preference)
}

/** Notifies `cb` whenever the resolved theme changes — either the OS scheme
 * flips while the preference is 'auto', or the user picks an explicit one. */
export function subscribeTheme(cb: (theme: Theme) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React binding over the resolved theme, for components that need to
 * re-render (and recompute theme-dependent colors) when it flips. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme)
}

/** React binding over the raw preference ('auto'/'light'/'dark'), for the
 * toggle itself — it needs to know which of the three is selected, not just
 * the resolved theme. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (onChange) => subscribeTheme(onChange),
    getThemePreference,
    getThemePreference,
  )
}
