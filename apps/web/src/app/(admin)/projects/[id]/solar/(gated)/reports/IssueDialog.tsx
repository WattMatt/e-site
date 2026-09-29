'use client'
/** Issue (spec §9.3): two-step; freezes the snapshot + PDF + SHA-256 and returns the client link ONCE. */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { issueSolarProposalAction } from '@/actions/solar-proposals.actions'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'

export function IssueDialog({ projectId, proposalId, updatedAt, validityDays, clientContacts, emailEnabled, onIssued }: {
  projectId: string; proposalId: string; updatedAt: string; validityDays: number
  clientContacts: Array<{ userId: string; name: string; email: string }>; emailEnabled: boolean
  onIssued: (r: { link: string; emailNote: string | null; emailed: number }) => void
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { armed, arm, disarm } = useArmedConfirm()
  const validUntil = new Date(Date.now() + validityDays * 86_400_000).toISOString().slice(0, 10)

  async function issue() {
    disarm(); setBusy(true); setError(null)
    const r = await issueSolarProposalAction({ projectId, proposalId, expectedUpdatedAt: updatedAt, emailClientUserIds: chosen })
    setBusy(false)
    if ('error' in r) { setError(r.error); return }
    onIssued({ link: r.link, emailNote: r.emailNote, emailed: r.emailed })
  }

  return (
    <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--c-border)', borderRadius: 6 }}>
      <p style={{ fontSize: 12, margin: 0 }}>{`Issuing freezes this version: the figures, the PDF and its SHA-256 can no longer change. The client link expires on ${validUntil}.`}</p>
      {clientContacts.length === 0
        ? <p style={{ fontSize: 12, margin: 0 }}>No client contacts on this project — copy the link after issuing, or add a client viewer to email it.</p>
        : clientContacts.map((c) => (
          <label key={c.userId} style={{ fontSize: 12 }}>
            <input type="checkbox" aria-label={`Email ${c.name} (${c.email})`} disabled={!emailEnabled} checked={chosen.includes(c.userId)}
              onChange={(e) => setChosen((x) => (e.target.checked ? [...x, c.userId] : x.filter((y) => y !== c.userId)))} />
            {` Email ${c.name} (${c.email})`}
          </label>
        ))}
      {!emailEnabled && clientContacts.length > 0 && <p style={{ fontSize: 12, margin: 0 }}>Solar emails are off for this project — turn them on under Project settings, Integrations.</p>}
      <div>
        {armed
          ? <Button type="button" size="sm" variant="danger" disabled={busy} onClick={issue}>Confirm issue</Button>
          : <Button type="button" size="sm" disabled={busy} onClick={arm}>{busy ? 'Issuing…' : 'Issue proposal'}</Button>}
      </div>
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)', margin: 0 }}>{error}</p>}
    </div>
  )
}
