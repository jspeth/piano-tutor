import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import './IconButton.css'

interface IconButtonProps {
  icon: ReactNode
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  tooltipAlign?: 'center' | 'left' | 'right'
}

/**
 * 32x30 icon button used throughout the toolbar. `disabled` dims the button
 * and blocks the click, but deliberately does NOT use the native `disabled`
 * attribute — the loop button's disabled tooltip ("Drag on a roll to set a
 * practice loop") is meaningful and must still show on hover.
 */
export function IconButton({
  icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  tooltipAlign = 'center',
}: IconButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} align={tooltipAlign}>
      <button
        type="button"
        className={`icon-button${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onClick}
      >
        {icon}
      </button>
    </Tooltip>
  )
}
