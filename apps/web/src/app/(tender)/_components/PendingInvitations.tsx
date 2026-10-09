'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { acceptPendingInvitationAction, type PendingInvitation } from '@/actions/tender-portal.actions'

/** Invitations to the signed-in address that still wait for Accept. No link needed. */
export function PendingInvitations({ invitations }: { invitations: PendingInvitation[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const accept = async (id: string) => {
    setBusy(id)
    setMsg(null)
    try {
      const r = await acceptPendingInvitationAction(id)
      if ('error' in r) return setMsg(r.error)
      router.push(`/tender/${r.data.tenderId}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <strong style={{ fontSize: 14 }}>Invitations waiting for you</strong>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {invitations.map((i) => (
          <li key={i.id} style={{ border: '1px solid var(--c-border, #e2e8f0)', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{i.package} — {i.title}</div>
              <div style={{ fontSize: 13 }}>
                For {i.company_name}
                {i.closing_at && ` · closes ${new Date(i.closing_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })}`}
              </div>
            </div>
            <Button isLoading={busy === i.id} disabled={!!busy} onClick={() => accept(i.id)}>Accept the invitation</Button>
          </li>
        ))}
      </ul>
      {msg && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--c-red)' }}>{msg}</p>}
    </div>
  )
}
