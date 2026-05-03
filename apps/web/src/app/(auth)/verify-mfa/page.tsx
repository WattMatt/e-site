'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { challengeMfaAction } from '@/actions/mfa.actions'

export default function VerifyMfaPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await challengeMfaAction(code)
      if (r.ok) {
        const next = new URLSearchParams(window.location.search).get('next') ?? '/dashboard'
        router.replace(next)
      } else {
        setError(r.error ?? 'Verification failed.')
        setCode('')
      }
    })
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Two-factor verification</h2>
      <p className="auth-card-sub">Enter the 6-digit code from your authenticator app</p>

      <form onSubmit={onSubmit}>
        {error && <div className="auth-alert-error">{error}</div>}
        <div className="auth-field">
          <label className="auth-label">Code</label>
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
            autoFocus
          />
        </div>
        <button type="submit" disabled={pending || code.length !== 6} className="auth-btn">
          {pending ? 'Verifying…' : 'Verify →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">Cancel and sign out</Link>
      </div>
    </div>
  )
}
