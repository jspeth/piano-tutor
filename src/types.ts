export interface ParsedNote {
  midi: number
  name: string
  time: number
  duration: number
  velocity: number
}

export interface ParsedTrack {
  index: number
  name: string
  instrument: string
  notes: ParsedNote[]
}
