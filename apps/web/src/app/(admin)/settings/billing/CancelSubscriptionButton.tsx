'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelSubscriptionAction } from '@/actions/billing.actions'

export function CancelSubscriptionButton() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    setLoading(true)
    setError(null)
    try {
      const res = await cancelSubscriptionAction()
      if (res.ok) {
        router.refresh()
      } else {
        setError(res.error ?? 'Could not cancel the subscription.')
      }
    } catch {
      setError('Could not cancel the subscription.')
    } finally {
      setLoading(false)
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Cancel subscription
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <p style={{ fontSize: 11, color: 'var(--c-text-dim)', maxWidth: 230, textAlign: 'right' }}>
        Cancel this subscription? Paystack will not charge you again.
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={loading}>
          Keep plan
        </Button>
        <Button variant="danger" size="sm" onClick={handleCancel} isLoading={loading}>
          Confirm cancel
        </Button>
      </div>
      {error && (
        <p style={{ color: '#fca5a5', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{error}</p>
      )}
    </div>
  )
}
