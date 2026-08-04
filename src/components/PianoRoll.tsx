import { useEffect, useRef, useState } from 'react'
import type { ParsedNote } from '../types'
import type { Region } from '../lib/player'
import './PianoRoll.css'

const PX_PER_SEC = 80
const ROW_HEIGHT = 10
const EDGE_HIT_PX = 6
const MIN_REGION_SEC = 0.1
// Stay under the smallest common per-dimension canvas limit (Firefox: 32767
// device px); long songs get a lower px-per-second instead of a blank canvas.
const MAX_BACKING_PX = 32000

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

  const pxPerSec = Math.min(PX_PER_SEC, MAX_BACKING_PX / dpr / Math.max(duration, 1))
  const width = Math.max(1, Math.ceil(duration * pxPerSec))
  const height = (highNote - lowNote + 1) * ROW_HEIGHT

  const yForMidi = (midi: number) => (highNote - midi) * ROW_HEIGHT

  const drawRef = useRef(() => {})
  drawRef.current = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#181820'
    ctx.fillRect(0, 0, width, height)

    // darker stripes on black-key rows
    ctx.fillStyle = '#121218'
    for (let m = lowNote; m <= highNote; m++) {
      if (BLACK_KEY_SEMITONES.has(m % 12)) {
        ctx.fillRect(0, yForMidi(m), width, ROW_HEIGHT)
      }
    }

    // octave boundaries (below each C)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    for (let m = lowNote; m <= highNote; m++) {
      if (m % 12 === 0) ctx.fillRect(0, yForMidi(m) + ROW_HEIGHT - 1, width, 1)
    }

    // one-second gridlines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    for (let s = 1; s < duration; s++) {
      ctx.fillRect(s * pxPerSec, 0, 1, height)
    }

    ctx.fillStyle = '#57a6ff'
    for (const n of notes) {
      const x = n.time * pxPerSec
      const w = Math.max(n.duration * pxPerSec - 1, 2)
      ctx.fillRect(x, yForMidi(n.midi) + 1, w, ROW_HEIGHT - 2)
    }

    if (region) {
      const x0 = region.start * pxPerSec
      const x1 = region.end * pxPerSec
      ctx.fillStyle = 'rgba(255, 184, 79, 0.15)'
      ctx.fillRect(x0, 0, x1 - x0, height)
      ctx.fillStyle = '#ffb84f'
      ctx.fillRect(x0 - 1, 0, 2, height)
      ctx.fillRect(x1 - 1, 0, 2, height)
    }

    const playheadX = getPlayheadTime() * pxPerSec
    ctx.fillStyle = '#ff5f56'
    ctx.fillRect(playheadX - 1, 0, 2, height)

    // keep the playhead in view while playing, unless the user is dragging
    const scroller = scrollRef.current
    if (isPlaying && !dragRef.current && scroller && scroller.clientWidth < width) {
      const outOfView =
        playheadX < scroller.scrollLeft ||
        playheadX > scroller.scrollLeft + scroller.clientWidth - 40
      if (outOfView) {
        scroller.scrollLeft = Math.max(0, playheadX - scroller.clientWidth * 0.2)
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = width * dpr
    canvas.height = height * dpr
  }, [width, height, dpr])

  useEffect(() => {
    let raf = requestAnimationFrame(function loop() {
      drawRef.current()
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  function timeAtEvent(e: React.PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = (e.clientX - rect.left) / pxPerSec
    return Math.min(Math.max(t, 0), duration)
  }

  function edgeAtEvent(e: React.PointerEvent<HTMLCanvasElement>): 'start' | 'end' | null {
    if (!region) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
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
      // plain click clears the region
      onRegionChange(null)
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
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}
