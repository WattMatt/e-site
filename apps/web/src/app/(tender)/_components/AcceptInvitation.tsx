'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { acceptInvitationAction, sendInvitationSignInAction } from '@/actions/tender-portal.actions'

/**
 * Two steps, by design: the link alone never signs anyone in.
 *  1. Not signed in as the invited address → email a sign-in link to it.
 *  2. Signed in as the invited address → accept.
 */
export function AcceptInvitation({
  token,
  email,
  canAccept,
  signedInAs,
}: {
  token: string
  email: string
  canAccept: boolean
  signedInAs: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function sendLink() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await sendInvitationSignInAction(token)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setMsg({ ok: true, text: `We emailed a sign-in link to ${r.data.email}. Open it on this device to continue.` })
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await acceptInvitationAction(token)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      router.push(`/tender/${r.data.tenderId}`)
    } finally {
      setBusy(false)
    }
  }

  if (canAccept) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button isLoading={busy} onClick={accept}>Accept the invitation</Button>
        {msg && <span role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{msg.text}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {signedInAs && (
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          You are signed in as {signedInAs}, but this invitation is for {email}. Sign out first, then open the invitation link again.{' '}
          <form action="/auth/signout" method="post" style={{ display: 'inline' }}>
            <button type="submit" className="btn btn-sm">Sign out</button>
          </form>
        </p>
      )}
      {!signedInAs && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button isLoading={busy} onClick={sendLink}>Email a sign-in link to {email}</Button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}
