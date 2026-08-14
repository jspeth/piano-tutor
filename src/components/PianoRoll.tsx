import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedNote } from '../types'
import type { Region } from '../lib/player'
import { publish } from '../lib/noteInput'
import { midiToNoteName } from '../lib/noteNames'
import './PianoRoll.css'

const PX_PER_SEC = 80
const ROW_HEIGHT = 10
const LANE_GAP = 8
const EDGE_HIT_PX = 6
const MIN_REGION_SEC = 0.1

const BLACK_KEY_SEMITONES = new Set([1, 3, 6, 8, 10])

type Drag =
  | {
      mode: 'new' | 'start' | 'end'
      /** The fixed edge the drag pivots around, in song seconds. */
      anchor: number
      moved: boolean
    }
  | { mode: 'note'; midi: number }

interface Hover {
  midi: number
  x: number
  y: number
}

export interface RollLane {
  trackIndex: number
  name: string
  notes: ParsedNote[]
  lowNote: number
  highNote: number
}

interface PianoRollProps {
  lanes: RollLane[]
  focusedTrackIndex: number
  duration: number
  region: Region | null
  onRegionChange: (region: Region | null, commit?: boolean) => void
  onSeek: (time: number) => void
  getPlayheadTime: () => number
  isPlaying: boolean
}

interface LaneLayout {
  lane: RollLane
  top: number
  height: number
}

export function PianoRoll({
  lanes,
  focusedTrackIndex,
  duration,
  region,
  onRegionChange,
  onSeek,
  getPlayheadTime,
  isPlaying,
}: PianoRollProps) {
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])

  // The scrollable track (this div's width) represents the whole song, but
  // each <canvas> itself is only ever sized to the visible viewport. Chrome
  // declines to GPU-accelerate very large 2D canvases, which made every draw
  // call slow — even tiny ones — once a multi-minute song pushed the old
  // song-length-sized canvas past whatever that threshold is. Keeping each
  // canvas viewport-sized, and redrawing only the currently-visible slice of
  // the song each frame, keeps per-frame cost bounded by screen size instead
  // of song length.
  const [viewportWidth, setViewportWidth] = useState(0)
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const ro = new ResizeObserver(() => setViewportWidth(scroller.clientWidth))
    ro.observe(scroller)
    setViewportWidth(scroller.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pxPerSec = PX_PER_SEC
  const width = Math.max(1, Math.ceil(duration * pxPerSec))
  const canvasWidth = Math.max(1, Math.min(viewportWidth || width, width))

  // Stack lanes top to bottom in the order given, each sized to its own
  // pitch range, with a small gap between them.
  const laneLayouts: LaneLayout[] = useMemo(() => {
    let top = 0
    const layouts: LaneLayout[] = []
    lanes.forEach((lane, i) => {
      const height = (lane.highNote - lane.lowNote + 1) * ROW_HEIGHT
      layouts.push({ lane, top, height })
      top += height + (i < lanes.length - 1 ? LANE_GAP : 0)
    })
    return layouts
  }, [lanes])

  const totalHeight = laneLayouts.reduce(
    (max, l) => Math.max(max, l.top + l.height),
    0,
  )

  // Grouped by row so hit-testing a hover/click only scans the notes on that
  // one pitch instead of the whole lane.
  const notesByMidiPerLane = useMemo(() => {
    return lanes.map((lane) => {
      const map = new Map<number, ParsedNote[]>()
      for (const n of lane.notes) {
        let row = map.get(n.midi)
        if (!row) {
          row = []
          map.set(n.midi, row)
        }
        row.push(n)
      }
      return map
    })
  }, [lanes])

  const drawRef = useRef(() => {})
  drawRef.current = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const scrollLeft = scroller.scrollLeft
    const viewEnd = scrollLeft + canvasWidth
    const playheadSongX = getPlayheadTime() * pxPerSec
    const playheadX = playheadSongX - scrollLeft

    laneLayouts.forEach(({ lane, height }) => {
      const canvas = canvasRefs.current.get(lane.trackIndex)
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      const yForMidi = (midi: number) => (lane.highNote - midi) * ROW_HEIGHT

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.fillStyle = '#181820'
      ctx.fillRect(0, 0, canvasWidth, height)

      // darker stripes on black-key rows
      ctx.fillStyle = '#121218'
      for (let m = lane.lowNote; m <= lane.highNote; m++) {
        if (BLACK_KEY_SEMITONES.has(m % 12)) {
          ctx.fillRect(0, yForMidi(m), canvasWidth, ROW_HEIGHT)
        }
      }

      // octave boundaries (below each C)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
      for (let m = lane.lowNote; m <= lane.highNote; m++) {
        if (m % 12 === 0) ctx.fillRect(0, yForMidi(m) + ROW_HEIGHT - 1, canvasWidth, 1)
      }

      // one-second gridlines, only the ones actually in view
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
      const firstGridline = Math.max(1, Math.floor(scrollLeft / pxPerSec))
      const lastGridline = Math.min(Math.ceil(duration), Math.ceil(viewEnd / pxPerSec))
      for (let s = firstGridline; s < lastGridline; s++) {
        ctx.fillRect(s * pxPerSec - scrollLeft, 0, 1, height)
      }

      ctx.fillStyle = '#57a6ff'
      for (const n of lane.notes) {
        const x = n.time * pxPerSec - scrollLeft
        const w = Math.max(n.duration * pxPerSec - 1, 2)
        if (x + w < 0 || x > canvasWidth) continue
        ctx.fillRect(x, yForMidi(n.midi) + 1, w, ROW_HEIGHT - 2)
      }

      if (region) {
        const x0 = region.start * pxPerSec - scrollLeft
        const x1 = region.end * pxPerSec - scrollLeft
        if (x1 >= 0 && x0 <= canvasWidth) {
          ctx.fillStyle = 'rgba(255, 184, 79, 0.15)'
          ctx.fillRect(x0, 0, x1 - x0, height)
          ctx.fillStyle = '#ffb84f'
          ctx.fillRect(x0 - 1, 0, 2, height)
          ctx.fillRect(x1 - 1, 0, 2, height)
        }
      }

      ctx.fillStyle = '#ff5f56'
      ctx.fillRect(playheadX - 1, 0, 2, height)
    })

    // keep the playhead in view while playing, unless the user is dragging
    if (isPlaying && !dragRef.current && width > canvasWidth) {
      const outOfView = playheadX < 0 || playheadX > canvasWidth - 40
      if (outOfView) {
        scroller.scrollLeft = Math.max(0, playheadSongX - canvasWidth * 0.2)
      }
    }
  }

  useEffect(() => {
    for (const { lane, height } of laneLayouts) {
      const canvas = canvasRefs.current.get(lane.trackIndex)
      if (!canvas) continue
      canvas.width = canvasWidth * dpr
      canvas.height = height * dpr
    }
  }, [laneLayouts, canvasWidth, dpr])

  useEffect(() => {
    let raf = requestAnimationFrame(function loop() {
      drawRef.current()
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  function timeAtEvent(e: React.PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const t = (e.clientX - rect.left + scrollLeft) / pxPerSec
    return Math.min(Math.max(t, 0), duration)
  }

  function noteAtEvent(e: React.PointerEvent<HTMLCanvasElement>, laneIndex: number): ParsedNote | null {
    const lane = lanes[laneIndex]
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const x = e.clientX - rect.left + scrollLeft
    const y = e.clientY - rect.top
    const midi = lane.highNote - Math.floor(y / ROW_HEIGHT)
    const row = notesByMidiPerLane[laneIndex]?.get(midi)
    if (!row) return null
    for (const n of row) {
      const x0 = n.time * pxPerSec
      const w = Math.max(n.duration * pxPerSec - 1, 2)
      if (x >= x0 && x <= x0 + w) return n
    }
    return null
  }

  function edgeAtEvent(e: React.PointerEvent<HTMLCanvasElement>): 'start' | 'end' | null {
    if (!region) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const x = e.clientX - rect.left + scrollLeft
    if (Math.abs(x - region.start * pxPerSec) <= EDGE_HIT_PX) return 'start'
    if (Math.abs(x - region.end * pxPerSec) <= EDGE_HIT_PX) return 'end'
    return null
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>, laneIndex: number) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const edge = edgeAtEvent(e)
    if (edge && region) {
      dragRef.current = {
        mode: edge,
        anchor: edge === 'start' ? region.end : region.start,
        moved: true,
      }
      return
    }
    const note = noteAtEvent(e, laneIndex)
    if (note) {
      dragRef.current = { mode: 'note', midi: note.midi }
      setHover({ midi: note.midi, x: e.clientX, y: e.clientY })
      publish({ type: 'noteon', midi: note.midi, source: 'mouse' })
      return
    }
    dragRef.current = { mode: 'new', anchor: timeAtEvent(e), moved: false }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>, laneIndex: number) {
    const drag = dragRef.current
    if (!drag) {
      if (edgeAtEvent(e)) {
        e.currentTarget.style.cursor = 'ew-resize'
        setHover(null)
        return
      }
      const note = noteAtEvent(e, laneIndex)
      if (note) {
        e.currentTarget.style.cursor = 'pointer'
        setHover({ midi: note.midi, x: e.clientX, y: e.clientY })
      } else {
        e.currentTarget.style.cursor = 'crosshair'
        setHover(null)
      }
      return
    }
    if (drag.mode === 'note') return
    const t = timeAtEvent(e)
    if (!drag.moved && Math.abs(t - drag.anchor) * pxPerSec < 3) return
    drag.moved = true
    onRegionChange(
      { start: Math.min(drag.anchor, t), end: Math.max(drag.anchor, t) },
      false,
    )
  }

  function handlePointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.mode === 'note') {
      publish({ type: 'noteoff', midi: drag.midi, source: 'mouse' })
      return
    }
    if (drag.mode === 'new' && !drag.moved) {
      if (region) {
        // plain click clears the region
        onRegionChange(null)
      } else {
        // no selection to clear: move the playhead to the tapped spot
        onSeek(drag.anchor)
      }
      return
    }
    if (region && region.end - region.start >= MIN_REGION_SEC) {
      onRegionChange(region, true)
    } else {
      onRegionChange(null)
    }
  }

  function handlePointerLeave() {
    if (!dragRef.current) setHover(null)
  }

  return (
    <div className="piano-roll" ref={scrollRef} style={{ minHeight: totalHeight }}>
      <div className="piano-roll-track" style={{ width, height: totalHeight }}>
        {laneLayouts.map(({ lane, top, height }, laneIndex) => (
          <div
            key={lane.trackIndex}
            className={
              'piano-roll-lane' + (lane.trackIndex === focusedTrackIndex ? ' focused' : '')
            }
            style={{ position: 'absolute', top, left: 0, width, height }}
          >
            <span className="piano-roll-lane-label">{lane.name}</span>
            <canvas
              ref={(el) => {
                if (el) canvasRefs.current.set(lane.trackIndex, el)
                else canvasRefs.current.delete(lane.trackIndex)
              }}
              style={{ width: canvasWidth, height }}
              onPointerDown={(e) => handlePointerDown(e, laneIndex)}
              onPointerMove={(e) => handlePointerMove(e, laneIndex)}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
            />
          </div>
        ))}
      </div>
      {hover && (
        <div className="piano-roll-tooltip" style={{ left: hover.x, top: hover.y }}>
          {midiToNoteName(hover.midi)}
        </div>
      )}
    </div>
  )
}
