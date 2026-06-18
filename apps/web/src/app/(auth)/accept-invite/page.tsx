'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveAcceptInvite } from './accept-invite'

export const dynamic = 'force-dynamic'

type Status = 'working' | 'code' | 'error'

/**
 * Accept-invitation landing. Consumes the invite token (OTP token_hash or PKCE
 * code) to establish a session, then forwards to /reset-password/confirm where
 * the invited user sets their first password. If the link was burned by an
 * email scanner, we fall back to the 6-digit OTP code from the same email.
 */
export default function AcceptInvitePage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status>('working')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const action = resolveAcceptInvite(new URLSearchParams(searchParams?.toString() ?? ''))
      if (action.kind === 'error') {
        if (!cancelled) {
          setServerError(`This invitation link could not be used (${action.code}). Enter the 6-digit code from your email.`)
          setStatus('code')
        }
        return
      }
      if (action.kind === 'exchange_code') {
        const { error } = await supabase.auth.exchangeCodeForSession(action.code)
        if (cancelled) return
        if (error) { setServerError(error.message); setStatus('code'); return }
        router.replace('/reset-password/confirm?flow=invite')
        return
      }
      // verify_otp
      const { error } = await supabase.auth.verifyOtp({ token_hash: action.tokenHash, type: action.type })
      if (cancelled) return
      if (error) {
        setServerError('Your invitation link has expired or was already used. Enter the 6-digit code from your email.')
        setStatus('code')
        return
      }
      router.replace('/reset-password/confirm?flow=invite')
    }
    void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!/^\S+@\S+\.\S+$/.test(email)) { setServerError('Enter the email this invitation was sent to.'); return }
    if (code.length !== 6) { setServerError('Enter the 6-digit code from your email.'); return }
    setVerifying(true)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'invite' })
    setVerifying(false)
    if (error) { setServerError(error.message); setCode(''); return }
    router.replace('/reset-password/confirm?flow=invite')
  }

  if (status === 'working') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⏳</div>
        <h2>Accepting your invitation…</h2>
        <p>One moment.</p>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Accept your invitation</h2>
      <p className="auth-card-sub">Enter the email this invite was sent to and the 6-digit code.</p>

      <form onSubmit={onVerifyCode}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.co.za"
            className="auth-input"
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="auth-field">
          <label className="auth-label">6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="auth-input"
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
          />
        </div>

        <button type="submit" disabled={verifying || code.length !== 6} className="auth-btn">
          {verifying ? 'Verifying…' : 'Continue →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
