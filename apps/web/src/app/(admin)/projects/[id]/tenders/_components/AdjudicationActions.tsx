'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { closeTenderAction, markAdjudicatedAction } from '@/actions/tender-adjudication.actions'

/**
 * Close (issued → closed) and Mark adjudicated (closed → adjudicated). Both are
 * one-way, so each takes two presses: the first arms it, the second commits,
 * and an armed button disarms after a few seconds (never window.confirm, which
 * Safari can suppress).
 */
export function AdjudicationActions({ tenderId, status }: { tenderId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  async function run(fn: () => Promise<{ data: unknown } | { error: string }>) {
    if (!armed) return setArmed(true)
    setArmed(false)
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
      {status === 'issued' && (
        <Button size="sm" variant={armed ? 'primary' : 'secondary'} isLoading={busy} onClick={() => run(() => closeTenderAction(tenderId))}>
          {armed ? 'Press again: close and open the bids' : 'Close tender'}
        </Button>
      )}
      {status === 'closed' && (
        <Button size="sm" variant={armed ? 'primary' : 'secondary'} isLoading={busy} onClick={() => run(() => markAdjudicatedAction(tenderId))}>
          {armed ? 'Press again: this is final' : 'Mark adjudicated'}
        </Button>
      )}
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </span>
  )
}
