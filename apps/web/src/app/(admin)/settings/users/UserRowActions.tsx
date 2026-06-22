'use client'

/**
 * UserRowActions — per-member inline controls: change role, deactivate /
 * reactivate, remove. Rendered for every member row except those the caller
 * may not edit (their own row, or an owner row when the caller is not owner).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/FormField'
import { Button } from '@/components/ui/Button'
import { ORG_ROLES, ORG_ROLE_LABELS, type OrgRole } from '@esite/shared'
import { updateUserAction, removeUserAction, resendInviteAction } from '@/actions/users.actions'

interface Props {
  userId:     string
  role:       string
  isActive:   boolean
  isPending:  boolean
  isSelf:     boolean
  callerRole: OrgRole
}

export function UserRowActions({ userId, role, isActive, isPending: isPendingMember, isSelf, callerRole }: Props) {
  const router = useRouter()
  const [roleVal, setRoleVal] = useState(role)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Cannot edit your own row (self-lockout guard); a non-owner cannot touch an
  // owner row. Locked rows render a spacer so the column stays aligned.
  const locked = isSelf || (role === 'owner' && callerRole !== 'owner')
  if (locked) return <div style={{ width: 280, flexShrink: 0 }} />

  // The owner role is offered only to an owner.
  const roleOptions = ORG_ROLES.filter((r) => r !== 'owner' || callerRole === 'owner')

  function changeRole(next: string) {
    if (next === roleVal) return
    const prev = roleVal
    setRoleVal(next)
    setError(null)
    startTransition(async () => {
      const result = await updateUserAction({ userId, role: next })
      if (!result.ok) {
        setError(result.error)
        setRoleVal(prev)
        return
      }
      router.refresh()
    })
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong.')
        return
      }
      setConfirmRemove(false)
      router.refresh()
    })
  }

  function resend() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await resendInviteAction({ userId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice('Invite re-sent.')
    })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      flexWrap: 'wrap', justifyContent: 'flex-end', width: 280,
    }}>
      <Select
        aria-label="Change role"
        value={roleVal}
        disabled={isPending}
        onChange={(e) => changeRole(e.target.value)}
        style={{ padding: '5px 8px', fontSize: 12 }}
      >
        {roleOptions.map((r) => (
          <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
        ))}
      </Select>

      {isPendingMember && isActive && (
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={resend}
        >
          Resend invite
        </Button>
      )}

      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() => run(() => updateUserAction({ userId, isActive: !isActive }))}
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </Button>

      {confirmRemove ? (
        <Button
          variant="danger"
          size="sm"
          disabled={isPending}
          onClick={() => run(() => removeUserAction({ userId }))}
        >
          Confirm remove
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => setConfirmRemove(true)}
        >
          Remove
        </Button>
      )}

      {error && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)', width: '100%', textAlign: 'right' }}>
          {error}
        </span>
      )}

      {notice && (
        <span role="status" style={{ fontSize: 11, color: 'var(--c-green)', width: '100%', textAlign: 'right' }}>
          {notice}
        </span>
      )}
    </div>
  )
}
