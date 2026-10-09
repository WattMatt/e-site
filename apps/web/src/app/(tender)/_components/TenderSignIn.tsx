'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  continueReturnVisitAction,
  continueReturnVisitWithCodeAction,
  requestTenderAccessAction,
} from '@/actions/tender-portal.actions'

type Msg = { ok: boolean; text: string } | null

/**
 * Coming back to a tender. No password: a link and a 6-digit code are emailed
 * to the address the invitation went to. Arriving from that email (k/t in the
 * URL) shows one button, Continue.
 */
export function TenderSignIn({ access, initialEmail }: { access: { k: string; t: string } | null; initialEmail: string }) {
  const router = useRouter()
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [linkFailed, setLinkFailed] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const cont = () =>
    run(async () => {
      const r = await continueReturnVisitAction(access!.k, access!.t)
      if ('error' in r) {
        setLinkFailed(true)
        return setMsg({ ok: false, text: r.error })
      }
      router.push('/tender')
    })

  const send = () =>
    run(async () => {
      const r = await requestTenderAccessAction(email)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setSent(true)
      // Same answer whether or not the address has a tender invitation.
      setMsg({ ok: true, text: `If ${email} has a tender invitation, a link and a 6-digit code are on their way. Press the button in the email, or type the code below.` })
    })

  const useCode = () =>
    run(async () => {
      const r = await continueReturnVisitWithCodeAction(email, code)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      router.push('/tender')
    })

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {access && !linkFailed && (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 14 }}>Press Continue to open your tenders{initialEmail ? ` as ${initialEmail}` : ''}.</p>
          <div><Button isLoading={busy} onClick={cont}>Continue</Button></div>
        </div>
      )}
      {(!access || linkFailed) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="email" autoComplete="email" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.co.za" style={{ minWidth: 260 }} />
          <Button isLoading={busy} onClick={send} disabled={!email.includes('@')}>{sent ? 'Send another' : 'Email me a link and code'}</Button>
        </div>
      )}
      {(sent || linkFailed || !access) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="tender-return-code" style={{ fontSize: 13 }}>Have a code?</label>
          <input
            id="tender-return-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            style={{ width: 110, letterSpacing: 2 }}
          />
          <Button size="sm" variant="secondary" isLoading={busy} disabled={code.length !== 6 || !email.includes('@')} onClick={useCode}>Use code</Button>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
