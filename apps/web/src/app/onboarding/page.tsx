'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createOrgSchema, type CreateOrgInput, orgService } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
  'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
]

export default function OnboardingPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'choice' | 'create' | 'join'>('choice')
  const [joinToken, setJoinToken] = useState('')
  const [joining, setJoining] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgInput>({ resolver: zodResolver(createOrgSchema) })

  async function onCreateOrg(input: CreateOrgInput) {
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    try {
      await orgService.create(supabase as any, user.id, input)
      router.push('/dashboard')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create organisation')
    }
  }

  async function onJoinOrg() {
    if (!joinToken.trim()) return
    setError(null)
    setJoining(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    try {
      await orgService.acceptInvite(supabase as any, joinToken.trim(), user.id)
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Invalid or expired invite link. Ask your team admin to resend.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-white">E-Site</h1>
          <p className="text-slate-400 mt-2">Let's get your organisation set up</p>
        </div>

        {step === 'choice' && (
          <div className="space-y-4">
            <button
              onClick={() => setStep('create')}
              className="w-full flex items-start gap-4 p-6 bg-slate-800 border-2 border-slate-700 hover:border-blue-500 rounded-xl transition-colors text-left group"
            >
              <span className="text-3xl">🏢</span>
              <div>
                <p className="font-semibold text-white text-lg group-hover:text-blue-400">Create organisation</p>
                <p className="text-slate-400 text-sm mt-1">You're the owner — set up your company and invite your team.</p>
              </div>
            </button>

            <button
              onClick={() => setStep('join')}
              className="w-full flex items-start gap-4 p-6 bg-slate-800 border-2 border-slate-700 hover:border-blue-500 rounded-xl transition-colors text-left group"
            >
              <span className="text-3xl">🔗</span>
              <div>
                <p className="font-semibold text-white text-lg group-hover:text-blue-400">Join with invite</p>
                <p className="text-slate-400 text-sm mt-1">You were invited — enter your invite code to join your team.</p>
              </div>
            </button>
          </div>
        )}

        {step === 'create' && (
          <div className="bg-slate-800 rounded-xl p-8 border border-slate-700">
            <button onClick={() => setStep('choice')} className="text-slate-400 hover:text-white text-sm mb-6 block">
              ← Back
            </button>
            <h2 className="text-xl font-bold text-white mb-6">Create your organisation</h2>

            <form onSubmit={handleSubmit(onCreateOrg)} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Company name <span className="text-red-400">*</span></label>
                <input
                  {...register('name')}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Watson Mattheus Consulting"
                  autoFocus
                />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Province</label>
                <select
                  {...register('province')}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select province…</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">CIPC registration no. <span className="text-slate-600">(optional)</span></label>
                <input
                  {...register('registrationNo')}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="2024/123456/07"
                />
              </div>

              {error && (
                <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {isSubmitting ? 'Creating…' : 'Create Organisation'}
              </button>
            </form>
          </div>
        )}

        {step === 'join' && (
          <div className="bg-slate-800 rounded-xl p-8 border border-slate-700">
            <button onClick={() => setStep('choice')} className="text-slate-400 hover:text-white text-sm mb-6 block">
              ← Back
            </button>
            <h2 className="text-xl font-bold text-white mb-2">Join with invite code</h2>
            <p className="text-slate-400 text-sm mb-6">
              Paste the invite link or token your team admin sent you.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Invite token</label>
                <input
                  value={joinToken}
                  onChange={(e) => setJoinToken(e.target.value)}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="Paste invite token here…"
                  autoFocus
                />
              </div>

              {error && (
                <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
              )}

              <button
                onClick={onJoinOrg}
                disabled={joining || !joinToken.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {joining ? 'Joining…' : 'Join Organisation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
