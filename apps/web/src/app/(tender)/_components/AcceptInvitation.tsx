'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  acceptInvitationAction,
  continueInvitationAction,
  continueInvitationWithCodeAction,
  emailInvitationLinkAction,
} from '@/actions/tender-portal.actions'

type Msg = { ok: boolean; text: string } | null

/**
 * The invitation, for a contractor who may have no account at all.
 *  - Arrived from the invitation email (k/t in the URL): one button, Continue.
 *    That creates the account if needed and signs in as the invited address.
 *  - Otherwise (a link copied out of E-Site, or the emailed one used or
 *    expired): email a fresh link and code to the invited address, or type the
 *    code from an email already received.
 *  - Signed in as the invited address: Accept.
 * The words "sign in" never appear: a first-time contractor has nothing to sign in to.
 */
export function AcceptInvitation({
  token,
  email,
  canAccept,
  signedInAs,
  access,
}: {
  token: string
  email: string
  canAccept: boolean
  signedInAs: string | null
  access: { k: string; t: string } | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [linkFailed, setLinkFailed] = useState(false)
  const [emailed, setEmailed] = useState(false)
  const [code, setCode] = useState('')
  // Signed in another way (a password): the mailbox must be confirmed once by the emailed link or code.
  const [needEmail, setNeedEmail] = useState(false)
  const [cookiesOff, setCookiesOff] = useState(false)
  useEffect(() => setCookiesOff(typeof navigator !== 'undefined' && navigator.cookieEnabled === false), [])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch {
      // A dropped connection: say so, rather than a button that silently stops.
      setMsg({ ok: false, text: 'We could not reach E-Site. Check your connection and press the button again. If it then says the link was used, press "Email me a fresh link".' })
    } finally {
      setBusy(false)
    }
  }

  const cont = () =>
    run(async () => {
      const r = await continueInvitationAction(token, access!.k, access!.t)
      if ('error' in r) {
        setLinkFailed(true)
        return setMsg({ ok: false, text: r.error })
      }
      // Drop the used token from the address bar, then show Accept.
      router.replace(`/tender/invite/${token}`)
      router.refresh()
    })

  const sendLink = () =>
    run(async () => {
      const r = await emailInvitationLinkAction(token)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setEmailed(true)
      setMsg({ ok: true, text: `Sent to ${r.data.email}. Press the button in that email, or type its 6-digit code below.` })
    })

  const useCode = () =>
    run(async () => {
      const r = await continueInvitationWithCodeAction(token, code)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setNeedEmail(false)
      setMsg({ ok: true, text: 'Confirmed. Now press Accept the invitation.' })
      router.replace(`/tender/invite/${token}`)
      router.refresh()
    })

  const accept = () =>
    run(async () => {
      let r = await acceptInvitationAction(token)
      if ('error' in r && r.needsEmailLink && access) {
        // The invitation email's link is in the address bar: use it, then accept.
        const c = await continueInvitationAction(token, access.k, access.t)
        if (!('error' in c)) r = await acceptInvitationAction(token)
      }
      if ('error' in r) {
        if (r.needsEmailLink) setNeedEmail(true)
        return setMsg({ ok: false, text: r.error })
      }
      router.push(`/tender/${r.data.tenderId}`)
    })

  const message = msg && (
    <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>
  )

  const cookieWarning = cookiesOff && (
    <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--c-red)' }}>
      This browser is blocking cookies, so E-Site cannot keep you signed in. Allow cookies for e-site.live, or open the link in another browser.
    </p>
  )

  if (canAccept && !needEmail) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {cookieWarning}
        <p style={{ margin: 0, fontSize: 14 }}>You are in as <strong>{email}</strong>. Accept the invitation to see the bill of quantities and start pricing.</p>
        <div><Button isLoading={busy} onClick={accept}>Accept the invitation</Button></div>
        {message}
      </div>
    )
  }

  if (signedInAs && !canAccept) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <p role="status" style={{ margin: 0, fontSize: 14 }}>
          This browser is signed in to E-Site as <strong>{signedInAs}</strong>, but the invitation is for <strong>{email}</strong>.
          Sign out of that account, then open the invitation again from its email (or use a private window).
        </p>
        <form action="/auth/signout" method="post"><input type="hidden" name="to" value="/tender/login" /><button type="submit" className="btn btn-sm">Sign out of {signedInAs}</button></form>
      </div>
    )
  }

  const showFallback = !access || linkFailed || needEmail
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {cookieWarning}
      {access && !linkFailed && !needEmail && (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 14 }}>No password is needed. Press Continue to open the tender as <strong>{email}</strong>.</p>
          <div><Button isLoading={busy} onClick={cont}>Continue</Button></div>
        </div>
      )}
      {showFallback && (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            No password is needed. We email a secure link and a 6-digit code to <strong>{email}</strong>; either one opens the tender.
          </p>
          <div><Button isLoading={busy} variant={emailed ? 'secondary' : 'primary'} onClick={sendLink}>{emailed ? 'Send another link' : 'Email me a fresh link'}</Button></div>
        </div>
      )}
      {(showFallback || emailed) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="tender-code" style={{ fontSize: 13 }}>Have a code from the email?</label>
          <input
            id="tender-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            style={{ width: 110, letterSpacing: 2 }}
          />
          <Button size="sm" variant="secondary" isLoading={busy} disabled={code.length !== 6} onClick={useCode}>Use code</Button>
        </div>
      )}
      {message}
    </div>
  )
}
