/**
 * Toolbar icons, extracted from design/design_handoff_piano_tutor/Piano
 * Tutor.dc.html's inline SVG markup (shapes only — rectangles, triangles,
 * circles). Every hardcoded stroke/fill in the prototype (e.g. `stroke="oklch(0.68
 * 0.02 280)"`) is recolored to `currentColor` here so icons pick up the
 * button's text color in both light and dark mode. `PauseIcon` has no
 * prototype counterpart (the prototype only ever renders the play triangle)
 * and was authored to match the same rectangles-and-triangles visual
 * language as its siblings.
 */

export function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" />
      <path d="M1.5 6.5h13" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16">
      <path d="M4.5 3L13 8l-8.5 5z" fill="currentColor" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16">
      <rect x="3.5" y="4" width="3.2" height="8" rx="1" fill="currentColor" />
      <rect x="9.3" y="4" width="3.2" height="8" rx="1" fill="currentColor" />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor" />
    </svg>
  )
}

export function LoopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="12" height="8" rx="4" />
      <path d="M6 8h4" />
    </svg>
  )
}

export function ListenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16">
      <path d="M3 6h2.6L9.5 3v10L5.6 10H3z" fill="currentColor" />
      <rect x="11.4" y="6" width="1.4" height="4" rx="0.7" fill="currentColor" />
    </svg>
  )
}

export function PracticeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16">
      <rect x="2" y="4" width="12" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="4.6" y="4" width="1.5" height="4.6" fill="currentColor" />
      <rect x="9.4" y="4" width="1.5" height="4.6" fill="currentColor" />
    </svg>
  )
}

export function WaitIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16">
      <rect x="4" y="3.5" width="2.6" height="9" rx="0.8" fill="currentColor" />
      <rect x="9.4" y="3.5" width="2.6" height="9" rx="0.8" fill="currentColor" />
    </svg>
  )
}

export function TempoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 2.5L13 13.5H3z" />
      <path d="M8 11.5l3-5" />
    </svg>
  )
}

export function KeyRangeIcon() {
  return (
    <svg width="16" height="15" viewBox="0 0 18 16">
      <rect x="1" y="4" width="16" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3.6" y="4" width="1.4" height="4.6" fill="currentColor" />
      <rect x="7.2" y="4" width="1.4" height="4.6" fill="currentColor" />
      <rect x="12.4" y="4" width="1.4" height="4.6" fill="currentColor" />
    </svg>
  )
}
