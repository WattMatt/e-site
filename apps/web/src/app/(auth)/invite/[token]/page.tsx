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

  // Exchange the token for invite metadata via Supabase
  useEffect(() => {
    async function loadInvite() {
      // Supabase invite tokens are exchanged via verifyOtp
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

      // Fetch org name
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
      // Update profile name and password
      const { error: pwErr } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim() },
      })
      if (pwErr) { setErrorMsg(pwErr.message); return }

      // Link to org if not already done
      if (inviteData?.orgId) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase
            .from('user_organisations')
            .upsert({
              user_id: user.id,
              organisation_id: inviteData.orgId,
              role: inviteData.role,
              is_active: true,
            }, { onConflict: 'user_id,organisation_id' })
            .catch(() => {})
        }
      }

      setStep('done')

      // Redirect based on role
      const role = inviteData?.role ?? ''
      const isFieldWorker = ['field_worker', 'supervisor'].includes(role)
      setTimeout(() => {
        router.push(isFieldWorker ? '/snags' : '/dashboard')
      }, 1500)
    })
  }

  if (step === 'loading') {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-slate-400 text-sm">Verifying your invite…</p>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="bg-slate-800 rounded-xl p-8 text-center">
        <div className="text-4xl mb-4">❌</div>
        <h2 className="text-xl font-semibold text-white mb-2">Invalid invite</h2>
        <p className="text-slate-400 text-sm mb-4">{errorMsg}</p>
        <a href="/login" className="text-blue-400 hover:text-blue-300 text-sm">Go to sign in →</a>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="bg-slate-800 rounded-xl p-8 text-center">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-xl font-semibold text-white mb-2">Welcome aboard!</h2>
        <p className="text-slate-400 text-sm">Redirecting you now…</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 rounded-xl p-8 shadow-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white mb-1">Join {inviteData?.orgName}</h2>
        <p className="text-slate-400 text-sm">
          You&apos;ve been invited as <span className="text-white capitalize">{inviteData?.role?.replace('_', ' ')}</span>.
          Set up your account to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Email</label>
          <input
            type="email"
            value={inviteData?.email ?? ''}
            disabled
            className="w-full bg-slate-900 text-slate-400 rounded-lg px-4 py-3 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Full name *</label>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your full name"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Password *</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Confirm password *</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {errorMsg && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {isPending ? 'Setting up account…' : 'Create Account & Join'}
        </button>
      </form>
    </div>
  )
}
