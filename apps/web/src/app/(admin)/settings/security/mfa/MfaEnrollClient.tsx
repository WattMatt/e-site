'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  enrollTotpAction,
  verifyEnrollAction,
  unenrollAction,
} from '@/actions/mfa.actions'

interface VerifiedFactor {
  id:           string
  friendlyName: string
  createdAt:    string
}

type EnrollState =
  | { phase: 'idle' }
  | { phase: 'enrolling' }
  | { phase: 'enrolled'; factorId: string; qrCode: string; secret: string }
  | { phase: 'done' }

export function MfaEnrollClient({ verifiedFactors }: { verifiedFactors: VerifiedFactor[] }) {
  const router = useRouter()
  const [state, setState] = useState<EnrollState>({ phase: 'idle' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function startEnroll() {
    setError(null)
    setState({ phase: 'enrolling' })
    const r = await enrollTotpAction()
    if (r.factorId && r.qrCode && r.secret) {
      setState({ phase: 'enrolled', factorId: r.factorId, qrCode: r.qrCode, secret: r.secret })
    } else {
      setError(r.error ?? 'Could not start enrollment.')
      setState({ phase: 'idle' })
    }
  }

  function confirmEnroll() {
    if (state.phase !== 'enrolled') return
    setError(null)
    const fd = new FormData()
    fd.set('factorId', state.factorId)
    fd.set('code', code)
    startTransition(async () => {
      const r = await verifyEnrollAction(fd)
      if (r.ok) {
        setState({ phase: 'done' })
        setCode('')
        router.refresh()
      } else {
        setError(r.error ?? 'Verification failed.')
      }
    })
  }

  function unenroll(factorId: string) {
    const pw = prompt('Enter your password to disable two-factor authentication:')
    if (!pw) return
    setError(null)
    startTransition(async () => {
      const r = await unenrollAction(factorId, pw)
      if (r.ok) router.refresh()
      else setError(r.error ?? 'Could not disable two-factor authentication.')
    })
  }

  if (verifiedFactors.length > 0) {
    return (
      <div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {verifiedFactors.map((f) => (
            <li
              key={f.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px',
                border: '1px solid var(--c-border)', borderRadius: 6,
                background: 'var(--c-green-dim)',
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: 'var(--c-text)', fontWeight: 600 }}>{f.friendlyName}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                  Enrolled {new Date(f.createdAt).toLocaleDateString()}
                </div>
              </div>
              <Button type="button" size="sm" variant="danger" onClick={() => unenroll(f.id)} isLoading={pending}>
                Disable
              </Button>
            </li>
          ))}
        </ul>
        {error && <p style={{ color: 'var(--c-red)', fontSize: 12, marginTop: 12 }}>{error}</p>}
      </div>
    )
  }

  if (state.phase === 'enrolled') {
    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 10 }}>
          1. Open your authenticator app and scan the QR code below.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          {state.qrCode.startsWith('data:image/svg+xml') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.qrCode} alt="TOTP QR code" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 6 }} />
          ) : (
            <p style={{ fontSize: 12, color: 'var(--c-red)' }}>
              QR code unavailable. Use the manual code below.
            </p>
          )}
        </div>
        <details style={{ marginBottom: 14 }}>
          <summary style={{ fontSize: 12, color: 'var(--c-text-dim)', cursor: 'pointer' }}>
            Can&apos;t scan? Enter this code manually.
          </summary>
          <code style={{ display: 'block', fontSize: 12, padding: 10, background: 'var(--c-panel)', borderRadius: 4, marginTop: 6, wordBreak: 'break-all' }}>
            {state.secret}
          </code>
        </details>
        <p style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 10 }}>
          2. Enter the 6-digit code shown in your app:
        </p>
        <input
          className="ob-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          style={{ marginBottom: 10, fontSize: 18, letterSpacing: 4, textAlign: 'center' }}
        />
        {error && <p style={{ color: 'var(--c-red)', fontSize: 12, marginBottom: 10 }}>{error}</p>}
        <Button type="button" size="sm" onClick={confirmEnroll} isLoading={pending} disabled={code.length !== 6}>
          Confirm and enable
        </Button>
      </div>
    )
  }

  return (
    <div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12, marginBottom: 10 }}>{error}</p>}
      <Button type="button" size="sm" onClick={startEnroll} isLoading={state.phase === 'enrolling'}>
        Enable two-factor authentication
      </Button>
    </div>
  )
}
