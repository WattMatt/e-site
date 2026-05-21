'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  acceptOrgInvitationAction,
  declineOrgInvitationAction,
} from '@/actions/invitations.actions'

interface Invitation {
  membershipId:   string
  organisationId: string
  orgName:        string
  role:           string
  invitedByName:  string | null
}

interface Props {
  invitations: Invitation[]
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError((result as { ok: false; error: string }).error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      className="data-panel-row"
      style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--c-text)', fontWeight: 600 }}>
          {invitation.orgName}
        </span>
        {' '}
        <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
          invited you to join as{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {invitation.role}
          </span>
        </span>
        {invitation.invitedByName && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            {' '}— invited by {invitation.invitedByName}
          </span>
        )}
        {error && (
          <div
            role="alert"
            style={{ fontSize: 11, color: 'var(--c-red)', marginTop: 4 }}
          >
            {error}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button
          variant="primary"
          size="sm"
          isLoading={isPending}
          disabled={isPending}
          onClick={() => run(() => acceptOrgInvitationAction({ membershipId: invitation.membershipId }))}
        >
          Accept
        </Button>
        <Button
          variant="secondary"
          size="sm"
          isLoading={isPending}
          disabled={isPending}
          onClick={() => run(() => declineOrgInvitationAction({ membershipId: invitation.membershipId }))}
        >
          Decline
        </Button>
      </div>
    </div>
  )
}

export function PendingInvitations({ invitations }: Props) {
  if (invitations.length === 0) return null

  return (
    <div className="data-panel" style={{ marginBottom: 16 }}>
      <div className="data-panel-header">
        <span className="data-panel-title">Pending invitations</span>
        <span className="badge badge-amber">{invitations.length}</span>
      </div>
      {invitations.map((inv) => (
        <InvitationRow key={inv.membershipId} invitation={inv} />
      ))}
    </div>
  )
}
