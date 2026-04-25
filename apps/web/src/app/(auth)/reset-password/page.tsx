'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { resetPasswordSchema, type ResetPasswordInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) })

  async function onSubmit({ email }: ResetPasswordInput) {
    setServerError(null)
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password/confirm`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) {
      setServerError(error.message)
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">📬</div>
        <h2>Check your inbox</h2>
        <p>If an account exists for that email, we sent a link to reset your password. The link expires in 1 hour.</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <Link href="/login" className="auth-link">← Back to sign in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Reset password</h2>
      <p className="auth-card-sub">Enter your email and we&apos;ll send you a reset link</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            {...register('email')}
            type="email"
            className={`auth-input${errors.email ? ' auth-input-error' : ''}`}
            placeholder="you@company.co.za"
            autoComplete="email"
          />
          {errors.email && <p className="auth-error-text">{errors.email.message}</p>}
        </div>

        <button type="submit" disabled={isSubmitting} className="auth-btn">
          {isSubmitting ? 'Sending…' : 'Send reset link →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
