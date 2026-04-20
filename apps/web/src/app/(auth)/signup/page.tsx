'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { signUpSchema, type SignUpInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const supabase = createClient()
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) })

  async function onSubmit({ fullName, email, password }: SignUpInput) {
    setServerError(null)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) { setServerError(error.message); return }

    // Fire the Day-0 onboarding email. Non-blocking — we still show the
    // "check your inbox" success state even if the Edge Function hiccups.
    // The d0 email is idempotent on the server side, so a retry on next
    // signup attempt won't double-send.
    if (data.user?.id) {
      void supabase.functions.invoke('onboarding-email-d0', {
        body: { userId: data.user.id, email, firstName: fullName.split(' ')[0] },
      }).catch(() => { /* swallow — the welcome is a nice-to-have */ })
    }

    setSuccess(true)
  }

  if (success) {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">📬</div>
        <h2>Check your inbox</h2>
        <p>We sent a confirmation link to your email. Click it to activate your account.</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <Link href="/login" className="auth-link">← Back to sign in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Create account</h2>
      <p className="auth-card-sub">Get your team on E-Site in minutes</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">Full name</label>
          <input
            {...register('fullName')}
            className={`auth-input${errors.fullName ? ' auth-input-error' : ''}`}
            placeholder="Arno Watson"
            autoComplete="name"
          />
          {errors.fullName && <p className="auth-error-text">{errors.fullName.message}</p>}
        </div>

        <div className="auth-field">
          <label className="auth-label">Work email</label>
          <input
            {...register('email')}
            type="email"
            className={`auth-input${errors.email ? ' auth-input-error' : ''}`}
            placeholder="you@company.co.za"
            autoComplete="email"
          />
          {errors.email && <p className="auth-error-text">{errors.email.message}</p>}
        </div>

        <div className="auth-field">
          <label className="auth-label">Password</label>
          <input
            {...register('password')}
            type="password"
            className={`auth-input${errors.password ? ' auth-input-error' : ''}`}
            autoComplete="new-password"
          />
          {errors.password && <p className="auth-error-text">{errors.password.message}</p>}
        </div>

        <div className="auth-field">
          <label className="auth-label">Confirm password</label>
          <input
            {...register('confirmPassword')}
            type="password"
            className={`auth-input${errors.confirmPassword ? ' auth-input-error' : ''}`}
            autoComplete="new-password"
          />
          {errors.confirmPassword && <p className="auth-error-text">{errors.confirmPassword.message}</p>}
        </div>

        <div className="auth-checkbox-row">
          <input {...register('popiaConsent')} type="checkbox" id="popiaConsent" className="auth-checkbox" />
          <label htmlFor="popiaConsent" className="auth-checkbox-label">
            I consent to E-Site processing my personal information under POPIA.
            Data may be processed outside South Africa subject to adequate safeguards.
          </label>
        </div>
        {errors.popiaConsent && (
          <p className="auth-error-text" style={{ marginTop: -6, marginBottom: 10 }}>
            {errors.popiaConsent.message}
          </p>
        )}

        <button type="submit" disabled={isSubmitting} className="auth-btn">
          {isSubmitting ? 'Creating account…' : 'Create account →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">
          Already have an account? <span className="auth-link-accent">Sign in</span>
        </Link>
      </div>
    </div>
  )
}
