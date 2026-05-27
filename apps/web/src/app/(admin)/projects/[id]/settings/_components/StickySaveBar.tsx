'use client'

/**
 * Bottom-floating save bar that only renders when isDirty.
 *
 * States: idle (dirty) → submitting → success | error → idle.
 * After success, the bar flashes ✓ Saved for ~1.5s then fades — parent
 * controls re-renders by transitioning isDirty back to false after save
 * completes.
 *
 * Phase-2 sub-pages provide onSave/onDiscard tied to their specific
 * form state; PR-1c ships the component shell.
 */

import { useState, useEffect } from 'react'

export interface StickySaveBarProps {
  isDirty: boolean
  onSave: () => Promise<void>
  onDiscard: () => void
}

type BarState = 'idle' | 'submitting' | 'success' | 'error'

export function StickySaveBar({ isDirty, onSave, onDiscard }: StickySaveBarProps) {
  const [state, setState] = useState<BarState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Hook MUST stay above the early return below — otherwise the bar
  // renders different hook counts on dirty-vs-clean renders and React
  // throws #310 ("Rendered fewer hooks than expected").
  useEffect(() => {
    if (state !== 'success') return
    const t = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(t)
  }, [state])

  if (!isDirty && state !== 'success') return null

  const handleSave = async () => {
    setState('submitting')
    setErrorMsg(null)
    try {
      await onSave()
      setState('success')
    } catch (e) {
      setState('error')
      setErrorMsg(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const bg =
    state === 'success' ? 'var(--c-green)' :
    state === 'error'   ? 'var(--c-red)'   :
                          'var(--c-amber)'

  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        background: 'var(--c-panel)',
        border: `2px solid ${bg}`,
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        padding: '10px 14px',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        minWidth: 'min(360px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 150,
      }}
    >
      <span style={{ color: bg, fontSize: 14, fontWeight: 600 }}>
        {state === 'submitting' ? 'Saving…'
         : state === 'success'  ? '✓ Saved'
         : state === 'error'    ? `⚠ ${errorMsg ?? 'Error'}`
         : '● Unsaved changes'}
      </span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onDiscard}
        disabled={state === 'submitting'}
        style={{ padding: '6px 12px', fontSize: 13 }}
      >
        Discard
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={state === 'submitting'}
        aria-busy={state === 'submitting'}
        style={{
          padding: '6px 14px',
          fontSize: 13,
          background: bg,
          color: 'var(--c-text-on-amber)',
          border: 'none',
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        {state === 'error' ? '⚠ Retry' : 'Save Changes'}
      </button>
    </div>
  )
}
