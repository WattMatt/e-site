'use client'

import { useState, useTransition } from 'react'
import { optBackInMarketingEmailsAction } from '@/actions/unsubscribe.actions'

export function OptBackInButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) {
    return (
      <div
        role="status"
        style={{
          background: 'var(--c-green-dim)',
          color: 'var(--c-green)',
          border: '1px solid rgba(61,184,130,0.3)',
          borderRadius: 6,
          padding: '12px 14px',
          fontSize: 13,
          marginTop: 12,
        }}
      >
        Welcome back — you&apos;re opted in again.
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn-primary-amber"
        disabled={isPending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const r = await optBackInMarketingEmailsAction(userId)
            if (r.ok) setDone(true)
            else setError(r.error ?? 'Something went wrong.')
          })
        }}
        style={{ opacity: isPending ? 0.6 : 1 }}
      >
        {isPending ? 'Resubscribing…' : 'Resubscribe me'}
      </button>
      {error && (
        <div style={{ color: 'var(--c-red)', fontSize: 13, marginTop: 8 }}>{error}</div>
      )}
    </div>
  )
}
