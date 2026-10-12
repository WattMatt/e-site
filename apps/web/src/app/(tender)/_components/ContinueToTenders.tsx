'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { continueReturnVisitAction } from '@/actions/tender-portal.actions'
import { TenderSignIn } from './TenderSignIn'

/**
 * An accepted (or replaced) invitation opened again from its email. One button
 * uses the email's sign-in if it is still good; otherwise the email-and-code
 * form is right here, never a dead end.
 */
export function ContinueToTenders({ access }: { access: { k: string; t: string } | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!access || error) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--c-red)' }}>{error}</p>}
        <p style={{ margin: 0, fontSize: 14 }}>Enter the email address the invitation was sent to. We email you a link and a 6-digit code; there is no password.</p>
        <TenderSignIn access={null} initialEmail="" />
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
          } catch {
            setError('We could not reach E-Site. Check your connection and try again.')
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
