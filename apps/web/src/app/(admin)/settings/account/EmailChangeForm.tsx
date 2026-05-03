'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { changeEmailAction } from '@/actions/account.actions'

export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const fd = new FormData()
    fd.set('newEmail', newEmail)
    fd.set('password', password)
    startTransition(async () => {
      const res = await changeEmailAction(fd)
      if (res.ok) {
        setSuccess(`Confirmation link sent to ${newEmail}. The change takes effect once you click it.`)
        setNewEmail('')
        setPassword('')
      } else {
        setError(res.error ?? 'Could not change email.')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          Send confirmation link
        </Button>
      </div>
    </form>
  )
}
