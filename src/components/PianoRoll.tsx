import { useEffect, useRef, useState } from 'react'
import type { ParsedNote } from '../types'
import type { Region } from '../lib/player'
import './PianoRoll.css'

const PX_PER_SEC = 80
const ROW_HEIGHT = 10
const EDGE_HIT_PX = 6
const MIN_REGION_SEC = 0.1

const BLACK_KEY_SEMITONES = new Set([1, 3, 6, 8, 10])

interface Drag {
  mode: 'new' | 'start' | 'end'
  /** The fixed edge the drag pivots around, in song seconds. */
  anchor: number
  moved: boolean
}

interface PianoRollProps {
  notes: ParsedNote[]
  duration: number
  lowNote: number
  highNote: number
  region: Region | null
  onRegionChange: (region: Region | null, commit?: boolean) => void
  onSeek: (time: number) => void
  getPlayheadTime: () => number
  isPlaying: boolean
}

export function PianoRoll({
  notes,
  duration,
  lowNote,
  highNote,
  region,
  onRegionChange,
  onSeek,
  getPlayheadTime,
  isPlaying,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])

  // The scrollable track (this div's width) represents the whole song, but
  // the <canvas> itself (sticky-positioned inside it) is only ever sized to
  // the visible viewport. Chrome declines to GPU-accelerate very large 2D
  // canvases, which made every draw call slow — even tiny ones — once a
  // multi-minute song pushed the old song-length-sized canvas past whatever
  // that threshold is. Keeping the canvas viewport-sized, and redrawing only
  // the currently-visible slice of the song each frame, keeps per-frame cost
  // bounded by screen size instead of song length.
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
  const height = (highNote - lowNote + 1) * ROW_HEIGHT

  const yForMidi = (midi: number) => (highNote - midi) * ROW_HEIGHT

  const drawRef = useRef(() => {})
  drawRef.current = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const scroller = scrollRef.current
    if (!canvas || !ctx || !scroller) return

    const scrollLeft = scroller.scrollLeft
    const viewEnd = scrollLeft + canvasWidth

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#181820'
    ctx.fillRect(0, 0, canvasWidth, height)

    // darker stripes on black-key rows
    ctx.fillStyle = '#121218'
    for (let m = lowNote; m <= highNote; m++) {
      if (BLACK_KEY_SEMITONES.has(m % 12)) {
        ctx.fillRect(0, yForMidi(m), canvasWidth, ROW_HEIGHT)
      }
    }

    // octave boundaries (below each C)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    for (let m = lowNote; m <= highNote; m++) {
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
    for (const n of notes) {
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

    const playheadSongX = getPlayheadTime() * pxPerSec
    const playheadX = playheadSongX - scrollLeft
    ctx.fillStyle = '#ff5f56'
    ctx.fillRect(playheadX - 1, 0, 2, height)

    // keep the playhead in view while playing, unless the user is dragging
    if (isPlaying && !dragRef.current && width > canvasWidth) {
      const outOfView = playheadX < 0 || playheadX > canvasWidth - 40
      if (outOfView) {
        scroller.scrollLeft = Math.max(0, playheadSongX - canvasWidth * 0.2)
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvasWidth * dpr
    canvas.height = height * dpr
  }, [canvasWidth, height, dpr])

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

  function edgeAtEvent(e: React.PointerEvent<HTMLCanvasElement>): 'start' | 'end' | null {
    if (!region) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const x = e.clientX - rect.left + scrollLeft
    if (Math.abs(x - region.start * pxPerSec) <= EDGE_HIT_PX) return 'start'
    if (Math.abs(x - region.end * pxPerSec) <= EDGE_HIT_PX) return 'end'
    return null
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const edge = edgeAtEvent(e)
    if (edge && region) {
      dragRef.current = {
        mode: edge,
        anchor: edge === 'start' ? region.end : region.start,
        moved: true,
      }
    } else {
      dragRef.current = { mode: 'new', anchor: timeAtEvent(e), moved: false }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) {
      e.currentTarget.style.cursor = edgeAtEvent(e) ? 'ew-resize' : 'crosshair'
      return
    }
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

  return (
    <div className="piano-roll" ref={scrollRef}>
      <div className="piano-roll-track" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          style={{ width: canvasWidth, height }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>
  )
}
