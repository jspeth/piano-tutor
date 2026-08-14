import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedNote } from '../types'
import type { Region } from '../lib/player'
import { publish } from '../lib/noteInput'
import { midiToNoteName } from '../lib/noteNames'
import { trackColor, trackColorVars } from '../lib/trackColors'
import { useCanvasTokens, type CanvasTokens } from '../lib/tokens'
import './PianoRoll.css'

const PX_PER_SEC = 80
const LANE_GAP = 6
const EDGE_HIT_PX = 6
const MIN_REGION_SEC = 0.1
const RULER_HEIGHT = 18
// Focused lane gets 1.7x the height weight of the others (handoff's
// `flex: 1.7 1 0` vs `flex: 1 1 0`), computed here in JS rather than read
// back from actual CSS flexbox — one source of truth, no stale-geometry
// frame after a focus change, no per-lane ResizeObservers.
const FOCUSED_WEIGHT = 1.7
const OTHER_WEIGHT = 1
// Below this, a lane's rows become unusably small; fall back to a flat
// per-lane minimum and let the lanes container scroll internally instead
// (the page itself never scrolls).
const MIN_LANE_HEIGHT = 44

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
  rowHeight: number
}

/** What a lane's canvas draw depends on — used for the dirty-redraw check. */
interface LaneDrawState {
  scrollLeft: number
  canvasWidth: number
  layout: LaneLayout
  tokens: CanvasTokens
}

/** What the ruler canvas draw depends on — its own dirty-redraw check. */
interface RulerDrawState {
  scrollLeft: number
  canvasWidth: number
  tokens: CanvasTokens
  region: Region | null
  playheadX: number
}

function formatRulerLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
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
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  const tokens = useCanvasTokens()

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
  // One observer answers both the "how wide is the visible slice" question
  // (above) and the "how tall is the lanes container" question that drives
  // per-lane flex sizing below — no need for a second observer.
  const [viewportWidth, setViewportWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      setViewportWidth(rect ? rect.width : scroller.clientWidth)
      setViewportHeight(rect ? rect.height : scroller.clientHeight)
    })
    ro.observe(scroller)
    setViewportWidth(scroller.clientWidth)
    setViewportHeight(scroller.clientHeight)
    return () => ro.disconnect()
  }, [])

  const pxPerSec = PX_PER_SEC
  const width = Math.max(1, Math.ceil(duration * pxPerSec))
  const canvasWidth = Math.max(1, Math.min(viewportWidth || width, width))

  // Stack lanes top to bottom in the order given. Lane height is derived
  // from the container's available height (weighted 1.7 for the focused
  // lane, 1 for others), not from pitch count * a fixed row height — pitch
  // count only determines each lane's *derived* rowHeight now.
  const laneLayouts: LaneLayout[] = useMemo(() => {
    const n = lanes.length
    if (n === 0) return []

    const avail = Math.max(0, viewportHeight - LANE_GAP * (n - 1))
    const weights = lanes.map((lane) =>
      lane.trackIndex === focusedTrackIndex ? FOCUSED_WEIGHT : OTHER_WEIGHT,
    )
    const sumWeights = weights.reduce((a, w) => a + w, 0)
    let heights = weights.map((w) => Math.floor((avail * w) / sumWeights))

    if (heights.some((h) => h < MIN_LANE_HEIGHT)) {
      // Short viewport: fall back to a flat per-lane minimum. Checked
      // per-lane (after weighting) rather than a flat `avail < n * MIN` —
      // the focused lane's 1.7x weight means the *other* lanes shrink
      // faster than avail/n, so this trips the fallback earlier/more
      // conservatively than a literal aggregate check would. Total content
      // height will then exceed `avail`, which is fine — the lanes
      // container itself scrolls internally rather than crushing rows.
      heights = lanes.map(() => MIN_LANE_HEIGHT)
    } else {
      // Flooring can leave a few px unassigned; give them to the focused
      // lane so heights sum exactly to `avail`.
      const used = heights.reduce((a, h) => a + h, 0)
      const leftover = avail - used
      if (leftover > 0) {
        const focusedIdx = lanes.findIndex((l) => l.trackIndex === focusedTrackIndex)
        heights[focusedIdx >= 0 ? focusedIdx : 0] += leftover
      }
    }

    let top = 0
    const layouts: LaneLayout[] = []
    lanes.forEach((lane, i) => {
      const height = heights[i]
      const rowHeight = height / (lane.highNote - lane.lowNote + 1)
      layouts.push({ lane, top, height, rowHeight })
      top += height + (i < lanes.length - 1 ? LANE_GAP : 0)
    })
    return layouts
  }, [lanes, focusedTrackIndex, viewportHeight])

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

  // Two-tier grid in pixel space (no tempo data, so gridlines are purely
  // seconds-based): major every 1s, minor every 0.25s excluding positions
  // that coincide with a major line.
  function drawGrid(
    ctx: CanvasRenderingContext2D,
    height: number,
    scrollLeft: number,
    viewEnd: number,
  ) {
    const majorStep = pxPerSec
    const minorStep = pxPerSec / 4
    const maxX = width
    const firstMinorIndex = Math.max(0, Math.floor(scrollLeft / minorStep))
    const lastMinorIndex = Math.min(Math.ceil(maxX / minorStep), Math.ceil(viewEnd / minorStep))

    ctx.fillStyle = tokens['--grid-minor']
    for (let i = firstMinorIndex; i < lastMinorIndex; i++) {
      if (i % 4 === 0) continue // coincides with a major line
      const x = i * minorStep - scrollLeft
      ctx.fillRect(x, 0, 1, height)
    }

    ctx.fillStyle = tokens['--grid-major']
    const firstMajorIndex = Math.max(0, Math.floor(scrollLeft / majorStep))
    const lastMajorIndex = Math.min(Math.ceil(maxX / majorStep), Math.ceil(viewEnd / majorStep))
    for (let i = firstMajorIndex; i < lastMajorIndex; i++) {
      const x = i * majorStep - scrollLeft
      ctx.fillRect(x, 0, 1, height)
    }
  }

  const lastLaneDrawRef = useRef(new Map<number, LaneDrawState>())
  const lastRulerDrawRef = useRef<RulerDrawState | null>(null)

  const drawRef = useRef(() => {})
  drawRef.current = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const scrollLeft = scroller.scrollLeft
    const viewEnd = scrollLeft + canvasWidth
    const playheadSongX = getPlayheadTime() * pxPerSec
    const playheadX = playheadSongX - scrollLeft

    // Playhead position updates every frame during playback, imperatively —
    // never via React state (would re-render on every rAF tick, exactly the
    // per-frame cost this codebase avoids elsewhere, e.g. TimeReadout).
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${playheadSongX}px)`
    }

    laneLayouts.forEach((layout) => {
      const { lane, height } = layout
      const canvas = canvasRefs.current.get(lane.trackIndex)
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      const last = lastLaneDrawRef.current.get(lane.trackIndex)
      if (
        last &&
        last.scrollLeft === scrollLeft &&
        last.canvasWidth === canvasWidth &&
        last.layout === layout &&
        last.tokens === tokens
      ) {
        return // nothing relevant changed since the last frame; skip the redraw
      }
      lastLaneDrawRef.current.set(lane.trackIndex, { scrollLeft, canvasWidth, layout, tokens })

      const { rowHeight } = layout
      const yForMidi = (midi: number) => (lane.highNote - midi) * rowHeight
      const focused = lane.trackIndex === focusedTrackIndex

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'

      ctx.fillStyle = tokens['--surface-roll']
      ctx.fillRect(0, 0, canvasWidth, height)

      drawGrid(ctx, height, scrollLeft, viewEnd)

      ctx.fillStyle = focused ? trackColor(lane.trackIndex) : trackColor(lane.trackIndex, 0.5)
      if (focused) {
        ctx.shadowColor = trackColor(lane.trackIndex, 0.35)
        ctx.shadowBlur = 6
      }
      for (const n of lane.notes) {
        const x = n.time * pxPerSec - scrollLeft
        const w = Math.max(n.duration * pxPerSec - 1, 2)
        if (x + w < 0 || x > canvasWidth) continue
        const y = yForMidi(n.midi) + 1
        const h = Math.max(rowHeight - 2, 3)
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, 2)
        ctx.fill()
      }
      if (focused) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    })

    drawRuler(scrollLeft, viewEnd, playheadX)

    // keep the playhead in view while playing, unless the user is dragging
    if (isPlaying && !dragRef.current && width > canvasWidth) {
      const outOfView = playheadX < 0 || playheadX > canvasWidth - 40
      if (outOfView) {
        scroller.scrollLeft = Math.max(0, playheadSongX - canvasWidth * 0.2)
      }
    }
  }

  function drawRuler(scrollLeft: number, viewEnd: number, playheadX: number) {
    const canvas = rulerCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const roundedPlayheadX = Math.round(playheadX)
    const last = lastRulerDrawRef.current
    if (
      last &&
      last.scrollLeft === scrollLeft &&
      last.canvasWidth === canvasWidth &&
      last.tokens === tokens &&
      last.region === region &&
      last.playheadX === roundedPlayheadX
    ) {
      return
    }
    lastRulerDrawRef.current = {
      scrollLeft,
      canvasWidth,
      tokens,
      region,
      playheadX: roundedPlayheadX,
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvasWidth, RULER_HEIGHT)

    const majorStep = pxPerSec
    const minorStep = pxPerSec / 4
    const maxX = width
    const firstMinorIndex = Math.max(0, Math.floor(scrollLeft / minorStep))
    const lastMinorIndex = Math.min(Math.ceil(maxX / minorStep), Math.ceil(viewEnd / minorStep))

    ctx.fillStyle = tokens['--grid-minor']
    for (let i = firstMinorIndex; i < lastMinorIndex; i++) {
      if (i % 4 === 0) continue
      const x = i * minorStep - scrollLeft
      ctx.fillRect(x, RULER_HEIGHT - 6, 1, 6)
    }

    ctx.fillStyle = tokens['--grid-major']
    ctx.font = `9.5px ${tokens['--font-mono']}`
    ctx.textBaseline = 'top'
    const firstMajorIndex = Math.max(0, Math.floor(scrollLeft / majorStep))
    const lastMajorIndex = Math.min(Math.ceil(maxX / majorStep), Math.ceil(viewEnd / majorStep))
    for (let i = firstMajorIndex; i < lastMajorIndex; i++) {
      const x = i * majorStep - scrollLeft
      ctx.fillRect(x, 0, 1, RULER_HEIGHT)
      ctx.fillStyle = tokens['--text-faint']
      ctx.fillText(formatRulerLabel(i), x + 3, 2)
      ctx.fillStyle = tokens['--grid-major']
    }

    // Loop region + playhead ticks — the ruler lives outside the
    // horizontally-scrolling `.piano-roll` container (so it never itself
    // needs to scroll), so it reads the same scrollLeft the lanes do and
    // draws its own thin markers rather than trying to visually span one
    // DOM element across both scroll contexts.
    if (region) {
      const x0 = region.start * pxPerSec - scrollLeft
      const x1 = region.end * pxPerSec - scrollLeft
      ctx.fillStyle = tokens['--accent']
      if (x0 >= -2 && x0 <= canvasWidth + 2) ctx.fillRect(x0 - 1, 0, 2, RULER_HEIGHT)
      if (x1 >= -2 && x1 <= canvasWidth + 2) ctx.fillRect(x1 - 1, 0, 2, RULER_HEIGHT)
    }
    if (playheadX >= -2 && playheadX <= canvasWidth + 2) {
      ctx.fillStyle = tokens['--playhead']
      ctx.fillRect(playheadX - 1, 0, 2, RULER_HEIGHT)
    }
  }

  useEffect(() => {
    for (const { lane, height } of laneLayouts) {
      const canvas = canvasRefs.current.get(lane.trackIndex)
      if (!canvas) continue
      // Round rather than truncate: heights/canvasWidth can be fractional
      // (leftover-px distribution, fractional ResizeObserver rects), and
      // the canvas.width/height setters otherwise truncate, leaving the
      // backing store a device pixel short of the CSS box.
      canvas.width = Math.round(canvasWidth * dpr)
      canvas.height = Math.round(height * dpr)
    }
    // Assigning canvas.width/height clears the backing store even when the
    // new value equals the old one. The dirty-redraw check below can't see
    // that from JS-side state alone (scrollLeft/canvasWidth/layout/tokens
    // may all still read as "unchanged"), so without this the rAF loop could
    // skip every subsequent frame and leave the canvas blank after a resize
    // that races the next dirty-check comparison. Clearing the tracked state
    // forces a real redraw on the very next frame regardless of that race.
    lastLaneDrawRef.current.clear()
  }, [laneLayouts, canvasWidth, dpr])

  useEffect(() => {
    const canvas = rulerCanvasRef.current
    if (!canvas) return
    canvas.width = Math.round(canvasWidth * dpr)
    canvas.height = Math.round(RULER_HEIGHT * dpr)
    lastRulerDrawRef.current = null
  }, [canvasWidth, dpr])

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
    const layout = laneLayouts[laneIndex]
    if (!layout) return null
    const { lane, rowHeight } = layout
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const x = e.clientX - rect.left + scrollLeft
    const y = e.clientY - rect.top
    const midi = lane.highNote - Math.floor(y / rowHeight)
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
    <div className="piano-roll-container">
      <canvas
        ref={rulerCanvasRef}
        className="piano-roll-ruler"
        style={{ width: canvasWidth, height: RULER_HEIGHT }}
      />
      <div className="piano-roll" ref={scrollRef}>
        <div className="piano-roll-track" style={{ width, height: totalHeight }}>
          {laneLayouts.map(({ lane, top, height }, laneIndex) => {
            const focused = lane.trackIndex === focusedTrackIndex
            return (
              <div
                key={lane.trackIndex}
                className={'piano-roll-lane' + (focused ? ' focused' : '')}
                style={{ position: 'absolute', top, left: 0, width, height }}
              >
                <div className="piano-roll-lane-label">
                  <span
                    className="piano-roll-lane-swatch"
                    style={trackColorVars(lane.trackIndex)}
                  />
                  <span className="piano-roll-lane-name">{lane.name}</span>
                  <span className="piano-roll-lane-range">
                    {midiToNoteName(lane.lowNote)}–{midiToNoteName(lane.highNote)}
                  </span>
                </div>
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(lane.trackIndex, el)
                    else canvasRefs.current.delete(lane.trackIndex)
                  }}
                  style={{ width: canvasWidth, height, ...trackColorVars(lane.trackIndex) }}
                  className={focused ? 'focused' : undefined}
                  onPointerDown={(e) => handlePointerDown(e, laneIndex)}
                  onPointerMove={(e) => handlePointerMove(e, laneIndex)}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onPointerLeave={handlePointerLeave}
                />
              </div>
            )
          })}
          <div className="piano-roll-overlay">
            {region && (
              <div
                className="piano-roll-region"
                style={{
                  left: region.start * pxPerSec,
                  width: (region.end - region.start) * pxPerSec,
                }}
              >
                <span className="piano-roll-region-handle start" />
                <span className="piano-roll-region-handle end" />
              </div>
            )}
            <div className="piano-roll-playhead" ref={playheadRef} />
          </div>
        </div>
      </div>
      {hover && (
        <div className="piano-roll-tooltip" style={{ left: hover.x, top: hover.y }}>
          {midiToNoteName(hover.midi)}
        </div>
      )}
    </div>
  )
}
