'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createOrganisationAction,
  createFirstProjectAction,
  inviteTeamMemberAction,
} from '@/actions/onboarding.actions'

type Step = 'org' | 'project' | 'invite' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'org', label: 'Organisation' },
  { key: 'project', label: 'First Project' },
  { key: 'invite', label: 'Invite Team' },
  { key: 'done', label: 'Done' },
]

const INPUT_CLS = 'w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-500'
const LABEL_CLS = 'block text-sm text-slate-400 mb-1'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('org')
  const [orgId, setOrgId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [invites, setInvites] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  const stepIndex = STEPS.findIndex(s => s.key === step)

  function handleOrgSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createOrganisationAction(fd)
      if ('error' in result) { setError(result.error); return }
      setOrgId(result.organisationId!)
      setStep('project')
    })
  }

  function handleProjectSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createFirstProjectAction(orgId, fd)
      if ('error' in result) { setError(result.error); return }
      setProjectId(result.projectId!)
      setStep('invite')
    })
  }

  function handleInviteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const email = fd.get('email') as string
    startTransition(async () => {
      const result = await inviteTeamMemberAction(orgId, fd)
      if ('error' in result) { setError(result.error); return }
      setInvites(prev => [...prev, email])
      ;(e.target as HTMLFormElement).reset()
    })
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-white">E-Site</span>
          <p className="text-slate-400 text-sm mt-1">Let&apos;s get you set up</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs font-medium ${
                i < stepIndex ? 'text-green-400' :
                i === stepIndex ? 'text-white' : 'text-slate-600'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${
                  i < stepIndex ? 'bg-green-500/20 border-green-700 text-green-400' :
                  i === stepIndex ? 'bg-blue-600 border-blue-500 text-white' :
                  'bg-slate-800 border-slate-700 text-slate-600'
                }`}>
                  {i < stepIndex ? '✓' : i + 1}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-px ${i < stepIndex ? 'bg-green-700' : 'bg-slate-700'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-slate-800 rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm mb-6">
              {error}
            </div>
          )}

          {/* Step 1: Organisation */}
          {step === 'org' && (
            <form onSubmit={handleOrgSubmit} className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">Create your organisation</h2>
                <p className="text-slate-400 text-sm">This will be your company workspace on E-Site.</p>
              </div>

              <div>
                <label className={LABEL_CLS}>Company name *</label>
                <input name="name" required className={INPUT_CLS} placeholder="Acme Construction (Pty) Ltd" />
              </div>

              <div>
                <label className={LABEL_CLS}>Organisation type</label>
                <select name="orgType" className={INPUT_CLS}>
                  <option value="contractor">Main Contractor</option>
                  <option value="subcontractor">Sub-Contractor</option>
                  <option value="developer">Developer</option>
                  <option value="consulting">Consulting Engineer</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className={LABEL_CLS}>CIPC registration number</label>
                <input name="registrationNumber" className={INPUT_CLS} placeholder="2020/123456/07" />
              </div>

              <div>
                <label className={LABEL_CLS}>VAT number (optional)</label>
                <input name="vatNumber" className={INPUT_CLS} placeholder="4123456789" />
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {isPending ? 'Creating…' : 'Continue →'}
              </button>
            </form>
          )}

          {/* Step 2: First project */}
          {step === 'project' && (
            <form onSubmit={handleProjectSubmit} className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">Add your first project</h2>
                <p className="text-slate-400 text-sm">You can add more projects any time from the dashboard.</p>
              </div>

              <div>
                <label className={LABEL_CLS}>Project name *</label>
                <input name="name" required className={INPUT_CLS} placeholder="Rosebank Residential Phase 1" />
              </div>

              <div>
                <label className={LABEL_CLS}>Site address</label>
                <input name="address" className={INPUT_CLS} placeholder="12 Builder St" />
              </div>

              <div>
                <label className={LABEL_CLS}>City</label>
                <input name="city" className={INPUT_CLS} placeholder="Johannesburg" />
              </div>

              <div>
                <label className={LABEL_CLS}>Client name</label>
                <input name="clientName" className={INPUT_CLS} placeholder="Smith Family Trust" />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('invite')}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-3 rounded-xl transition-colors text-sm"
                >
                  Skip for now
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-[2] bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  {isPending ? 'Creating…' : 'Continue →'}
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Invite team */}
          {step === 'invite' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">Invite your team</h2>
                <p className="text-slate-400 text-sm">Add project managers, site supervisors, or field workers.</p>
              </div>

              <form onSubmit={handleInviteSubmit} className="space-y-3">
                <div className="flex gap-2">
                  <input
                    name="email"
                    type="email"
                    className={`${INPUT_CLS} flex-1`}
                    placeholder="colleague@company.co.za"
                  />
                  <select name="role" className="bg-slate-700 text-white rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                    <option value="project_manager">PM</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="field_worker">Field Worker</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-4 rounded-xl transition-colors text-sm whitespace-nowrap"
                  >
                    {isPending ? '…' : 'Invite'}
                  </button>
                </div>
              </form>

              {invites.length > 0 && (
                <div className="space-y-1.5">
                  {invites.map(email => (
                    <div key={email} className="flex items-center gap-2 text-sm text-slate-400 bg-slate-900/60 rounded-lg px-3 py-2">
                      <span className="text-green-400">✓</span>
                      <span>{email}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('done')}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-3 rounded-xl transition-colors text-sm"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => setStep('done')}
                  className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Done + guided checklist */}
          {step === 'done' && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-5xl mb-3">🎉</div>
                <h2 className="text-xl font-semibold text-white mb-1">You&apos;re all set!</h2>
                <p className="text-slate-400 text-sm">Here&apos;s what to do next.</p>
              </div>

              <div className="space-y-2">
                {[
                  { label: 'Set up compliance sites', href: '/compliance/new', icon: '📋', done: false },
                  { label: 'Upload your first COC', href: '/compliance', icon: '📄', done: false },
                  { label: 'Log a snag on site', href: '/snags', icon: '⚠️', done: false },
                  ...(projectId ? [{ label: 'View your project', href: `/projects/${projectId}`, icon: '📁', done: true }] : []),
                  ...(invites.length > 0 ? [{ label: `${invites.length} invite${invites.length > 1 ? 's' : ''} sent`, href: '#', icon: '👥', done: true }] : []),
                ].map(({ label, href, icon, done }) => (
                  <a
                    key={label}
                    href={href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                      done
                        ? 'bg-green-950/30 border-green-900 text-green-300'
                        : 'bg-slate-900 border-slate-700 hover:border-slate-500 text-white'
                    }`}
                  >
                    <span className="text-xl">{done ? '✓' : icon}</span>
                    <span className="text-sm font-medium">{label}</span>
                  </a>
                ))}
              </div>

              <button
                onClick={() => router.push('/dashboard')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
