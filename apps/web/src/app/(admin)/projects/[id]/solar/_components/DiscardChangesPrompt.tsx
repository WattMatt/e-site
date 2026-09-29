'use client'
/**
 * The inline "Discard unsaved changes?" the tab bar asks (never window.confirm), for in-page
 * navigation guarded by useSolarDiscardGuard (YF-08).
 */
export function DiscardChangesPrompt({ onDiscard, onStay }: { onDiscard: () => void; onStay: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label="Discard unsaved changes?"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--c-amber-mid)', background: 'var(--c-amber-dim)', borderRadius: 6, fontSize: 13 }}
    >
      <span>Discard unsaved changes?</span>
      <button type="button" onClick={onDiscard}>Discard</button>
      <button type="button" onClick={onStay}>Stay</button>
    </div>
  )
}
