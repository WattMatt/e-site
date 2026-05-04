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
        We sent a confirmation link to <strong>{email ?? 'your email'}</strong>. Click
        it to activate your account. We&apos;ll forward you automatically once
        confirmed.
      </p>

      <div className="auth-field" style={{ marginTop: 18 }}>
        {resendError && <div className="auth-alert-error">{resendError}</div>}
        {resent && (
          <div className="auth-alert-error" style={{ background: 'rgba(52, 211, 153, 0.08)', borderColor: '#34d399', color: '#34d399' }}>
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
