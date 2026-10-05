'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { voidObservationAction } from '@/actions/rate-catalogue.actions'

/**
 * Retract one observation. Observations are never edited: this adds a void
 * row that supersedes it, and the statistics stop counting it. Two steps,
 * never window.confirm (Safari suppresses it).
 */
export function VoidObservationButton({ observationId }: { observationId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ fontSize: 12 }}>Retract…</button>
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 180 }}>
      <input aria-label="Why is this observation wrong?" placeholder="Why is it wrong?" value={note} onChange={e => setNote(e.target.value)}
        style={{ padding: '4px 6px', border: '1px solid var(--c-border)', borderRadius: 4, background: 'var(--c-base)', color: 'inherit' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" disabled={pending || note.trim().length < 3}
          onClick={() => start(async () => {
            const r = await voidObservationAction(observationId, note)
            if (!r.ok) { setError(r.error); return }
            router.refresh()
          })}>{pending ? 'Retracting…' : 'Retract'}</button>
        <button type="button" onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
      </div>
      {error ? <span role="alert" style={{ color: 'var(--c-red, #c0392b)', fontSize: 12 }}>{error}</span> : null}
    </div>
  )
}
