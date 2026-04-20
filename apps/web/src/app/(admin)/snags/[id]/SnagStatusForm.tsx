'use client'

import { useState, useTransition } from 'react'
import { updateSnagStatusAction, signOffSnagAction } from '@/actions/snag.actions'
import { Button } from '@/components/ui/Button'

const STATUSES = [
  { value: 'open',             label: 'Open',           color: 'var(--c-red)',    bg: 'var(--c-red-dim)',    border: '#6b1e1e' },
  { value: 'in_progress',      label: 'In Progress',    color: 'var(--c-amber)',  bg: 'var(--c-amber-dim)',  border: 'var(--c-amber-mid)' },
  { value: 'resolved',         label: 'Resolved',       color: '#60a5fa',         bg: 'rgba(37,99,235,0.15)',border: '#1d4ed8' },
  { value: 'pending_sign_off', label: 'Pending Sign-off',color: '#c084fc',        bg: 'rgba(88,28,135,0.2)', border: '#6b21a8' },
  { value: 'signed_off',       label: 'Signed Off',     color: '#34d399',         bg: 'rgba(5,150,105,0.15)',border: '#065f46' },
  { value: 'closed',           label: 'Closed',         color: 'var(--c-text-dim)',bg: 'var(--c-panel)',    border: 'var(--c-border)' },
]

interface Props { snagId: string; currentStatus: string; projectId: string }

export function SnagStatusForm({ snagId, currentStatus, projectId }: Props) {
  const [selected, setSelected] = useState(currentStatus)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    if (selected === currentStatus) return
    setError(null)
    startTransition(async () => {
      const result = selected === 'signed_off'
        ? await signOffSnagAction(snagId, projectId)
        : await updateSnagStatusAction(snagId, selected, projectId)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {STATUSES.map(({ value, label, color, bg, border }) => {
          const isSelected = selected === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setSelected(value)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                border: `1px solid ${isSelected ? border : 'var(--c-border)'}`,
                background: isSelected ? bg : 'var(--c-panel)',
                color: isSelected ? color : 'var(--c-text-dim)',
                cursor: 'pointer', transition: 'all 0.12s',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      <div>
        <Button size="sm" onClick={save} isLoading={isPending} disabled={selected === currentStatus}>
          Save Status
        </Button>
      </div>
    </div>
  )
}
