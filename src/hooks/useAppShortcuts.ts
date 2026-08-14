import { useEffect } from 'react'
import { isFormTarget } from './useComputerKeyboardInput'

interface UseAppShortcutsArgs {
  isPlaying: boolean
  instrumentLoaded: boolean
  onPlayPause: () => void
  onOpenFile: () => void
}

/**
 * Global app-level shortcuts: `Space` toggles play/pause (moved out of
 * App.tsx unchanged, including the `instrumentLoaded` gate — pausing is
 * always allowed, but starting playback requires the instrument to be
 * loaded), and `Alt/Opt + O` opens the file picker.
 *
 * `Alt+O` is matched on `e.code` rather than `e.key` because macOS
 * Option-O emits `ø` as `e.key` — `e.code === 'KeyO'` is layout-independent.
 * `⌘O`/`Ctrl+O` are deliberately NOT bound here; the browser's native
 * "open file" binding is left alone per the user's explicit veto.
 */
export function useAppShortcuts({ isPlaying, instrumentLoaded, onPlayPause, onOpenFile }: UseAppShortcutsArgs) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isFormTarget(e.target)) return

      if (e.code === 'Space') {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault()
        if (isPlaying || instrumentLoaded) onPlayPause()
        return
      }

      if (e.altKey && e.code === 'KeyO') {
        if (e.repeat || e.ctrlKey || e.metaKey) return
        e.preventDefault()
        onOpenFile()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, instrumentLoaded, onPlayPause, onOpenFile])
}
