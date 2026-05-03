'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOOGLE_PROVIDER_ENABLED =
  process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true'

/**
 * Google OAuth sign-in button. Hidden when
 * NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED is not 'true' so the auth pages
 * don't show a broken affordance during the rollout window
 * (Cloudflare Turnstile follows the same pattern).
 */
export function GoogleSignInButton({ next = '/dashboard' }: { next?: string }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!GOOGLE_PROVIDER_ENABLED) return null

  async function onClick() {
    setError(null)
    setLoading(true)
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}&from=oauth_google`
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (oauthErr) {
      setError(oauthErr.message)
      setLoading(false)
    }
    // On success the browser is already redirected to Google's consent screen.
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {error && <div className="auth-alert-error" style={{ marginBottom: 10 }}>{error}</div>}
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '11px 14px',
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          cursor: loading ? 'wait' : 'pointer',
          color: 'var(--c-text)',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          transition: 'border-color 0.12s, background 0.12s',
          opacity: loading ? 0.6 : 1,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
      </div>
    </div>
  )
}
