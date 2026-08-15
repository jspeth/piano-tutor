import { trackColorVars } from '../lib/trackColors'
import type { LaneSelection } from '../lib/laneSelection'
import type { ParsedTrack } from '../types'
import './TrackChips.css'

interface TrackChipsProps {
  tracks: ParsedTrack[]
  selection: LaneSelection | null
  onSelect: (trackIndex: number, focus: boolean) => void
}

/**
 * The track chip bar (36px band). Owns its own `.chip-bar` wrapper, same
 * convention as `Toolbar` owning `.toolbar` — App.tsx just renders
 * `<TrackChips />` in place of the band.
 *
 * Selection logic (toggle vs. focus, max-3-lanes eviction) lives in
 * `laneSelectionReducer` and is untouched here; this component only
 * translates a click's modifier keys into the `focus` boolean and hands
 * off to `onSelect`.
 */
export function TrackChips({ tracks, selection, onSelect }: TrackChipsProps) {
  return (
    <div className="chip-bar" role="group" aria-label="Tracks">
      {tracks.map((track) => {
        const isFocused = selection?.focus === track.index
        const isSelected = selection?.lanes.includes(track.index) ?? false
        const state = isFocused ? 'focused' : isSelected ? 'selected' : 'unselected'
        const showBadge = track.instrument !== 'unknown'
        return (
          <button
            key={track.index}
            className={`chip chip-${state}`}
            style={trackColorVars(track.index)}
            onClick={(e) => onSelect(track.index, e.metaKey || e.ctrlKey)}
          >
            <span className="chip-dot" />
            <span className="chip-name">{track.name}</span>
            <span className="chip-count">{track.notes.length} notes</span>
            {showBadge && <span className="chip-badge">{track.instrument}</span>}
          </button>
        )
      })}
    </div>
  )
}
