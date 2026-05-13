'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteScheduleItemAction,
  updateScheduleStatusAction,
} from '@/actions/schedule.actions'

type Status =
  | 'open'
  | 'partially_ordered'
  | 'fully_ordered'
  | 'fully_delivered'
  | 'cancelled'

const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  partially_ordered: 'Partly ordered',
  fully_ordered: 'Fully ordered',
  fully_delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export function ScheduleRow({
  id,
  currentStatus,
}: {
  id: string
  currentStatus: Status
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onChangeStatus(next: Status) {
    if (next === currentStatus) return
    startTransition(async () => {
      setError(null)
      const res = await updateScheduleStatusAction({ id, status: next })
      if (res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  function onDelete() {
    if (!confirm('Remove this schedule line? Linked procurement items keep their data.')) return
    startTransition(async () => {
      setError(null)
      const res = await deleteScheduleItemAction(id)
      if (res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-label="Row actions"
        style={{
          background: 'none',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          color: 'var(--c-text-mid)',
          padding: '4px 8px',
          fontSize: 13,
          cursor: pending ? 'progress' : 'pointer',
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            minWidth: 180,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            padding: 4,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              padding: '6px 8px',
            }}
          >
            Set status
          </div>
          {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChangeStatus(s)}
              disabled={pending}
              style={{
                background: s === currentStatus ? 'var(--c-base)' : 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                padding: '6px 8px',
                color: 'var(--c-text)',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          <div
            style={{
              height: 1,
              background: 'var(--c-border)',
              margin: '4px 0',
            }}
          />
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            style={{
              background: 'none',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              padding: '6px 8px',
              color: '#dc2626',
              fontSize: 12,
              borderRadius: 4,
            }}
          >
            Delete line
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--c-panel)',
            border: '1px solid #dc2626',
            color: '#dc2626',
            fontSize: 11,
            padding: '4px 8px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
