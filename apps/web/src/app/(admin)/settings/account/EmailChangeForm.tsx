'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { changeEmailAction, confirmEmailChangeAction } from '@/actions/account.actions'

type Step = 'request' | 'confirm'

export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('request')
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onRequest(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const fd = new FormData()
    fd.set('newEmail', newEmail)
    fd.set('password', password)
    startTransition(async () => {
      const res = await changeEmailAction(fd)
      if (res.ok) {
        setStep('confirm')
        setPassword('')
      } else {
        setError(res.error ?? 'Could not start email change.')
      }
    })
  }

  function onConfirm(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const fd = new FormData()
    fd.set('newEmail', newEmail)
    fd.set('code', code)
    startTransition(async () => {
      const res = await confirmEmailChangeAction(fd)
      if (res.ok) {
        setSuccess(`Email changed to ${newEmail}.`)
        setStep('request')
        setNewEmail('')
        setCode('')
        router.refresh()
      } else {
        setError(res.error ?? 'Could not confirm email change.')
      }
    })
  }

  if (step === 'confirm') {
    return (
      <form onSubmit={onConfirm} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--c-text)', margin: 0 }}>
          We sent a 6-digit code to <strong>{newEmail}</strong>. Enter it below to
          confirm the change. The code expires in 1 hour.
        </p>
        <div>
          <label className="ob-label" htmlFor="emailChangeCode">6-digit code</label>
          <input
            id="emailChangeCode"
            className="ob-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            style={{ fontSize: 18, letterSpacing: 4, textAlign: 'center' }}
            autoFocus
          />
        </div>
        {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="submit" size="sm" isLoading={pending} disabled={code.length !== 6 || pending}>
            Confirm change
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => { setStep('request'); setCode(''); setError(null) }}
          >
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={onRequest} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label className="ob-label">Current email</label>
        <input className="ob-input" value={currentEmail} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
      </div>
      <div>
        <label className="ob-label" htmlFor="newEmail">New email</label>
        <input
          id="newEmail"
          className="ob-input"
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@company.co.za"
        />
      </div>
      <div>
        <label className="ob-label" htmlFor="emailChangePassword">Password</label>
        <input
          id="emailChangePassword"
          className="ob-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      {success && <p style={{ color: '#34d399', fontSize: 12 }}>{success}</p>}
      <div>
        <Button
          type="submit"
          size="sm"
          isLoading={pending}
          disabled={!newEmail || !password || pending}
        >
          Send code to new email
        </Button>
      </div>
    </form>
  )
}
