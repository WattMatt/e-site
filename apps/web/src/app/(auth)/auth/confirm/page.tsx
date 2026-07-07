import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { isValidOtpType } from '@/lib/auth/otp-types'

// Same convention as the other (auth) pages — always per-request.
export const dynamic = 'force-dynamic'

/**
 * Single-use-link interstitial. Emailed token_hash links land here (via the
 * GET /auth/callback hand-off) WITHOUT the token being verified — mail
 * scanners prefetch every GET in an email, and verifying on GET let them burn
 * the single-use token before the recipient clicked (the 2026-07-07 invite
 * incident's residual failure mode). The button below POSTs the token to
 * /auth/callback, which is the only place verifyOtp runs; scanners follow
 * GETs but don't submit forms.
 */

const COPY: Record<EmailOtpType, { title: string; sub: string; button: string }> = {
  recovery: {
    title:  'Set your password',
    sub:    'Continue to choose a new password for your E-Site account.',
    button: 'Set my password →',
  },
  invite: {
    title:  'Accept your invite',
    sub:    'Continue to activate your E-Site account.',
    button: 'Accept invite →',
  },
  magiclink: {
    title:  'Sign in to E-Site',
    sub:    'Continue to finish signing in with your email link.',
    button: 'Sign in →',
  },
  signup: {
    title:  'Confirm your email',
    sub:    'Continue to verify your email address and activate your account.',
    button: 'Confirm my email →',
  },
  email_change: {
    title:  'Confirm your new email',
    sub:    'Continue to apply the email change on your E-Site account.',
    button: 'Confirm email change →',
  },
  email: {
    title:  'Confirm your email',
    sub:    'Continue to verify your email address.',
    button: 'Confirm my email →',
  },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AuthConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const tokenHash = first(params.token_hash)
  const type = first(params.type)
  const next = first(params.next) ?? '/dashboard'
  const from = first(params.from)
  const email = first(params.email)

  if (!tokenHash || !type || !isValidOtpType(type)) {
    redirect('/login?error=auth_callback_failed')
  }
  const copy = COPY[type as EmailOtpType]

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">{copy.title}</h2>
      <p className="auth-card-sub">{copy.sub}</p>

      <form method="post" action="/auth/callback">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        {from && <input type="hidden" name="from" value={from} />}
        {email && <input type="hidden" name="email" value={email} />}
        <button type="submit" className="auth-btn">{copy.button}</button>
      </form>

      <p style={{ fontSize: 12, color: 'var(--c-text-dim)', lineHeight: 1.6, marginTop: 16 }}>
        Your link can only be used once — this extra step stops email security
        scanners from using it before you do.
      </p>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
