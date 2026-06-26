'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

// Starts the per-user MV subscription. Pressing this button IS the acceptance of
// the non-validation disclaimer shown above it (recorded server-side before the
// Paystack redirect). On success Paystack returns a hosted-page URL we redirect
// to; the webhook grants access on the first successful charge.
export function MvSubscribeButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubscribe() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/paystack/mv-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else {
        setError(data.error ?? 'Something went wrong')
      }
    } catch {
      setError('Failed to start subscription')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button variant="primary" onClick={handleSubscribe} isLoading={loading}>
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
