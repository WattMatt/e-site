'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function InviteJoinPage() {
  const params = useParams()
  const token = params.token as string
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState<'loading' | 'form' | 'error' | 'done'>('loading')
  const [inviteData, setInviteData] = useState<{
    email: string
    orgName: string
    orgId: string
    role: string
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    async function loadInvite() {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'invite',
      })

      if (error || !data.user) {
        setErrorMsg(error?.message ?? 'Invalid or expired invite link.')
        setStep('error')
        return
      }

      const user = data.user
      const meta = user.user_metadata ?? {}

      const orgId = meta.invited_to_org
      let orgName = 'your organisation'
      if (orgId) {
        const { data: org } = await supabase
          .from('organisations')
          .select('name')
          .eq('id', orgId)
          .single()
        if (org) orgName = org.name
      }

      setInviteData({
        email: user.email ?? '',
        orgName,
        orgId: orgId ?? '',
        role: meta.invited_role ?? 'member',
      })
      setStep('form')
    }
    loadInvite()
  }, [token])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match')
      return
    }
    if (!fullName.trim()) {
      setErrorMsg('Full name is required')
      return
    }
    setErrorMsg('')

    startTransition(async () => {
      const { error: pwErr } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim() },
      })
      if (pwErr) { setErrorMsg(pwErr.message); return }

      if (inviteData?.orgId) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          try {
            await supabase
              .from('user_organisations')
              .upsert({
                user_id: user.id,
                organisation_id: inviteData.orgId,
                role: inviteData.role,
                is_active: true,
              }, { onConflict: 'user_id,organisation_id' })
          } catch {}
        }
      }

      setStep('done')

      const role = inviteData?.role ?? ''
      const isFieldWorker = ['field_worker', 'supervisor'].includes(role)
      setTimeout(() => {
        router.push(isFieldWorker ? '/snags' : '/dashboard')
      }, 1500)
    })
  }

  if (step === 'loading') {
    return (
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
          Verifying your invite…
        </p>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">❌</div>
        <h2>Invalid invite</h2>
        <p>{errorMsg}</p>
        <div className="auth-links" style={{ marginTop: 28 }}>
          <a href="/login" className="auth-link">← Go to sign in</a>
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">✅</div>
        <h2>Welcome aboard!</h2>
        <p>Redirecting you now…</p>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Join {inviteData?.orgName}</h2>
      <p className="auth-card-sub">
        You&apos;ve been invited as{' '}
        <span style={{ color: 'var(--c-amber)', textTransform: 'capitalize' }}>
          {inviteData?.role?.replace('_', ' ')}
        </span>
        . Set up your account to get started.
      </p>

      <form onSubmit={handleSubmit}>
        {errorMsg && <div className="auth-alert-error">{errorMsg}</div>}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            type="email"
            value={inviteData?.email ?? ''}
            disabled
            className="auth-input"
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          />
        </div>

        <div className="auth-field">
          <label className="auth-label">Full name</label>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            className="auth-input"
            placeholder="Your full name"
            autoComplete="name"
          />
        </div>

        <div className="auth-field">
          <label className="auth-label">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            className="auth-input"
            autoComplete="new-password"
          />
        </div>

        <div className="auth-field">
          <label className="auth-label">Confirm password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="auth-input"
            autoComplete="new-password"
          />
        </div>

        <button type="submit" disabled={isPending} className="auth-btn">
          {isPending ? 'Setting up account…' : 'Create Account & Join →'}
        </button>
      </form>
    </div>
  )
}
