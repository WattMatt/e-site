'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export function BuyGcrSeatButton({ label, userId }: { label: string; userId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBuy() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/paystack/feature-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'generator_cost_recovery',
          target_user_id: userId,
        }),
      })
      const data = await res.json()
      if (res.status === 409 && data.alreadySeatHolder) {
        window.location.reload()
        return
      }
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else if (res.status === 404 || res.status === 501) {
        setError('Purchase flow not yet available — please contact support.')
      } else {
        setError(data.error ?? 'Something went wrong')
      }
    } catch {
      setError('Failed to start payment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button variant="primary" onClick={handleBuy} isLoading={loading}>
        {label}
      </Button>
      {error && (
        <p style={{ color: 'var(--c-red)', fontSize: 11, marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
