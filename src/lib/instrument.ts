import * as Tone from 'tone'

// Minor-third-spaced Salamander Grand Piano sample set (30 files), bundled
// locally under public/samples/salamander/ for offline use. See README.md
// for sample attribution/license.
const NOTE_NAMES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
]

// Tone.Sampler note names use '#' for sharp; sample filenames use 's'
// (Ds1.mp3, not D#1.mp3), so translate the filename form -> the note name
// Tone.Sampler's `urls` keys expect.
function toNoteName(fileName: string): string {
  return fileName.replace('s', '#')
}

const urls: Record<string, string> = {}
for (const fileName of NOTE_NAMES) {
  urls[toNoteName(fileName)] = `${fileName}.mp3`
}

let loaded = false
let loadError: Error | null = null
const listeners = new Set<(loaded: boolean) => void>()
const errorListeners = new Set<(error: Error) => void>()

function setLoaded(value: boolean) {
  if (value === loaded) return
  loaded = value
  for (const listener of listeners) listener(loaded)
}

const sampler = new Tone.Sampler({
  urls,
  baseUrl: `${import.meta.env.BASE_URL}samples/salamander/`,
  release: 1,
  onload: () => setLoaded(true),
  onerror: (error) => {
    loadError = error
    console.error('Failed to load piano samples:', error)
    for (const listener of errorListeners) listener(error)
  },
}).toDestination()

export function getInstrument(): Tone.Sampler {
  return sampler
}

export function isInstrumentLoaded(): boolean {
  return loaded
}

export function getInstrumentLoadError(): Error | null {
  return loadError
}

export function subscribeInstrumentLoaded(listener: (loaded: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function subscribeInstrumentLoadError(listener: (error: Error) => void): () => void {
  errorListeners.add(listener)
  return () => errorListeners.delete(listener)
}

/** Resolves once the sampler has finished loading its samples; never resolves if loading failed. */
export function whenInstrumentLoaded(): Promise<void> {
  if (loaded) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = subscribeInstrumentLoaded((isLoaded) => {
      if (isLoaded) {
        unsubscribe()
        resolve()
      }
    })
  })
}
