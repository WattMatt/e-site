'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createOrganisationAction,
  createFirstProjectAction,
} from '@/actions/onboarding.actions'

type Step = 'org' | 'project' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'org',     label: 'Organisation' },
  { key: 'project', label: 'First Project' },
  { key: 'done',    label: 'Done' },
]

function LogoMark() {
  return (
    <div className="onboarding-brand-mark">
      <svg viewBox="0 0 20 20" fill="none" width="20" height="20">
        <path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="#0D0B09" />
      </svg>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('org')
  const [orgId, setOrgId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const stepIndex = STEPS.findIndex(s => s.key === step)

  function handleOrgSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createOrganisationAction(fd)
      if ('error' in result) { setError(result.error ?? null); return }
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
      if ('error' in result) { setError(result.error ?? null); return }
      setProjectId(result.projectId!)
      setStep('done')
    })
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-container">
        {/* Brand */}
        <div className="onboarding-brand">
          <LogoMark />
          <div className="onboarding-brand-name">E-Site</div>
          <div className="onboarding-brand-sub">Construction Management · South Africa</div>
        </div>

        {/* Step track */}
        <div className="step-track">
          {STEPS.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
              <div className="step-node">
                <div className={`step-circle${i < stepIndex ? ' done' : i === stepIndex ? ' current' : ''}`}>
                  {i < stepIndex ? '✓' : i + 1}
                </div>
                <span className={`step-label${i === stepIndex ? ' current' : ''}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`step-connector${i < stepIndex ? ' done' : ''}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="onboarding-card animate-fadeup">
          {error && <div className="ob-error">{error}</div>}

          {/* Step 1: Organisation */}
          {step === 'org' && (
            <form onSubmit={handleOrgSubmit}>
              <div className="onboarding-card-title">Create your organisation</div>
              <div className="onboarding-card-sub">This will be your company workspace on E-Site</div>

              <div className="ob-field">
                <label className="ob-label">Company name <span style={{ color: 'var(--c-amber)' }}>*</span></label>
                <input name="name" required className="ob-input" placeholder="Acme Electrical (Pty) Ltd" />
              </div>

              <div className="ob-field">
                <label className="ob-label">Organisation type</label>
                <select name="orgType" className="ob-select">
                  <option value="contractor">Main Contractor</option>
                  <option value="subcontractor">Sub-Contractor</option>
                  <option value="developer">Developer</option>
                  <option value="consulting">Consulting Engineer</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <button type="submit" disabled={isPending} className="ob-btn-primary" style={{ marginTop: 8 }}>
                {isPending ? 'Creating…' : 'Continue →'}
              </button>
            </form>
          )}

          {/* Step 2: First project */}
          {step === 'project' && (
            <form onSubmit={handleProjectSubmit}>
              <div className="onboarding-card-title">Add your first project</div>
              <div className="onboarding-card-sub">You can add more projects any time from the dashboard</div>

              <div className="ob-field">
                <label className="ob-label">Project name <span style={{ color: 'var(--c-amber)' }}>*</span></label>
                <input name="name" required className="ob-input" placeholder="Rosebank Residential Phase 1" />
              </div>

              <div className="ob-field">
                <label className="ob-label">Site address</label>
                <input name="address" className="ob-input" placeholder="12 Builder St" />
              </div>

              <div className="ob-field">
                <label className="ob-label">City</label>
                <input name="city" className="ob-input" placeholder="Johannesburg" />
              </div>

              <div className="ob-field" style={{ marginBottom: 24 }}>
                <label className="ob-label">Client name</label>
                <input name="clientName" className="ob-input" placeholder="Smith Family Trust" />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setStep('done')}
                  className="ob-btn-secondary"
                >
                  Skip
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="ob-btn-primary"
                  style={{ flex: 2 }}
                >
                  {isPending ? 'Creating…' : 'Continue →'}
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Done */}
          {step === 'done' && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{
                  width: 52, height: 52,
                  background: 'var(--c-green-dim)',
                  border: '1px solid #1a5c3a',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="var(--c-green)" strokeWidth="2.5" width="22" height="22">
                    <polyline points="3,10 8,15 17,5" />
                  </svg>
                </div>
                <div className="onboarding-card-title">You&apos;re all set!</div>
                <div className="onboarding-card-sub" style={{ marginBottom: 0 }}>Here&apos;s what to do next</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {[
                  { label: 'Set up compliance sites', href: '/compliance/new', icon: '📋', done: false },
                  { label: 'Upload your first COC',   href: '/compliance',     icon: '📄', done: false },
                  { label: 'Log a snag on site',      href: '/snags',          icon: '⚠', done: false },
                  ...(projectId
                    ? [{ label: 'View your project', href: `/projects/${projectId}`, icon: '📁', done: true }]
                    : []),
                ].map(({ label, href, icon, done }) => (
                  <a key={label} href={href} className={`checklist-item${done ? ' done' : ''}`}>
                    <div className="checklist-icon">
                      {done
                        ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="2,8 6,12 14,4" /></svg>
                        : <span style={{ fontSize: 14 }}>{icon}</span>
                      }
                    </div>
                    <span>{label}</span>
                    {!done && (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14" style={{ marginLeft: 'auto', color: 'var(--c-text-dim)' }}>
                        <path d="M6 4l4 4-4 4" />
                      </svg>
                    )}
                  </a>
                ))}
              </div>

              <button onClick={() => router.push('/dashboard')} className="ob-btn-primary">
                Go to Dashboard →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
