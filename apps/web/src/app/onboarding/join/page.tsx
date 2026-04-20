'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { orgService } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

function JoinContent() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'loading' | 'preview' | 'joining' | 'error'>('loading')
  const [invite, setInvite] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setState('error'); setError('No invite token provided.'); return }
    const supabase = createClient()
    orgService.getInviteByToken(supabase as any, token)
      .then((inv) => { setInvite(inv); setState('preview') })
      .catch(() => { setState('error'); setError('This invite link is invalid or has expired.') })
  }, [token])

  async function accept() {
    setState('joining')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push(`/signup?next=/onboarding/join?token=${token}`); return }

    try {
      await orgService.acceptInvite(supabase as any, token, user.id)
      router.push('/dashboard')
      router.refresh()
    } catch {
      setState('error')
      setError('Failed to accept invite. It may have already been used.')
    }
  }

  if (state === 'loading') {
    return (
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
          Checking invite…
        </p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">❌</div>
        <h2>Invalid invite</h2>
        <p>{error}</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <button
            onClick={() => router.push('/login')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--c-amber)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            ← Go to login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
        <h2 className="auth-card-title" style={{ marginBottom: 4 }}>You&apos;ve been invited</h2>
        <p className="auth-card-sub">
          Join{' '}
          <span style={{ color: 'var(--c-text)', fontWeight: 600 }}>{invite?.organisation?.name}</span>{' '}
          as{' '}
          <span style={{ color: 'var(--c-amber)', textTransform: 'capitalize' }}>
            {invite?.role?.replace(/_/g, ' ')}
          </span>
        </p>
      </div>

      <button
        onClick={accept}
        disabled={state === 'joining'}
        className="auth-btn"
      >
        {state === 'joining' ? 'Joining…' : `Accept & Join ${invite?.organisation?.name}`}
      </button>
    </div>
  )
}

export default function JoinOrgPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--c-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-amber)', letterSpacing: '0.02em' }}>
            E-Site
          </h1>
        </div>
        <Suspense
          fallback={
            <p style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              Loading…
            </p>
          }
        >
          <JoinContent />
        </Suspense>
      </div>
    </div>
  )
}
