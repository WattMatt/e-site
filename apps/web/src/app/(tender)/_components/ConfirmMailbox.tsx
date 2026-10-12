'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { requestTenderAccessAction } from '@/actions/tender-portal.actions'

/**
 * Shown on /tender to someone signed in with a password: tenders are only shown
 * to a session opened from an emailed link or code, so offer that link.
 */
export function ConfirmMailbox({ email }: { email: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <div role="status" style={{ display: 'grid', gap: 8, border: '1px solid var(--c-amber)', borderRadius: 8, padding: 12, fontSize: 14 }}>
      <span>
        You signed in to E-Site with a password. Tenders are shown only after you confirm <strong>{email}</strong> once with a link we email you.
      </span>
      <div>
        <Button
          isLoading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await requestTenderAccessAction(email)
              setMsg({ ok: true, text: `Sent to ${email}. Press Continue in that email, or type its code on the page it opens.` })
            } catch {
              setMsg({ ok: false, text: 'We could not reach E-Site. Check your connection and try again.' })
            } finally {
              setBusy(false)
            }
          }}
        >
          Email me a link
        </Button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
