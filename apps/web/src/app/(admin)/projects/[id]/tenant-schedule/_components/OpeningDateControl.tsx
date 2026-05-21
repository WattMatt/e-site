'use client'

/**
 * OpeningDateControl — the project opening-date field in the Tenant Schedule
 * header. Every tenant beneficial-occupation date is counted back from it, so
 * an amber prompt nudges the user to set it when it is missing.
 */

import { useState, useTransition } from 'react'
import { setProjectOpeningDateAction } from '@/actions/tenant-bo.actions'

export function OpeningDateControl({
  projectId,
  openingDate,
}: {
  projectId: string
  openingDate: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState<string | null>(openingDate)

  function save(next: string | null) {
    setError(null)
    const snapshot = value
    setValue(next)
    startTransition(async () => {
      const res = await setProjectOpeningDateAction(projectId, next)
      if ('error' in res) {
        setError(res.error)
        setValue(snapshot)
      }
    })
  }

  const unset = value == null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid',
        borderColor: unset ? 'var(--c-amber)' : 'var(--c-border)',
        background: unset ? 'var(--c-amber-dim)' : 'var(--c-panel)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--c-text-dim)',
          }}
        >
          Project Opening Date
        </span>
        <span style={{ fontSize: 11, color: unset ? 'var(--c-amber)' : 'var(--c-text-dim)' }}>
          {unset
            ? 'Set an opening date to enable beneficial-occupation tracking.'
            : 'Tenant BO dates count back from this date.'}
        </span>
      </div>
      <input
        type="date"
        value={value ?? ''}
        disabled={isPending}
        onChange={(e) => save(e.target.value || null)}
        style={{
          padding: '5px 10px',
          borderRadius: 5,
          border: '1px solid var(--c-border)',
          background: 'var(--c-bg)',
          color: 'var(--c-text)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}
        aria-label="Project opening date"
      />
      {error && <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
