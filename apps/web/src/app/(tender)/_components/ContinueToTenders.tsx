'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { continueReturnVisitAction } from '@/actions/tender-portal.actions'

/** An accepted invitation opened again from its email: one button to the tenders, or the return-visit page. */
export function ContinueToTenders({ access }: { access: { k: string; t: string } | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!access || error) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--c-red)' }}>{error}</p>}
        <div><a className="btn" href="/tender/login">Go to my tenders</a></div>
      </div>
    )
  }
  return (
    <div>
      <Button
        isLoading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await continueReturnVisitAction(access.k, access.t)
            if ('error' in r) return setError(r.error)
            router.push('/tender')
          } finally {
            setBusy(false)
          }
        }}
      >
        Continue to my tenders
      </Button>
    </div>
  )
}
