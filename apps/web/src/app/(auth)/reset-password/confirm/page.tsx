'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { updatePasswordSchema, type UpdatePasswordInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { recordAuthEventAction } from '@/actions/auth-event.actions'
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter'
import type { PasswordEvaluation } from '@/lib/password-strength'

const MIN_ACCEPTABLE_SCORE = 2

type Status = 'checking' | 'ready' | 'invalid' | 'updated'

/**
 * Set-new-password page. Reached two ways:
 *
 *   1. After verifyOtp({ type: 'recovery' }) succeeds on /reset-password —
 *      session is already established, we go straight to the password form.
 *   2. By clicking the email's fallback link → /auth/callback exchanges the
 *      token and redirects here with a session.
 *
 * If neither succeeded (link burned by a scanner, or direct URL visit
 * without a recovery session), we surface a "request a new code" link
 * back to /reset-password.
 */
export default function ResetPasswordConfirmPage() {
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('checking')
  const [serverError, setServerError] = useState<string | null>(null)
  const [pwEval, setPwEval] = useState<PasswordEvaluation | null>(null)

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
  }, [supabase])

  async function onSubmit({ password: newPassword }: UpdatePasswordInput) {
    setServerError(null)
    if (pwEval && (pwEval.pwned || pwEval.score < MIN_ACCEPTABLE_SCORE)) {
      setServerError(pwEval.pwned
        ? 'This password has appeared in known breaches — choose a different one.'
        : 'This password is too weak. Aim for a longer phrase or mix of words.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setServerError(error.message)
      return
    }
    void recordAuthEventAction('password_changed', { via: 'reset_otp' })
      .catch(() => { /* audit best-effort */ })
    await supabase.auth.signOut()
    setStatus('updated')
  }

  if (status === 'checking') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⏳</div>
        <h2>Verifying…</h2>
        <p>One moment.</p>
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⚠️</div>
        <h2>Session not found</h2>
        <p>The reset link or code wasn&apos;t completed. Request a new code to continue.</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <Link href="/reset-password" className="auth-link">
            <span className="auth-link-accent">Request a new code</span>
          </Link>
          <Link href="/login" className="auth-link">← Back to sign in</Link>
        </div>
      </div>
    )
  }

  if (status === 'updated') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">✅</div>
        <h2>Password updated</h2>
        <p>You can now sign in with your new password.</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <Link href="/login" className="auth-link">
            <span className="auth-link-accent">Sign in →</span>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Set new password</h2>
      <p className="auth-card-sub">Choose a strong password you haven&apos;t used before</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">New password</label>
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
          <label className="auth-label">Confirm new password</label>
          <input
            {...register('confirmPassword')}
            type="password"
            className={`auth-input${errors.confirmPassword ? ' auth-input-error' : ''}`}
            autoComplete="new-password"
          />
          {errors.confirmPassword && <p className="auth-error-text">{errors.confirmPassword.message}</p>}
        </div>

        <button type="submit" disabled={isSubmitting} className="auth-btn">
          {isSubmitting ? 'Updating…' : 'Update password →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
