import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import './Tooltip.css'

interface TooltipProps {
  label: ReactNode
  shortcut?: string
  align?: 'center' | 'left' | 'right'
  offset?: number
  children: ReactNode
}

const HOVER_DELAY_MS = 400

/**
 * Custom hover tooltip (not native `title=`, which would double up with
 * `aria-label` on the wrapped control). Shows after a 400ms hover delay;
 * `focus-visible` (keyboard navigation) shows immediately since a keyboard
 * user can't "hover" first. Consumers should put `aria-label` on the
 * interactive child rather than `title`.
 */
export function Tooltip({ label, shortcut, align = 'center', offset = 34, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  function handlePointerEnter() {
    clearTimer()
    timerRef.current = setTimeout(() => setVisible(true), HOVER_DELAY_MS)
  }

  function handlePointerLeave() {
    clearTimer()
    setVisible(false)
  }

  function handlePointerDown() {
    clearTimer()
    setVisible(false)
  }

  function handleFocus(e: FocusEvent<HTMLDivElement>) {
    if (e.target.matches(':focus-visible')) {
      clearTimer()
      setVisible(true)
    }
  }

  function handleBlur() {
    clearTimer()
    setVisible(false)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      clearTimer()
      setVisible(false)
    }
  }

  return (
    <div
      className="tooltip-wrapper"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {children}
      {visible && (
        <span className={`tooltip tooltip-${align}`} style={{ top: offset }} role="tooltip">
          {label}
          {shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
        </span>
      )}
    </div>
  )
}
