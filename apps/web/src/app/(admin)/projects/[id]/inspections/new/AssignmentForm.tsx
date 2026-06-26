'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createInspectionAction } from '@/actions/inspections.actions'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type Node = { type: 'board' | 'source'; id: string; label: string }
type Member = { user_id: string; full_name: string | null; email: string | null; role: string | null }
type Template = {
  id: string
  name: string
  deliverable_type: string
  applies_to_node_types: string[]
}

interface Props {
  organisationId: string
  projectId: string
  templates: Template[]
  nodes: Node[]
  members: Member[]
  prefillNodeType: string | null
  prefillNodeId: string | null
}

const VERIFIER_ROLES = ['owner', 'admin', 'project_manager']

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

export default function AssignmentForm({
  organisationId,
  projectId,
  templates,
  nodes,
  members,
  prefillNodeType,
  prefillNodeId,
}: Props) {
  const router = useRouter()

  const initialMode: 'node' | 'adhoc' =
    prefillNodeType === 'adhoc' ? 'adhoc' : nodes.length === 0 ? 'adhoc' : 'node'

  const [templateId, setTemplateId] = useState('')
  const [targetMode, setTargetMode] = useState<'node' | 'adhoc'>(initialMode)
  const [nodeKey, setNodeKey] = useState(
    prefillNodeType && prefillNodeId && prefillNodeType !== 'adhoc'
      ? `${prefillNodeType}:${prefillNodeId}`
      : '',
  )
  const [adhocLabel, setAdhocLabel] = useState('')
  const [adhocLocation, setAdhocLocation] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [verifierId, setVerifierId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplate = templates.find((t) => t.id === templateId)
  const visibleNodes = selectedTemplate
    ? nodes.filter(
        (n) =>
          selectedTemplate.applies_to_node_types.includes(n.type) ||
          selectedTemplate.applies_to_node_types.includes('any'),
      )
    : nodes

  const eligibleVerifiers = members.filter((m) => m.role && VERIFIER_ROLES.includes(m.role))

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      if (!templateId) throw new Error('Pick a template')
      if (!verifierId) throw new Error('Assign a verifier')

      let targetNodeType: 'board' | 'source' | 'adhoc' = 'adhoc'
      let targetNodeId: string | null = null
      let targetLabel = adhocLabel.trim()
      let targetLocation: string | null = adhocLocation.trim() || null

      if (targetMode === 'node') {
        if (!nodeKey) throw new Error('Pick a target node')
        const [type, id] = nodeKey.split(':') as ['board' | 'source', string]
        const node = nodes.find((n) => n.id === id && n.type === type)
        if (!node) throw new Error('Selected node not found')
        targetNodeType = type
        targetNodeId = id
        targetLabel = node.label
        targetLocation = null
      }

      if (!targetLabel) throw new Error('Target label required')

      const id = await createInspectionAction({
        organisationId,
        projectId,
        templateId,
        targetNodeType,
        targetNodeId,
        targetLabel,
        targetLocation,
        assignedToId: assignedToId || null,
        verifierId,
        scheduledAt: scheduledAt || null,
      })
      router.push(`/projects/${projectId}/inspections/${id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const labelFor = (m: Member) => m.full_name ?? m.email ?? m.user_id.slice(0, 8)

  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label htmlFor="template" style={FIELD_LABEL}>
              TEMPLATE
            </label>
            <select
              id="template"
              style={FIELD_INPUT}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">— select —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.deliverable_type.replace(/_/g, ' ')})
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>
                No active templates. Import one in{' '}
                <a href="/inspections/templates" style={{ color: 'var(--c-amber)' }}>
                  Inspections → Templates
                </a>
                .
              </p>
            )}
          </div>

          <div>
            <span style={FIELD_LABEL}>TARGET</span>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--c-text-mid)', marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="target_mode"
                  checked={targetMode === 'node'}
                  onChange={() => setTargetMode('node')}
                  disabled={nodes.length === 0}
                />
                From cable schedule
                {nodes.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}> (no nodes available)</span>
                )}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="target_mode"
                  checked={targetMode === 'adhoc'}
                  onChange={() => setTargetMode('adhoc')}
                />
                Ad-hoc (free text)
              </label>
            </div>

            {targetMode === 'node' ? (
              <select
                style={FIELD_INPUT}
                value={nodeKey}
                onChange={(e) => setNodeKey(e.target.value)}
              >
                <option value="">— select —</option>
                {visibleNodes.map((n) => (
                  <option key={`${n.type}:${n.id}`} value={`${n.type}:${n.id}`}>
                    {n.label} ({n.type})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  style={FIELD_INPUT}
                  placeholder="Label (e.g. Fire Panel A)"
                  value={adhocLabel}
                  onChange={(e) => setAdhocLabel(e.target.value)}
                />
                <input
                  style={FIELD_INPUT}
                  placeholder="Location (e.g. Basement plant room)"
                  value={adhocLocation}
                  onChange={(e) => setAdhocLocation(e.target.value)}
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="assigned_to" style={FIELD_LABEL}>
              ASSIGNED TO (OPTIONAL)
            </label>
            <select
              id="assigned_to"
              style={FIELD_INPUT}
              value={assignedToId}
              onChange={(e) => setAssignedToId(e.target.value)}
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

          <div>
            <label htmlFor="verifier" style={FIELD_LABEL}>
              VERIFIER *
            </label>
            <select
              id="verifier"
              style={FIELD_INPUT}
              value={verifierId}
              onChange={(e) => setVerifierId(e.target.value)}
            >
              <option value="">— select —</option>
              {eligibleVerifiers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {labelFor(m)} ({m.role})
                </option>
              ))}
            </select>
            {eligibleVerifiers.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--c-red)', marginTop: 6 }}>
                No project member with verifier-eligible role (owner / admin / project_manager).
              </p>
            )}
          </div>

          <div>
            <label htmlFor="scheduled_at" style={FIELD_LABEL}>
              SCHEDULED DATE (OPTIONAL)
            </label>
            <input
              id="scheduled_at"
              type="date"
              style={{ ...FIELD_INPUT, maxWidth: 200 }}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          {error && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--c-red)',
                background: 'var(--c-red-dim)',
                border: '1px solid var(--c-red)',
                borderRadius: 6,
                padding: '8px 12px',
              }}
            >
              {error}
            </div>
          )}

          <div>
            <Button onClick={onSubmit} disabled={busy} isLoading={busy}>
              {busy ? 'Creating…' : 'Create Inspection'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
