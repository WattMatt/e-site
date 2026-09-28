'use client'
/**
 * /solar/locked (spec §1.2): why Solar is locked and the ONE action that
 * unlocks it, per the §0.2 row the server resolved. Props are JSON only.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import {
  SOLAR_LEVEL_LABELS, formatSolarDate, joinNames, requestableLevels,
  type SolarAccessLevel, type SolarEntryState,
} from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  askAdminToSubscribeAction, requestSolarAccessAction, withdrawSolarRequestAction,
} from '@/actions/solar-requests.actions'
import { FeatureSummary } from './FeatureSummary'
import { SubscribeButton } from './SubscribeButton'
import { PaymentReturnPoller } from './PaymentReturnPoller'

export type LockedState = Exclude<SolarEntryState, { kind: 'hidden' } | { kind: 'granted' }>

export interface LockedScreenProps {
  projectId: string
  projectName: string
  orgName: string
  state: LockedState
  priceLine: string
  /** Owners/admins who will see a pending request ("Request sent to …"). */
  grantorNames: string[]
  /** Back from Paystack (?payment=received, set by 1B): poll instead of offering Subscribe. */
  paymentReturn: boolean
}

const H2: CSSProperties = { fontSize: 16, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 8px' }
const MUTED: CSSProperties = { fontSize: 13, color: 'var(--c-text-mid)', margin: '0 0 12px' }
const ERR: CSSProperties = { marginTop: 8, fontSize: 12, color: 'var(--c-red)' }

export function LockedScreen(p: LockedScreenProps) {
  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Lock size={18} style={{ verticalAlign: -2, marginRight: 8, opacity: 0.7 }} aria-hidden="true" />
            Solar
          </h1>
          <p className="page-subtitle">{p.projectName}</p>
        </div>
      </div>
      <Card><CardBody><LockedAction {...p} /></CardBody></Card>
      <div style={{ marginTop: 16 }}><FeatureSummary /></div>
    </div>
  )
}

function LockedAction(p: LockedScreenProps) {
  const s = p.state
  switch (s.kind) {
    case 'subscribe':
      return (
        <>
          <h2 style={H2}>Solar is not active for {p.orgName}</h2>
          <p style={MUTED}>{p.priceLine}</p>
          {p.paymentReturn ? <PaymentReturnPoller projectId={p.projectId} /> : <SubscribeButton projectId={p.projectId} />}
        </>
      )
    case 'ask_admin':
      return (
        <>
          <h2 style={H2}>Solar is not active for {p.orgName}</h2>
          <p style={MUTED}>{p.priceLine}</p>
          <AskAdmin projectId={p.projectId} requestedAt={s.requestedAt} />
        </>
      )
    case 'request_access':
      return (
        <>
          <h2 style={H2}>You do not have Solar access on {p.projectName}</h2>
          <RequestAccess projectId={p.projectId} maxLevel={s.maxLevel} />
        </>
      )
    case 'pending':
      return (
        <>
          <h2 style={H2}>Your request is waiting for an answer</h2>
          <Pending projectId={p.projectId} requestedAt={s.requestedAt} names={p.grantorNames} />
        </>
      )
  }
}

function AskAdmin({ projectId, requestedAt }: { projectId: string; requestedAt: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (requestedAt) return <p style={MUTED}>Requested on {formatSolarDate(requestedAt)}</p>

  async function ask() {
    setBusy(true)
    setError(null)
    const res = await askAdminToSubscribeAction(projectId)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.refresh()
  }
  return (
    <div>
      <Button type="button" onClick={ask} isLoading={busy}>Ask an admin to subscribe</Button>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}

function RequestAccess({ projectId, maxLevel }: { projectId: string; maxLevel: SolarAccessLevel }) {
  const router = useRouter()
  const levels = requestableLevels(maxLevel)
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<SolarAccessLevel>(levels[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return <Button type="button" onClick={() => setOpen(true)}>Request access</Button>

  async function send() {
    setBusy(true)
    setError(null)
    const res = await requestSolarAccessAction({ projectId, level, note })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.refresh()
  }
  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
      <label style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
        Level
        <select
          aria-label="Level"
          value={level}
          onChange={(e) => setLevel(e.target.value as SolarAccessLevel)}
          style={{ display: 'block', marginTop: 4, width: '100%' }}
        >
          {levels.map((l) => <option key={l} value={l}>{SOLAR_LEVEL_LABELS[l]}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
        Note (optional)
        <textarea
          aria-label="Note (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={{ display: 'block', marginTop: 4, width: '100%' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" onClick={send} isLoading={busy}>Send request</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}

function Pending({ projectId, requestedAt, names }: { projectId: string; requestedAt: string; names: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const to = names.length ? joinNames(names) : 'the organisation admins'

  async function withdraw() {
    setBusy(true)
    setError(null)
    const res = await withdrawSolarRequestAction(projectId)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.refresh()
  }
  return (
    <div>
      <p style={MUTED}>{`Request sent to ${to} on ${formatSolarDate(requestedAt)}`}</p>
      <Button type="button" variant="secondary" onClick={withdraw} isLoading={busy}>Withdraw request</Button>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}
