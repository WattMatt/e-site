'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateInspectionAssignmentAction } from '@/actions/inspections.actions'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type Member = { user_id: string; full_name: string | null; email: string | null; role: string | null }

const VERIFIER_ROLES = ['owner', 'admin', 'project_manager']
const labelFor = (m: Member) => m.full_name ?? m.email ?? m.user_id.slice(0, 8)

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
  marginBottom: 6,
}
const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--c-text)',
  fontSize: 13,
  fontFamily: 'inherit',
}

interface Props {
  inspectionId: string
  projectId: string
  organisationId: string
  assignedToId: string | null
  verifierId: string | null
  assigneeName: string | null
  verifierName: string | null
  members: Member[]
  canEdit: boolean
}

export default function AssignmentEditor({
  inspectionId,
  projectId,
  organisationId,
  assignedToId,
  verifierId,
  assigneeName,
  verifierName,
  members,
  canEdit,
}: Props) {
  const router = useRouter()
  const [assignedTo, setAssignedTo] = useState(assignedToId ?? '')
  const [verifier, setVerifier] = useState(verifierId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const eligibleVerifiers = members.filter((m) => m.role && VERIFIER_ROLES.includes(m.role))

  async function onSave() {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      if (!verifier) throw new Error('Assign a verifier')
      await updateInspectionAssignmentAction({
        inspectionId,
        projectId,
        organisationId,
        assignedToId: assignedTo || null,
        verifierId: verifier,
      })
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) {
    return (
      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--c-text-mid)' }}>
            <div>
              <span style={FIELD_LABEL}>INSPECTOR</span>
              {assigneeName ?? '— unassigned —'}
            </div>
            <div>
              <span style={FIELD_LABEL}>VERIFIER</span>
              {verifierName ?? '—'}
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="edit_assigned_to" style={FIELD_LABEL}>
                INSPECTOR (OPTIONAL)
              </label>
              <select
                id="edit_assigned_to"
                style={FIELD_INPUT}
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">— unassigned (anyone can pick up) —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {labelFor(m)}
                    {m.role ? ` (${m.role})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="edit_verifier" style={FIELD_LABEL}>
                VERIFIER *
              </label>
              <select
                id="edit_verifier"
                style={FIELD_INPUT}
                value={verifier}
                onChange={(e) => setVerifier(e.target.value)}
              >
                <option value="">— select —</option>
                {eligibleVerifiers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {labelFor(m)} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</div>}
          {saved && !error && (
            <div style={{ fontSize: 12, color: 'var(--c-green, #3fb950)' }}>Saved.</div>
          )}

          <div>
            <Button onClick={onSave} disabled={busy} isLoading={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
