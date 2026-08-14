import type { PlaybackMode, Region } from '../lib/player'
import type { WebMidiStatus } from '../hooks/useWebMidiInput'
import { FileIcon, PlayIcon, PauseIcon, StopIcon, LoopIcon, ListenIcon, PracticeIcon, WaitIcon, KeyRangeIcon } from './icons'
import { Tooltip } from './Tooltip'
import { IconButton } from './IconButton'
import { TimeReadout } from './TimeReadout'
import { TempoControl } from './TempoControl'
import { MidiPill } from './MidiPill'
import './Toolbar.css'

interface ToolbarProps {
  songName: string | null
  partCount: number
  error: string | null
  onOpenFile: () => void

  isPlaying: boolean
  instrumentLoaded: boolean
  instrumentError: boolean
  onPlayPause: () => void
  onStop: () => void

  region: Region | null
  onClearRegion: () => void

  getSongTime: () => number
  duration: number

  mode: PlaybackMode
  onModeChange: (mode: PlaybackMode) => void

  tempo: number
  onTempoChange: (value: number) => void
  bpm?: number

  showFullKeyboard: boolean
  onToggleFullKeyboard: () => void

  midiStatus: WebMidiStatus
}

/**
 * The handoff's single-row toolbar (46px), composed from the presentational
 * pieces above. Purely presentational — every prop is state or a handler
 * App.tsx already owns; no new state lives here.
 */
export function Toolbar({
  songName,
  partCount,
  error,
  onOpenFile,
  isPlaying,
  instrumentLoaded,
  instrumentError,
  onPlayPause,
  onStop,
  region,
  onClearRegion,
  getSongTime,
  duration,
  mode,
  onModeChange,
  tempo,
  onTempoChange,
  bpm,
  showFullKeyboard,
  onToggleFullKeyboard,
  midiStatus,
}: ToolbarProps) {
  // The Play button's tooltip doubles as the surface for "why can't I play
  // yet" — there's no dedicated spot for the instrument load state in the
  // handoff's spec toolbar, so it's folded in here rather than dropped.
  const playLabel = !instrumentLoaded
    ? instrumentError
      ? 'Piano failed to load — try reloading the page'
      : 'Loading piano…'
    : isPlaying
      ? 'Pause'
      : 'Play'

  const loopLabel = region
    ? `Loop ${region.start.toFixed(1)}s – ${region.end.toFixed(1)}s — click to clear`
    : 'Drag on a roll to set a practice loop'

  const keyRangeLabel = showFullKeyboard
    ? 'Full 88 keys — click to fit the selected parts'
    : 'Fitted to the selected parts — click for full 88'

  return (
    <div className="toolbar">
      <Tooltip label="Load MIDI file" shortcut="⌥O" align="left" offset={36}>
        <button type="button" className="song-button" onClick={onOpenFile}>
          <FileIcon />
          <span className="song-button-name">{songName ?? 'Load a MIDI file'}</span>
          {songName && (
            <span className="song-button-count">
              {partCount} {partCount === 1 ? 'part' : 'parts'}
            </span>
          )}
        </button>
      </Tooltip>

      {error && <span className="toolbar-error">{error}</span>}

      <div className="toolbar-divider" />

      <div className="transport-group">
        <IconButton
          icon={isPlaying ? <PauseIcon /> : <PlayIcon />}
          label={playLabel}
          shortcut={instrumentLoaded ? 'Space' : undefined}
          active={isPlaying}
          disabled={!instrumentLoaded}
          onClick={onPlayPause}
        />
        <IconButton icon={<StopIcon />} label="Stop & rewind to start" onClick={onStop} />
        <IconButton
          icon={<LoopIcon />}
          label={loopLabel}
          active={!!region}
          disabled={!region}
          onClick={onClearRegion}
        />
      </div>

      <TimeReadout getSongTime={getSongTime} duration={duration} />

      <div className="toolbar-divider" />

      <div className="mode-group" role="group" aria-label="Playback mode">
        <Tooltip label="Listen — play the part back to me">
          <button
            type="button"
            className={`mode-button${mode === 'listen' ? ' active' : ''}`}
            aria-label="Listen"
            aria-pressed={mode === 'listen'}
            onClick={() => onModeChange('listen')}
          >
            <ListenIcon />
          </button>
        </Tooltip>
        <Tooltip label="Practice — I play, tempo keeps running">
          <button
            type="button"
            className={`mode-button${mode === 'practice' ? ' active' : ''}`}
            aria-label="Practice"
            aria-pressed={mode === 'practice'}
            onClick={() => onModeChange('practice')}
          >
            <PracticeIcon />
          </button>
        </Tooltip>
        <Tooltip label="Wait — hold until I hit the right note">
          <button
            type="button"
            className={`mode-button${mode === 'wait' ? ' active' : ''}`}
            aria-label="Wait"
            aria-pressed={mode === 'wait'}
            onClick={() => onModeChange('wait')}
          >
            <WaitIcon />
          </button>
        </Tooltip>
      </div>

      <div className="toolbar-spacer" />

      <TempoControl value={tempo} onChange={onTempoChange} bpm={bpm} />

      {/* metronome toggle intentionally omitted — no real click sound to drive it, see PLAN.md M9 */}

      <IconButton
        icon={<KeyRangeIcon />}
        label={keyRangeLabel}
        active={showFullKeyboard}
        onClick={onToggleFullKeyboard}
        tooltipAlign="right"
      />

      <div className="toolbar-divider" />

      <MidiPill status={midiStatus} />
    </div>
  )
}
