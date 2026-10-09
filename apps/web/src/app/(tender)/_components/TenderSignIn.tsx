'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { requestTenderSignInAction } from '@/actions/tender-portal.actions'

export function TenderSignIn() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function send() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await requestTenderSignInAction(email)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      // Same answer whether or not the address has an account.
      setMsg({ ok: true, text: 'If that address has a tender account, a sign-in link is on its way.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input type="email" autoComplete="email" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.co.za" style={{ minWidth: 260 }} />
      <Button isLoading={busy} onClick={send} disabled={!email.includes('@')}>Email me a sign-in link</Button>
      {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
    </div>
  )
}
