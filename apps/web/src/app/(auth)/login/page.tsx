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

const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
})
type MagicLinkInput = z.infer<typeof magicLinkSchema>

type Mode = 'password' | 'magic-link'

export default function LoginPage() {
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('password')
  const [serverError, setServerError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
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
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=/dashboard&from=magic_link`
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: false,  // magic-link is for existing accounts only
        ...(captchaToken ? { captchaToken } : {}),
      },
    })
    if (error) { setServerError(error.message); return }
    void recordAuthEventAction('magic_link_requested', { email_domain: email.split('@')[1] ?? null })
      .catch(() => {})
    setMagicLinkSent(true)
  }

  if (magicLinkSent) {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">📬</div>
        <h2>Check your inbox</h2>
        <p>If an account exists for that email, we sent a sign-in link. The link expires in 1 hour.</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <button
            type="button"
            onClick={() => { setMagicLinkSent(false); setMode('password') }}
            className="auth-link"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Welcome back</h2>
      <p className="auth-card-sub">Sign in to your E-Site workspace</p>

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
