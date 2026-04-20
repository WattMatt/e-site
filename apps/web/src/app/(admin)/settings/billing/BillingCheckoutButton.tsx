'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

interface Props {
  tier: string
  period: 'monthly' | 'annual'
  label: string
  variant?: 'primary' | 'ghost'
}

export function BillingCheckoutButton({ tier, period, label, variant = 'primary' }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/paystack/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, period }),
      })
      const data = await res.json()
      if (data.contactSales) {
        window.location.href = 'mailto:sales@e-site.co.za'
        return
      }
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else {
        setError(data.error ?? 'Something went wrong')
      }
    } catch {
      setError('Failed to initiate checkout')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button
        variant={variant}
        size="sm"
        onClick={handleCheckout}
        isLoading={loading}
        className="w-full"
      >
        {label}
      </Button>
      {error && (
        <p style={{ color: '#fca5a5', fontSize: 11, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
