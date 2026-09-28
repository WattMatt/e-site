'use client'
/**
 * Solar Access panel (spec §1.3). Level changes save immediately (with the
 * row's updated_at as expectedUpdatedAt); removing access and copying access
 * are two-step. After every successful write the server data is refreshed.
 */
import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SOLAR_LEVEL_LABELS, formatSolarDate, isSolarAccessLevel, requestableLevels, type SolarAccessLevel,
} from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  copySolarAccessFromProjectAction, decideSolarRequestAction, markSubscribeRequestDoneAction, setSolarMemberLevelAction,
} from '@/actions/solar-access.actions'
import type {
  AccessPanelData, AccessPanelMember, AccessPanelRequest, AccessPanelSubscribeRequest,
} from '@/lib/solar/access-panel-types'
import { useArmedConfirm } from '../_components/useArmedConfirm'

const ERR: CSSProperties = { margin: '4px 0 0', fontSize: 12, color: 'var(--c-red)' }
const TH: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const MUTED: CSSProperties = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }

export function AccessPanel({ data }: { data: AccessPanelData }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SubscriptionCard subscription={data.subscription} orgSubscribed={data.orgSubscribed} />
      <SubscribeRequestsCard requests={data.subscribeRequests} orgSubscribed={data.orgSubscribed} onDone={refresh} />
      <Card>
        <CardHeader><span className="data-panel-title">Requests</span></CardHeader>
        <CardBody>
          {data.requests.length === 0
            ? <p style={MUTED}>No requests waiting.</p>
            : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                {data.requests.map((r) => <RequestRow key={r.id} request={r} onDone={refresh} />)}
              </ul>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Members</span></CardHeader>
        <CardBody>
          {data.members.length === 0
            ? <p style={MUTED}>
                <span>No project members yet — add them in project settings.</span>{' '}
                <Link href={`/projects/${data.projectId}/settings/members`}>Project members</Link>
              </p>
            : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr><th style={TH}>Member</th><th style={TH}>E-Site role</th><th style={TH}>Solar level</th><th style={TH}>Granted by</th><th style={TH}>Granted on</th></tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => (
                      <MemberRow key={`${m.userId}:${m.updatedAt ?? 'none'}`} projectId={data.projectId} member={m} onSaved={refresh} />
                    ))}
                  </tbody>
                </table>
              </div>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Copy access from another project</span></CardHeader>
        <CardBody><CopyAccess projectId={data.projectId} projects={data.otherProjects} onDone={refresh} /></CardBody>
      </Card>
    </div>
  )
}

function SubscriptionCard({
  subscription, orgSubscribed,
}: { subscription: AccessPanelData['subscription']; orgSubscribed: boolean }) {
  // No row but org_has_solar true = active without a Paystack subscription
  // (the internal bypass, e.g. WM-Consulting) — never "Not subscribed".
  let text = orgSubscribed ? 'Active — included with your E-Site plan' : 'Not subscribed'
  if (subscription) {
    const end = subscription.currentPeriodEnd
    const lapsed = end !== null && Date.parse(end) <= Date.now()
    if ((subscription.status === 'active' || subscription.status === 'non_renewing') && end) {
      text = lapsed
        ? `Lapsed on ${formatSolarDate(end)}`
        : `${subscription.status === 'active' ? 'Active — renews' : 'Active — ends'} ${formatSolarDate(end)}`
    } else {
      text = ({ pending: 'Waiting for payment', past_due: 'Payment overdue', cancelled: 'Cancelled', refunded: 'Refunded' } as Record<string, string>)[subscription.status] ?? subscription.status
    }
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Subscription</span></CardHeader>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13 }}>{text}</span>
          <Link href="/settings/billing" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-amber)' }}>Manage subscription</Link>
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Owner default 3 (2026-09-28): "ask an admin to subscribe" requests, org-wide.
 * Mark done closes one (status 'approved' via 00207's guard). Once the org is
 * subscribed the open ones are listed under "Resolved" — subscribing answered
 * them — and can still be marked done.
 */
function SubscribeRequestsCard({
  requests, orgSubscribed, onDone,
}: { requests: AccessPanelSubscribeRequest[]; orgSubscribed: boolean; onDone: () => void }) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Subscription requests</span></CardHeader>
      <CardBody>
        {requests.length === 0
          ? <p style={MUTED}>No one has asked for a subscription.</p>
          : <>
              {orgSubscribed && <p style={{ ...MUTED, marginBottom: 8 }}>Resolved — Solar is now active for your organisation</p>}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                {requests.map((r) => <SubscribeRequestRow key={r.id} request={r} onDone={onDone} />)}
              </ul>
            </>}
      </CardBody>
    </Card>
  )
}

function SubscribeRequestRow({ request, onDone }: { request: AccessPanelSubscribeRequest; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function markDone() {
    setBusy(true)
    setError(null)
    const res = await markSubscribeRequestDoneAction(request.id)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    onDone()
  }

  return (
    <li style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <span>{`${request.requesterName} asked for Solar on ${request.projectName} on ${formatSolarDate(request.createdAt)}`}</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => void markDone()} isLoading={busy} style={{ marginLeft: 'auto' }}>
          Mark done
        </Button>
      </div>
      {request.note && <p style={{ ...MUTED, marginTop: 4 }}>{`“${request.note}”`}</p>}
      {error && <p role="alert" style={ERR}>{error}</p>}
    </li>
  )
}

function MemberRow({ projectId, member, onSaved }: { projectId: string; member: AccessPanelMember; onSaved: () => void }) {
  const [level, setLevel] = useState<SolarAccessLevel | null>(member.level)
  const [updatedAt, setUpdatedAt] = useState<string | null>(member.updatedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = useArmedConfirm()
  const options = requestableLevels(member.external ? 'view' : 'edit_financials')

  async function save(next: SolarAccessLevel | null) {
    setBusy(true)
    setError(null)
    const res = await setSolarMemberLevelAction({ projectId, userId: member.userId, level: next, expectedUpdatedAt: updatedAt })
    setBusy(false)
    remove.disarm()
    if ('error' in res) { setError(res.error); return }
    setLevel(next)
    setUpdatedAt(res.updatedAt)
    onSaved()
  }

  function onChange(value: string) {
    if (value === 'none') {
      if (level !== null) remove.arm()
      return
    }
    remove.disarm()
    if (isSolarAccessLevel(value) && value !== level) void save(value)
  }

  return (
    <tr>
      <td style={TD}>
        {member.name}{' '}
        {member.external && <Badge variant="ghost">external</Badge>}
      </td>
      <td style={TD}>{member.role.replace(/_/g, ' ')}</td>
      <td style={TD}>
        {member.implicit
          ? <span>Edit + financials (owner/admin)</span>
          : <>
              <select
                aria-label={`Solar level for ${member.name}`}
                value={remove.armed ? 'none' : (level ?? 'none')}
                disabled={busy}
                onChange={(e) => onChange(e.target.value)}
              >
                <option value="none">None</option>
                {options.map((l) => <option key={l} value={l}>{SOLAR_LEVEL_LABELS[l]}</option>)}
              </select>
              {remove.armed && (
                <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  Remove access?
                  <Button type="button" size="sm" variant="danger" onClick={() => void save(null)} isLoading={busy}>Remove</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={remove.disarm}>Cancel</Button>
                </span>
              )}
              {error && <p role="alert" style={ERR}>{error}</p>}
            </>}
      </td>
      <td style={TD}>{member.grantedByName ?? '—'}</td>
      <td style={TD}>{member.grantedAt ? formatSolarDate(member.grantedAt) : '—'}</td>
    </tr>
  )
}

function RequestRow({ request, onDone }: { request: AccessPanelRequest; onDone: () => void }) {
  const levels = requestableLevels(request.maxLevel)
  const initial = request.requestedLevel && levels.includes(request.requestedLevel) ? request.requestedLevel : levels[0]
  const [level, setLevel] = useState<SolarAccessLevel>(initial)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'approve' | 'decline') {
    setBusy(true)
    setError(null)
    const res = await decideSolarRequestAction(
      decision === 'approve'
        ? { requestId: request.id, decision, level }
        : { requestId: request.id, decision, reason },
    )
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    onDone()
  }

  return (
    <li style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 12 }}>
      <div style={{ fontSize: 13 }}>
        <strong>{request.requesterName}</strong> asked for{' '}
        {request.requestedLevel ? SOLAR_LEVEL_LABELS[request.requestedLevel] : 'access'} on {formatSolarDate(request.createdAt)}
      </div>
      {request.note && <p style={{ ...MUTED, marginTop: 4 }}>{`“${request.note}”`}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <select aria-label={`Approve ${request.requesterName} as`} value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as SolarAccessLevel)}>
          {levels.map((l) => <option key={l} value={l}>{SOLAR_LEVEL_LABELS[l]}</option>)}
        </select>
        <Button type="button" size="sm" onClick={() => void decide('approve')} isLoading={busy && !declining}>Approve</Button>
        {!declining
          ? <Button type="button" size="sm" variant="secondary" onClick={() => setDeclining(true)} disabled={busy}>Decline</Button>
          : <>
              <input aria-label="Reason (optional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
              <Button type="button" size="sm" variant="danger" onClick={() => void decide('decline')} isLoading={busy}>Confirm decline</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)} disabled={busy}>Cancel</Button>
            </>}
      </div>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </li>
  )
}

function CopyAccess({ projectId, projects, onDone }: { projectId: string; projects: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [source, setSource] = useState(projects[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirm = useArmedConfirm()
  if (projects.length === 0) return <p style={MUTED}>No other projects in this organisation.</p>
  const sourceName = projects.find((p) => p.id === source)?.name ?? ''

  async function onClick() {
    if (!confirm.armed) { confirm.arm(); return }
    confirm.disarm()
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await copySolarAccessFromProjectAction({ projectId, sourceProjectId: source })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    setMessage(`Copied ${res.copied}; skipped ${res.skipped} not eligible on this project.`)
    onDone()
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <select aria-label="Copy access from" value={source} onChange={(e) => { setSource(e.target.value); confirm.disarm() }} disabled={busy}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Button type="button" size="sm" variant={confirm.armed ? 'danger' : 'secondary'} onClick={() => void onClick()} isLoading={busy}>
        {confirm.armed ? `Press again to copy from ${sourceName}` : 'Copy access from project'}
      </Button>
      {message && <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{message}</span>}
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}
