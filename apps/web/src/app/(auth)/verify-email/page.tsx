'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// Disable prerender — this page calls createClient() at component-eval which
// requires NEXT_PUBLIC_SUPABASE_* env vars. Those aren't set during the
// static-export step on the CI build host (only on Vercel runtime), so
// prerendering throws "@supabase/ssr: Your project's URL and API key are
// required". The page is per-user / behind auth anyway — nothing to
// statically pre-render.
export const dynamic = 'force-dynamic'

/**
 * UNREACHABLE IN PRODUCTION TODAY, deliberately kept.
 *
 * Middleware step 3 routes here only when `user && !user.email_confirmed_at`.
 * GoTrue's `mailer_autoconfirm` is TRUE, so every account is confirmed inside
 * a few milliseconds of creation: 36 of 36 users have `email_confirmed_at`,
 * 0 of 36 have `confirmation_sent_at`. Nobody has ever landed here.
 *
 * That is exactly why the copy mattered. It asserted "We sent a confirmation
 * link… Click it to activate your account" — the same false promise the signup
 * success card made, on a page that only exists in the configuration where
 * autoconfirm is OFF, a path GoTrue's `signup` branch has never once executed.
 * The wording below states what is actually known (the address is unconfirmed)
 * and points at the Resend control instead of at an email that may not exist.
 */

const POLL_MS = 4000

export default function VerifyEmailPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        router.replace('/login')
        return
      }
      setEmail(user.email ?? null)
      if (user.email_confirmed_at) {
        router.replace('/dashboard')
      }
    }

    void check()
    const interval = setInterval(check, POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [supabase, router])

  async function resend() {
    if (!email) return
    setResending(true)
    setResendError(null)
    setResent(false)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    })
    setResending(false)
    if (error) setResendError(error.message)
    else setResent(true)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Verify your email</h2>
      <p className="auth-card-sub">
        <strong>{email ?? 'Your email address'}</strong> hasn&apos;t been confirmed
        yet. If a confirmation email is waiting for you, open it and follow the
        link — otherwise send yourself a fresh one below. We&apos;ll forward you
        automatically the moment it&apos;s confirmed.
      </p>

      <div className="auth-field" style={{ marginTop: 18 }}>
        {resendError && <div className="auth-alert-error">{resendError}</div>}
        {resent && (
          <div className="auth-alert-error" style={{ background: 'var(--c-green-dim)', borderColor: 'var(--c-green)', color: 'var(--c-green)' }}>
            Email re-sent. Check your inbox (and spam folder).
          </div>
        )}
        <button type="button" onClick={resend} disabled={resending || !email} className="auth-btn">
          {resending ? 'Sending…' : 'Resend confirmation email'}
        </button>
      </div>

      <div className="auth-links">
        <button
          type="button"
          onClick={signOut}
          className="auth-link"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Sign out
        </button>
        <Link href="mailto:arno@watsonmattheus.com" className="auth-link">
          Need help? <span className="auth-link-accent">Contact support</span>
        </Link>
      </div>
    </div>
  )
}
