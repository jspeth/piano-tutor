import { Midi } from '@tonejs/midi'
import type { ParsedTrack } from '../types'

export interface ParsedMidi {
  tracks: ParsedTrack[]
  duration: number
}

export async function parseMidiFile(file: File): Promise<ParsedMidi> {
  const arrayBuffer = await file.arrayBuffer()
  const midi = new Midi(arrayBuffer)

  const tracks: ParsedTrack[] = midi.tracks
    .map((track, index) => ({
      index,
      name: track.name || `Track ${index + 1}`,
      instrument: track.instrument?.name ?? 'unknown',
      notes: track.notes.map((n) => ({
        midi: n.midi,
        name: n.name,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      })),
    }))
    .filter((track) => track.notes.length > 0)

  return { tracks, duration: midi.duration }
}
