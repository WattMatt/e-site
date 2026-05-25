'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export function UnlockJbccButton({ label, projectId }: { label: string; projectId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnlock() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/paystack/feature-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_key: 'jbcc' }),
      })
      const data = await res.json()
      if (res.status === 409 && data.alreadyUnlocked) {
        window.location.href = `/projects/${projectId}/jbcc`
        return
      }
      if (data.authorization_url) {
        window.location.href = data.authorization_url
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
      <Button variant="primary" onClick={handleUnlock} isLoading={loading}>
        {label}
      </Button>
      {error && (
        <p style={{ color: '#fca5a5', fontSize: 11, marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
