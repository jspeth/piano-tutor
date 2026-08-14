interface EmptyStateProps {
  onOpenFile: () => void
}

/**
 * Shown in the roll area before a file is loaded. Per the resolved "empty
 * state" decision, this is just a centered load-file button — the keyboard
 * band underneath stays visible and playable.
 */
export function EmptyState({ onOpenFile }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <button type="button" onClick={onOpenFile}>
        Load MIDI file
      </button>
    </div>
  )
}
