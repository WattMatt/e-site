'use client'
/** Proposals (spec §9.3): list, New, draft editor, Preview, Issue, Withdraw, Revise, New link, acceptance record. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSignature } from 'lucide-react'
import { PROPOSAL_STATUS_LABELS } from '@esite/shared/solar-reports'
import type { ProposalListItem } from '@/lib/solar/reports/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  createSolarProposalAction, deleteSolarProposalDraftAction, newSolarProposalLinkAction, reviseSolarProposalAction, withdrawSolarProposalAction,
} from '@/actions/solar-proposals.actions'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'
import { ProposalEditor } from './ProposalEditor'
import { IssueDialog } from './IssueDialog'
import { AcceptanceRecord } from './AcceptanceRecord'

type Selected = { ok: true; caseId: string; caseName: string; runId: string } | { ok: false; stale: boolean; reason: string }
interface Props {
  projectId: string; proposals: ProposalListItem[]; selected: Selected
  clientContacts: Array<{ userId: string; name: string; email: string }>
  narrative: { available: boolean; reason: string | null }; emailEnabled: boolean
}

function LinkOnce({ link, note }: { link: string; note: string | null }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'grid', gap: 4, padding: 8, background: 'var(--c-amber-dim)', borderRadius: 6 }}>
      <label style={{ fontSize: 12 }}>Client link
        <input aria-label="Client link" readOnly value={link} style={{ width: '100%' }} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button type="button" size="sm" variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(link); setCopied(true) }}>{copied ? 'Copied' : 'Copy link'}</Button>
        <span style={{ fontSize: 12 }}>This link is shown once. Keep it; use New link to replace it (the old one stops working).</span>
      </div>
      {note && <p style={{ fontSize: 12, margin: 0 }}>{note}</p>}
    </div>
  )
}

function Row({ p, props }: { p: ProposalListItem; props: Props }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(p.updatedAt)
  const [link, setLink] = useState<{ link: string; note: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const del = useArmedConfirm(), wd = useArmedConfirm(), rot = useArmedConfirm()
  // Preview renders from the selected case now; a stale or missing case would 500 or mislead.
  const previewBlocked = props.selected.ok ? null : props.selected.reason
  const run = async (f: () => Promise<{ error?: string } | Record<string, unknown>>) => {
    setBusy(true); setError(null)
    const r = await f()
    setBusy(false)
    if (r && 'error' in r && r.error) { setError(String(r.error)); return false }
    router.refresh()
    return true
  }
  const c = p.controls
  return (
    <li style={{ borderTop: '1px solid var(--c-border)', padding: '8px 0', listStyle: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{`v${p.version}`}</strong>
        <span className="badge">{PROPOSAL_STATUS_LABELS[p.effectiveStatus]}</span>
        {p.offerExclVat && <span style={{ fontSize: 12 }}>{`${p.offerExclVat} excl. VAT`}</span>}
        {p.issuedAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`issued ${p.issuedAt.slice(0, 10)}`}</span>}
        {p.expiresAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`valid until ${p.expiresAt.slice(0, 10)}`}</span>}
        <span style={{ flex: 1 }} />
        {c.canEdit && <Button type="button" size="sm" variant="secondary" aria-label={`Edit draft v${p.version}`} onClick={() => setEditing((x) => !x)}>{editing ? 'Close editor' : 'Edit'}</Button>}
        {c.canIssue && (previewBlocked
          ? <Button type="button" size="sm" variant="ghost" disabled title={previewBlocked}>Preview PDF</Button>
          : <a href={`/api/projects/${props.projectId}/solar/proposals/${p.id}/preview`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Preview PDF</a>)}
        {c.canIssue && <Button type="button" size="sm" aria-label={`Issue v${p.version}`} onClick={() => setIssuing((x) => !x)}>Issue</Button>}
        {!c.canIssue && c.issueBlockedReason && <Button type="button" size="sm" aria-label={`Issue v${p.version}`} disabled title={c.issueBlockedReason}>Issue</Button>}
        {c.canDelete && (del.armed
          ? <Button type="button" size="sm" variant="danger" aria-label={`Confirm delete draft v${p.version}`} disabled={busy} onClick={() => { del.disarm(); void run(() => deleteSolarProposalDraftAction({ projectId: props.projectId, proposalId: p.id })) }}>Confirm delete</Button>
          : <Button type="button" size="sm" variant="ghost" aria-label={`Delete draft v${p.version}`} onClick={del.arm}>Delete</Button>)}
        {c.canWithdraw && (wd.armed
          ? <Button type="button" size="sm" variant="danger" aria-label={`Confirm withdraw v${p.version}`} disabled={busy} onClick={() => { wd.disarm(); void run(() => withdrawSolarProposalAction({ projectId: props.projectId, proposalId: p.id })) }}>Confirm withdraw</Button>
          : <Button type="button" size="sm" variant="secondary" aria-label={`Withdraw v${p.version}`} onClick={wd.arm}>Withdraw</Button>)}
        {c.canRotate && (rot.armed
          ? <Button type="button" size="sm" variant="danger" aria-label={`Confirm new link for v${p.version}`} disabled={busy}
              onClick={async () => { rot.disarm(); setBusy(true); const r = await newSolarProposalLinkAction({ projectId: props.projectId, proposalId: p.id }); setBusy(false); if ('error' in r) setError(r.error); else setLink({ link: r.link, note: null }) }}>Confirm new link — the old link stops working</Button>
          : <Button type="button" size="sm" variant="secondary" aria-label={`New link for v${p.version}`} disabled={busy} onClick={rot.arm}>New link</Button>)}
        {c.canRevise && <Button type="button" size="sm" variant="secondary" aria-label={`Revise v${p.version}`} disabled={busy} onClick={() => void run(() => reviseSolarProposalAction({ projectId: props.projectId, proposalId: p.id }))}>Revise</Button>}
      </div>
      {!c.canIssue && c.issueBlockedReason && <p style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--c-text-dim)' }}>{c.issueBlockedReason}</p>}
      {editing && <ProposalEditor projectId={props.projectId} proposalId={p.id} version={p.version} initial={p.draft} updatedAt={updatedAt} narrative={props.narrative} onSaved={setUpdatedAt} />}
      {issuing && !link && (
        <IssueDialog projectId={props.projectId} proposalId={p.id} updatedAt={updatedAt} validityDays={p.draft.validityDays}
          clientContacts={props.clientContacts} emailEnabled={props.emailEnabled}
          onIssued={(r) => { setLink({ link: r.link, note: r.emailNote }); router.refresh() }} />
      )}
      {link && <LinkOnce link={link.link} note={link.note} />}
      <AcceptanceRecord version={p.version} events={p.events} />
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
    </li>
  )
}

export function ProposalsPanel(props: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = props.selected.ok ? null : props.selected.reason
  const create = async () => {
    setBusy(true); setError(null)
    const r = await createSolarProposalAction({ projectId: props.projectId })
    setBusy(false)
    if ('error' in r) setError(r.error); else router.refresh()
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Client proposals</span></CardHeader>
      <CardBody>
        <Button type="button" size="sm" disabled={Boolean(blocked) || busy} title={blocked ?? undefined} onClick={create}>{busy ? 'Creating…' : 'New proposal'}</Button>
        {props.proposals.length === 0
          ? <EmptyState icon={FileSignature} dense title="No proposals yet" description="Draft a client offer from the selected case." />
          : <ul style={{ margin: '8px 0 0', padding: 0 }}>{props.proposals.map((p) => <Row key={p.id} p={p} props={props} />)}</ul>}
        {error && <p role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
      </CardBody>
    </Card>
  )
}
