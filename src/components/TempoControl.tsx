import type { ChangeEvent, CSSProperties } from 'react'
import { TempoIcon } from './icons'
import { Tooltip } from './Tooltip'
import './TempoControl.css'

interface TempoControlProps {
  value: number
  onChange: (value: number) => void
  bpm?: number
}

const MIN_PCT = 25
const MAX_PCT = 150

/**
 * `value`/`onChange` stay in the 0.25-1.5 fractional contract that
 * `player.setTempo()` already expects (see App.tsx's `handleTempoChange`) —
 * only the range input's own min/max/step and the displayed percentage are
 * whole-number, converted at the edges.
 */
export function TempoControl({ value, onChange, bpm }: TempoControlProps) {
  const pct = Math.round(value * 100)
  const label = bpm ? `Tempo — ${pct}% of ${Math.round(bpm)} BPM` : `Tempo — ${pct}%`
  const fillPercent = ((pct - MIN_PCT) / (MAX_PCT - MIN_PCT)) * 100

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(Number(e.target.value) / 100)
  }

  return (
    <Tooltip label={label} align="right" offset={36}>
      <div className="tempo-control">
        <TempoIcon />
        <input
          type="range"
          min={MIN_PCT}
          max={MAX_PCT}
          step={5}
          value={pct}
          onChange={handleChange}
          aria-label={label}
          style={{ '--tempo-percent': `${fillPercent}%` } as CSSProperties}
        />
        <span className="tempo-control-value">{pct}%</span>
      </div>
    </Tooltip>
  )
}
