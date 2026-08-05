import type { ParsedNote } from '../types'

export interface Step {
  time: number
  midis: number[]
}

/**
 * Groups notes into onset "steps" for wait-for-key mode. A new step starts
 * when a note's time is more than `epsilon` past the *current step's first
 * note's* time — not the previous note's time — so a chain of onsets each
 * within epsilon of its neighbor doesn't merge into one giant step.
 */
export function groupIntoSteps(notes: ParsedNote[], epsilon = 0.05): Step[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time)
  const steps: Step[] = []
  let current: { time: number; midis: Set<number> } | null = null

  for (const note of sorted) {
    if (!current || note.time - current.time > epsilon) {
      current = { time: note.time, midis: new Set() }
      steps.push({ time: current.time, midis: [] })
    }
    current.midis.add(note.midi)
    steps[steps.length - 1].midis = [...current.midis].sort((a, b) => a - b)
  }

  return steps
}
