'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { resetPasswordSchema, type ResetPasswordInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { recordAuthEventAction } from '@/actions/auth-event.actions'
import { CaptchaTurnstile, CAPTCHA_ENABLED } from '@/components/CaptchaTurnstile'

type Step = 'email' | 'code'

/**
 * Password-reset flow with OTP-first approach. Supabase emails carry both
 * a 6-digit code AND a clickable link. We default to the code path because
 * email scanners (Microsoft Defender / Mimecast / Proofpoint / corporate
 * gateways) silently pre-fetch links and burn the single-use token.
 *
 * Flow:
 *   1. Enter email → resetPasswordForEmail → "Code sent"
 *   2. Enter 6-digit code → verifyOtp(type: 'recovery') → session established
 *   3. Router pushes to /reset-password/confirm → set new password
 *
 * Users whose email passes through unscathed can still click the email's
 * fallback link, which routes through /auth/callback → /reset-password/confirm.
 */
export default function ResetPasswordPage() {
  const supabase = createClient()
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) })

  async function onRequestCode({ email: rawEmail }: ResetPasswordInput) {
    setServerError(null)
    if (CAPTCHA_ENABLED && !captchaToken) {
      setServerError('Please complete the verification challenge.')
      return
    }
    const trimmed = rawEmail.trim().toLowerCase()
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password/confirm`
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo,
      ...(captchaToken ? { captchaToken } : {}),
    })
    if (error) {
      console.error('resetPasswordForEmail failed', error)
      setServerError(error.message)
      return
    }
    void recordAuthEventAction('password_reset_requested', {
      email_domain: trimmed.split('@')[1] ?? null,
    }).catch(() => { /* audit best-effort */ })
    setEmail(trimmed)
    setStep('code')
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (code.length !== 6) {
      setServerError('Enter the 6-digit code from your email.')
      return
    }
    setVerifying(true)
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type:  'recovery',
    })
    setVerifying(false)
    if (error) {
      console.error('verifyOtp recovery failed', error)
      setServerError(error.message)
      setCode('')
      return
    }
    router.replace('/reset-password/confirm')
  }

  if (step === 'code') {
    return (
      <div className="auth-card">
        <h2 className="auth-card-title">Enter your code</h2>
        <p className="auth-card-sub">
          We sent a 6-digit code to <strong>{email}</strong>. The code expires in 1 hour.
        </p>

        <form onSubmit={onVerifyCode}>
          {serverError && <div className="auth-alert-error">{serverError}</div>}
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
              autoFocus
            />
          </div>
          <button type="submit" disabled={verifying || code.length !== 6} className="auth-btn">
            {verifying ? 'Verifying…' : 'Continue →'}
          </button>
        </form>

        <div className="auth-links">
          <button
            type="button"
            onClick={() => { setStep('email'); setCode(''); setServerError(null) }}
            className="auth-link"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← Different email
          </button>
          <Link href="/login" className="auth-link">Back to sign in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Reset password</h2>
      <p className="auth-card-sub">Enter your email and we&apos;ll send you a 6-digit code</p>

      <form onSubmit={handleSubmit(onRequestCode)}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            {...register('email')}
            type="email"
            className={`auth-input${errors.email ? ' auth-input-error' : ''}`}
            placeholder="you@company.co.za"
            autoComplete="email"
            autoFocus
          />
          {errors.email && <p className="auth-error-text">{errors.email.message}</p>}
        </div>

        <CaptchaTurnstile onToken={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />

        <button type="submit" disabled={isSubmitting} className="auth-btn">
          {isSubmitting ? 'Sending…' : 'Send code →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
