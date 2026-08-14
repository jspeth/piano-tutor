import type { ParsedNote } from '../types'

const MAX_LANES = 3

export interface LaneSelection {
  /** Track indices, in selection order (oldest first). Length 1-3. */
  lanes: number[]
  /** Must be a member of `lanes`. */
  focus: number
}

export type LaneAction =
  | { type: 'solo'; trackIndex: number }
  | { type: 'toggle'; trackIndex: number }

/**
 * Drives the track chip bar's selection rules: plain click solos a single
 * lane, ⌘/Ctrl/Shift-click layers up to 3 lanes with one always focused.
 */
export function laneSelectionReducer(state: LaneSelection, action: LaneAction): LaneSelection {
  switch (action.type) {
    case 'solo':
      return { lanes: [action.trackIndex], focus: action.trackIndex }
    case 'toggle': {
      const { trackIndex } = action
      const index = state.lanes.indexOf(trackIndex)
      if (index === -1) {
        let lanes = [...state.lanes, trackIndex]
        if (lanes.length > MAX_LANES) lanes = lanes.slice(lanes.length - MAX_LANES)
        return { lanes, focus: trackIndex }
      }
      if (state.lanes.length === 1) {
        // Can't remove the last lane.
        return state
      }
      const lanes = state.lanes.filter((t) => t !== trackIndex)
      const focus = state.focus === trackIndex ? lanes[0] : state.focus
      return { lanes, focus }
    }
    default:
      return state
  }
}

/**
 * Extracted from the previous single-track keyboard-range logic in App.tsx:
 * pads the note extremes by 2 semitones and clamps to the full piano range,
 * falling back to the full range when there are no notes.
 */
export function noteRangeFor(notes: ParsedNote[]): { low: number; high: number } {
  if (notes.length === 0) return { low: 21, high: 108 }
  const midis = notes.map((n) => n.midi)
  return {
    low: Math.max(21, Math.min(...midis) - 2),
    high: Math.min(108, Math.max(...midis) + 2),
  }
}
