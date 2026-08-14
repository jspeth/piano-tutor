import { useEffect, useRef } from 'react'
import { subscribeFrame } from '../lib/frameLoop'

interface TimeReadoutProps {
  getSongTime: () => number
  duration: number
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * No `useState` on purpose (see frameLoop.ts) — this writes straight to the
 * DOM via refs so a ticking clock never triggers an App re-render. Only
 * mutates `textContent` when the formatted string actually changes, so at
 * most one write per second even though the frame loop runs at 60fps.
 */
export function TimeReadout({ getSongTime, duration }: TimeReadoutProps) {
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const totalRef = useRef<HTMLSpanElement>(null)
  const lastElapsed = useRef('')

  useEffect(() => {
    if (totalRef.current) totalRef.current.textContent = formatTime(duration)
  }, [duration])

  useEffect(() => {
    return subscribeFrame(() => {
      const formatted = formatTime(getSongTime())
      if (formatted === lastElapsed.current) return
      lastElapsed.current = formatted
      if (elapsedRef.current) elapsedRef.current.textContent = formatted
    })
  }, [getSongTime])

  return (
    <span className="time-readout">
      <span ref={elapsedRef} className="time-readout-elapsed">
        0:00
      </span>
      <span className="time-readout-total">
        {' / '}
        <span ref={totalRef}>0:00</span>
      </span>
    </span>
  )
}
