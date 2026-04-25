'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { updatePasswordSchema, type UpdatePasswordInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

type Status = 'checking' | 'ready' | 'invalid' | 'updated'

export default function ResetPasswordConfirmPage() {
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('checking')
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdatePasswordInput>({ resolver: zodResolver(updatePasswordSchema) })

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setStatus(data.session ? 'ready' : 'invalid')
    })
    return () => { cancelled = true }
  }, [supabase])

  async function onSubmit({ password }: UpdatePasswordInput) {
    setServerError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setServerError(error.message)
      return
    }
    await supabase.auth.signOut()
    setStatus('updated')
  }

  if (status === 'checking') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⏳</div>
        <h2>Verifying link…</h2>
        <p>One moment while we check your reset link.</p>
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⚠️</div>
        <h2>Link invalid or expired</h2>
        <p>This reset link can no longer be used. Request a new one to continue.</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <Link href="/reset-password" className="auth-link">
            <span className="auth-link-accent">Request a new link</span>
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
          />
          {errors.password && <p className="auth-error-text">{errors.password.message}</p>}
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
