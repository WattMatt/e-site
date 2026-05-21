'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { updatePasswordSchema, type UpdatePasswordInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { completeInviteAction } from '@/actions/invitations.actions'
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter'
import type { PasswordEvaluation } from '@/lib/password-strength'

// createClient() at component-eval requires NEXT_PUBLIC_SUPABASE_* env vars
// not present during prerender; force-dynamic ensures this runs server-side only.
export const dynamic = 'force-dynamic'

const MIN_ACCEPTABLE_SCORE = 2

type Status = 'checking' | 'ready' | 'invalid' | 'updated'

/**
 * Invite accept page. Reached after a new user clicks their Supabase invite
 * email link → /auth/callback verifies the type=invite token and establishes
 * a session → redirects here.
 *
 * On arrival with a session → 'ready': show the create-password form.
 * No session (link burned by a scanner, or direct URL) → 'invalid': surface
 * a code-fallback allowing email + 6-digit OTP entry.
 */
export default function InviteAcceptPage() {
  const supabase = createClient()
  const router = useRouter()

  const [status, setStatus] = useState<Status>('checking')
  const [serverError, setServerError] = useState<string | null>(null)
  const [pwEval, setPwEval] = useState<PasswordEvaluation | null>(null)

  // Code-fallback state (shown when status === 'invalid')
  const [showCodeFallback, setShowCodeFallback] = useState(false)
  const [fallbackEmail, setFallbackEmail] = useState('')
  const [fallbackCode, setFallbackCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UpdatePasswordInput>({ resolver: zodResolver(updatePasswordSchema) })
  const password = watch('password') ?? ''

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setStatus(data.session ? 'ready' : 'invalid')
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit({ password: newPassword }: UpdatePasswordInput) {
    setServerError(null)
    if (pwEval && (pwEval.pwned || pwEval.score < MIN_ACCEPTABLE_SCORE)) {
      setServerError(
        pwEval.pwned
          ? 'This password has appeared in known breaches — choose a different one.'
          : 'This password is too weak. Aim for a longer phrase or mix of words.',
      )
      return
    }
    const result = await completeInviteAction({ password: newPassword })
    if (!result.ok) {
      setServerError(result.error)
      return
    }
    setStatus('updated')
    // Brief confirmation then redirect
    setTimeout(() => { router.push('/dashboard') }, 1500)
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fallbackEmail || !/^\S+@\S+\.\S+$/.test(fallbackEmail)) {
      setServerError('Enter your email address.')
      return
    }
    if (fallbackCode.length !== 6) {
      setServerError('Enter the 6-digit code from your invite email.')
      return
    }
    setVerifying(true)
    const { error } = await supabase.auth.verifyOtp({
      email: fallbackEmail.trim().toLowerCase(),
      token: fallbackCode,
      type:  'invite',
    })
    setVerifying(false)
    if (error) {
      setServerError(error.message)
      setFallbackCode('')
      return
    }
    // OTP verified — session established, proceed to password form
    setServerError(null)
    setStatus('ready')
  }

  // ── Checking ──────────────────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⏳</div>
        <h2>Verifying…</h2>
        <p>One moment.</p>
      </div>
    )
  }

  // ── Updated (brief confirmation) ─────────────────────────────────────────
  if (status === 'updated') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">✅</div>
        <h2>Password set</h2>
        <p>Taking you to your dashboard…</p>
      </div>
    )
  }

  // ── Invalid — expired or already used ────────────────────────────────────
  if (status === 'invalid') {
    return (
      <div className="auth-card">
        <h2 className="auth-card-title">Invite link expired</h2>
        <p className="auth-card-sub">
          This invite link has expired or was already used.
        </p>

        {!showCodeFallback ? (
          <>
            {serverError && <div className="auth-alert-error">{serverError}</div>}
            <button
              type="button"
              className="auth-btn"
              onClick={() => { setShowCodeFallback(true); setServerError(null) }}
            >
              I have a 6-digit code →
            </button>
            <div className="auth-links" style={{ marginTop: 16 }}>
              <Link href="/login" className="auth-link">← Back to sign in</Link>
            </div>
          </>
        ) : (
          <form onSubmit={onVerifyCode} style={{ marginTop: 8 }}>
            {serverError && <div className="auth-alert-error">{serverError}</div>}

            <div className="auth-field">
              <label className="auth-label">Your email</label>
              <input
                type="email"
                value={fallbackEmail}
                onChange={(e) => setFallbackEmail(e.target.value)}
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
                value={fallbackCode}
                onChange={(e) => setFallbackCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="auth-input"
                style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
              />
            </div>

            <button
              type="submit"
              disabled={verifying || fallbackCode.length !== 6}
              className="auth-btn"
            >
              {verifying ? 'Verifying…' : 'Continue →'}
            </button>

            <div className="auth-links" style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => { setShowCodeFallback(false); setServerError(null) }}
                className="auth-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                ← Back
              </button>
              <Link href="/login" className="auth-link">Sign in</Link>
            </div>
          </form>
        )}
      </div>
    )
  }

  // ── Ready — create password form ─────────────────────────────────────────
  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Welcome to E-Site — create your password</h2>
      <p className="auth-card-sub">Choose a strong password to secure your account</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">Password</label>
          <input
            {...register('password')}
            type="password"
            className={`auth-input${errors.password ? ' auth-input-error' : ''}`}
            autoComplete="new-password"
            autoFocus
          />
          {errors.password && <p className="auth-error-text">{errors.password.message}</p>}
          <PasswordStrengthMeter password={password} onChange={setPwEval} />
        </div>

        <div className="auth-field">
          <label className="auth-label">Confirm password</label>
          <input
            {...register('confirmPassword')}
            type="password"
            className={`auth-input${errors.confirmPassword ? ' auth-input-error' : ''}`}
            autoComplete="new-password"
          />
          {errors.confirmPassword && (
            <p className="auth-error-text">{errors.confirmPassword.message}</p>
          )}
        </div>

        <button type="submit" disabled={isSubmitting} className="auth-btn">
          {isSubmitting ? 'Setting password…' : 'Create password →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
