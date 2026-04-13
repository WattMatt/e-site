'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { orgService } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { Suspense } from 'react'

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
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400">Checking invite…</p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 text-center">
        <div className="text-4xl mb-4">❌</div>
        <h2 className="text-lg font-semibold text-white mb-2">Invalid invite</h2>
        <p className="text-slate-400 text-sm">{error}</p>
        <button onClick={() => router.push('/login')} className="mt-6 text-blue-400 hover:text-blue-300 text-sm">
          Go to login
        </button>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 rounded-xl p-8 border border-slate-700">
      <div className="text-center mb-6">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-white">You've been invited</h2>
        <p className="text-slate-400 text-sm mt-1">
          Join <span className="text-white font-medium">{invite?.organisation?.name}</span> as{' '}
          <span className="text-blue-400">{invite?.role?.replace(/_/g, ' ')}</span>
        </p>
      </div>

      <button
        onClick={accept}
        disabled={state === 'joining'}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
      >
        {state === 'joining' ? 'Joining…' : `Accept & Join ${invite?.organisation?.name}`}
      </button>
    </div>
  )
}

export default function JoinOrgPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">E-Site</h1>
        </div>
        <Suspense fallback={<div className="text-slate-400 text-center">Loading…</div>}>
          <JoinContent />
        </Suspense>
      </div>
    </div>
  )
}
