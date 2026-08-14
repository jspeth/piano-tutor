import type { WebMidiStatus } from '../hooks/useWebMidiInput'
import { Tooltip } from './Tooltip'

interface MidiPillProps {
  status: WebMidiStatus
}

/**
 * Status-only per PLAN.md's resolved decision #3 — no click handler, no
 * "click to change device" tooltip. Terse label always shown; a longer
 * description is available on hover for the edge cases (not supported,
 * connecting, error) via the same Tooltip mechanism as the rest of the
 * toolbar.
 */
export function MidiPill({ status }: MidiPillProps) {
  let connected = false
  let text: string
  let detail: string | undefined

  if (!status.supported) {
    text = 'MIDI unavailable'
    detail = 'MIDI is not supported in this browser'
  } else if (status.enabled && status.inputNames.length > 0) {
    connected = true
    text = status.inputNames.join(', ')
  } else if (status.enabled) {
    text = 'No device'
    detail = 'MIDI enabled, no device connected'
  } else if (status.error) {
    text = 'MIDI error'
    detail = status.error
  } else {
    text = 'Connecting…'
    detail = 'Connecting to MIDI…'
  }

  const pill = (
    <div className="midi-pill">
      <span className={`midi-pill-dot${connected ? ' connected' : ''}`} />
      <span className="midi-pill-text">{text}</span>
    </div>
  )

  if (!detail) return pill

  return (
    <Tooltip label={detail} align="right" offset={36}>
      {pill}
    </Tooltip>
  )
}
