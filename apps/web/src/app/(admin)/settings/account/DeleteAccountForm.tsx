'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { deleteAccountAction } from '@/actions/account.actions'

export function DeleteAccountForm({ email }: { email: string }) {
  const router = useRouter()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const emailMatches = confirmEmail.trim().toLowerCase() === email.toLowerCase()
  const canSubmit = emailMatches && password.length > 0 && !pending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const fd = new FormData()
    fd.set('confirmEmail', confirmEmail)
    fd.set('password', password)
    startTransition(async () => {
      const res = await deleteAccountAction(fd)
      if (res.ok) {
        router.replace('/account-deleted')
      } else {
        setError(res.error ?? 'Could not delete account.')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label className="ob-label" htmlFor="confirmEmail">Type your email to confirm</label>
        <input
          id="confirmEmail"
          className="ob-input"
          type="email"
          autoComplete="off"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          placeholder={email}
        />
      </div>
      <div>
        <label className="ob-label" htmlFor="password">Password</label>
        <input
          id="password"
          className="ob-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
        <Button
          type="submit"
          size="sm"
          variant="danger"
          isLoading={pending}
          disabled={!canSubmit}
        >
          Permanently delete account
        </Button>
        {!emailMatches && confirmEmail.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
            Email must match your account email exactly.
          </span>
        )}
      </div>
    </form>
  )
}
