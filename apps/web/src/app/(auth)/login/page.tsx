'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { signInSchema, type SignInInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { recordAuthEventAction } from '@/actions/auth-event.actions'
import { CaptchaTurnstile, CAPTCHA_ENABLED } from '@/components/CaptchaTurnstile'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'

const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
})
type MagicLinkInput = z.infer<typeof magicLinkSchema>

type Mode = 'password' | 'magic-link'
type MagicLinkStep = 'email' | 'code'

export default function LoginPage() {
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('password')
  const [serverError, setServerError] = useState<string | null>(null)
  const [mlStep, setMlStep] = useState<MagicLinkStep>('email')
  const [mlEmail, setMlEmail] = useState('')
  const [mlCode, setMlCode] = useState('')
  const [mlVerifying, setMlVerifying] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  // Password form
  const pw = useForm<SignInInput>({ resolver: zodResolver(signInSchema) })
  // Magic link form
  const ml = useForm<MagicLinkInput>({ resolver: zodResolver(magicLinkSchema) })

  async function onPasswordSubmit({ email, password }: SignInInput) {
    setServerError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })
    if (error) { setServerError(error.message); return }
    void recordAuthEventAction('login', { method: 'password' }).catch(() => {})
    const next = new URLSearchParams(window.location.search).get('next') ?? '/dashboard'
    window.location.href = next
  }

  async function onMagicLinkSubmit({ email }: MagicLinkInput) {
    setServerError(null)
    if (CAPTCHA_ENABLED && !captchaToken) {
      setServerError('Please complete the verification challenge.')
      return
    }
    const trimmed = email.trim().toLowerCase()
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=/dashboard&from=magic_link`
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo,
        shouldCreateUser: false,  // magic-link is for existing accounts only
        ...(captchaToken ? { captchaToken } : {}),
      },
    })
    if (error) {
      console.error('signInWithOtp failed', error)
      setServerError(error.message)
      return
    }
    void recordAuthEventAction('magic_link_requested', { email_domain: trimmed.split('@')[1] ?? null })
      .catch(() => {})
    setMlEmail(trimmed)
    setMlStep('code')
  }

  async function onMagicLinkVerify(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (mlCode.length !== 6) {
      setServerError('Enter the 6-digit code from your email.')
      return
    }
    setMlVerifying(true)
    const { error } = await supabase.auth.verifyOtp({
      email: mlEmail,
      token: mlCode,
      type:  'email',  // signInWithOtp sends type='email' OTPs
    })
    setMlVerifying(false)
    if (error) {
      console.error('verifyOtp magic link failed', error)
      setServerError(error.message)
      setMlCode('')
      return
    }
    void recordAuthEventAction('login', { method: 'magic_link' }).catch(() => {})
    const next = new URLSearchParams(window.location.search).get('next') ?? '/dashboard'
    window.location.href = next
  }

  if (mode === 'magic-link' && mlStep === 'code') {
    return (
      <div className="auth-card">
        <h2 className="auth-card-title">Enter your code</h2>
        <p className="auth-card-sub">
          We sent a 6-digit code to <strong>{mlEmail}</strong>. The code expires in 1 hour.
        </p>
        <form onSubmit={onMagicLinkVerify}>
          {serverError && <div className="auth-alert-error">{serverError}</div>}
          <div className="auth-field">
            <label className="auth-label">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mlCode}
              onChange={(e) => setMlCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="auth-input"
              style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
              autoFocus
            />
          </div>
          <button type="submit" disabled={mlVerifying || mlCode.length !== 6} className="auth-btn">
            {mlVerifying ? 'Verifying…' : 'Sign in →'}
          </button>
        </form>
        <div className="auth-links">
          <button
            type="button"
            onClick={() => { setMlStep('email'); setMlCode(''); setServerError(null) }}
            className="auth-link"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← Different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Welcome back</h2>
      <p className="auth-card-sub">Sign in to your E-Site workspace</p>

      <GoogleSignInButton />

      <div role="tablist" aria-label="Sign-in method" style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'password'}
          onClick={() => { setMode('password'); setServerError(null); setCaptchaToken(null) }}
          className="auth-link"
          style={{
            flex: 1,
            padding: '8px 0',
            borderBottom: mode === 'password' ? '2px solid var(--c-amber)' : '2px solid transparent',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: mode === 'password' ? 'var(--c-amber)' : 'var(--c-text-dim)',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Password
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'magic-link'}
          onClick={() => { setMode('magic-link'); setServerError(null); setCaptchaToken(null) }}
          className="auth-link"
          style={{
            flex: 1,
            padding: '8px 0',
            borderBottom: mode === 'magic-link' ? '2px solid var(--c-amber)' : '2px solid transparent',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: mode === 'magic-link' ? 'var(--c-amber)' : 'var(--c-text-dim)',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Magic link
        </button>
      </div>

      {mode === 'password' ? (
        <form onSubmit={pw.handleSubmit(onPasswordSubmit)}>
          {serverError && <div className="auth-alert-error">{serverError}</div>}
          <div className="auth-field">
            <label className="auth-label">Email</label>
            <input
              {...pw.register('email')}
              type="email"
              className={`auth-input${pw.formState.errors.email ? ' auth-input-error' : ''}`}
              placeholder="you@company.co.za"
              autoComplete="email"
            />
            {pw.formState.errors.email && <p className="auth-error-text">{pw.formState.errors.email.message}</p>}
          </div>
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input
              {...pw.register('password')}
              type="password"
              className={`auth-input${pw.formState.errors.password ? ' auth-input-error' : ''}`}
              autoComplete="current-password"
            />
            {pw.formState.errors.password && <p className="auth-error-text">{pw.formState.errors.password.message}</p>}
          </div>
          <CaptchaTurnstile onToken={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />
          <button type="submit" disabled={pw.formState.isSubmitting} className="auth-btn">
            {pw.formState.isSubmitting ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>
      ) : (
        <form onSubmit={ml.handleSubmit(onMagicLinkSubmit)}>
          {serverError && <div className="auth-alert-error">{serverError}</div>}
          <div className="auth-field">
            <label className="auth-label">Email</label>
            <input
              {...ml.register('email')}
              type="email"
              className={`auth-input${ml.formState.errors.email ? ' auth-input-error' : ''}`}
              placeholder="you@company.co.za"
              autoComplete="email"
            />
            {ml.formState.errors.email && <p className="auth-error-text">{ml.formState.errors.email.message}</p>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: '0 0 14px' }}>
            We&apos;ll email you a one-time sign-in link. No password required.
          </p>
          <CaptchaTurnstile onToken={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />
          <button type="submit" disabled={ml.formState.isSubmitting} className="auth-btn">
            {ml.formState.isSubmitting ? 'Sending…' : 'Send sign-in link →'}
          </button>
        </form>
      )}

      <div className="auth-links">
        {mode === 'password' && (
          <Link href="/reset-password" className="auth-link">Forgot password?</Link>
        )}
        <Link href="/signup" className="auth-link">
          No account?{' '}
          <span className="auth-link-accent">Sign up free</span>
        </Link>
      </div>
    </div>
  )
}
