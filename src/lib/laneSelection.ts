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

/**
 * The on-screen keyboard's range: the union of the given (already ±2-padded)
 * lane ranges, expanded outward to the nearest C boundary on each side (a C
 * is any midi with `midi % 12 === 0`), with a minimum span of 24 semitones
 * (2 octaves) enforced *after* the C-expansion — re-snapping to C again if
 * expanding for the minimum span pulls an edge off a C boundary — then
 * clamped to the piano's full range [21 (A0), 108 (C8)].
 *
 * Kept separate from `noteRangeFor`: that function's ±2 padding still drives
 * each lane's own piano-roll pitch axis, unchanged by this rule.
 */
export function keyboardRangeFor(ranges: { low: number; high: number }[]): { low: number; high: number } {
  if (ranges.length === 0) return { low: 21, high: 108 }

  let low = Math.min(...ranges.map((r) => r.low))
  let high = Math.max(...ranges.map((r) => r.high))

  low = Math.floor(low / 12) * 12
  high = Math.ceil(high / 12) * 12

  if (high - low < 24) {
    const mid = (low + high) / 2
    low = Math.floor((mid - 12) / 12) * 12
    high = Math.ceil((mid + 12) / 12) * 12
  }

  return {
    low: Math.max(21, low),
    high: Math.min(108, high),
  }
}
