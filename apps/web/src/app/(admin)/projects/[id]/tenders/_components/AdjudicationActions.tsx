'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { closeTenderAction, markAdjudicatedAction } from '@/actions/tender-adjudication.actions'

export function AdjudicationActions({ tenderId, status }: { tenderId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<{ data: unknown } | { error: string }>) {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if ('error' in r) return setError(r.error)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {status === 'issued' && <Button size="sm" variant="secondary" isLoading={busy} onClick={() => run(() => closeTenderAction(tenderId))}>Mark tender closed</Button>}
      {status === 'closed' && <Button size="sm" isLoading={busy} onClick={() => run(() => markAdjudicatedAction(tenderId))}>Mark adjudicated</Button>}
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </span>
  )
}
