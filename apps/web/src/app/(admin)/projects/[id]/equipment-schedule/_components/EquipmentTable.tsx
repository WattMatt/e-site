'use client'

/**
 * EquipmentTable — client component for the Equipment Schedule page.
 *
 * Renders nodes grouped by kind, each group collapsible.
 * Handles Add / Edit / Decommission / Reactivate via inline modals.
 */

import { Fragment, useState, useMemo, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput } from '@/components/ui/FormField'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { EquipmentForm } from './EquipmentForm'
import type { EquipmentFormValues } from './EquipmentForm'
import type { Node } from '@esite/shared'
import type { EquipmentKind } from '@esite/shared'
import {
  createEquipmentNodeAction,
  editEquipmentNodeAction,
  decommissionEquipmentNodeAction,
  reactivateEquipmentNodeAction,
} from '@/actions/equipment.actions'
import { NodeOrderCell } from './NodeOrderCell'
import type { NodeOrderData } from './NodeOrderCell'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<EquipmentKind, string> = {
  rmu: 'Ring Main Units (RMU)',
  mini_sub: 'Mini-Substations',
  generator: 'Generators',
  main_board: 'Main Boards',
  common_area_board: 'Common Area Boards',
}

// Display order for kind groups
const KIND_ORDER: EquipmentKind[] = ['rmu', 'mini_sub', 'generator', 'main_board', 'common_area_board']

// ---------------------------------------------------------------------------
// Inline edit form
// ---------------------------------------------------------------------------

interface EditFormProps {
  node: Node
  existingCodes: string[]
  projectId: string
  onDone: () => void
}

function EditForm({ node, existingCodes, projectId, onDone }: EditFormProps) {
  const [code, setCode] = useState(node.code)
  const [name, setName] = useState(node.name ?? '')
  const [cocRequired, setCocRequired] = useState(node.coc_required)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!code.trim()) { setError('Code is required.'); return }

    startTransition(async () => {
      const result = await editEquipmentNodeAction(projectId, node.id, code.trim(), name.trim(), cocRequired)
      if ('error' in result) { setError(result.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '12px 16px', background: 'var(--c-surface-raised)', borderTop: '1px solid var(--c-border)' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 140px' }}>
          <FormField label="Code" htmlFor={`edit-code-${node.id}`} required>
            <TextInput
              id={`edit-code-${node.id}`}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null) }}
              maxLength={50}
              disabled={isPending}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </FormField>
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <FormField label="Name (optional)" htmlFor={`edit-name-${node.id}`}>
            <TextInput
              id={`edit-name-${node.id}`}
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              maxLength={120}
              disabled={isPending}
            />
          </FormField>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4 }}>
          <input
            id={`edit-coc-${node.id}`}
            type="checkbox"
            checked={cocRequired}
            onChange={(e) => setCocRequired(e.target.checked)}
            disabled={isPending}
            style={{ width: 14, height: 14, accentColor: 'var(--c-amber)', cursor: isPending ? 'not-allowed' : 'pointer' }}
          />
          <label htmlFor={`edit-coc-${node.id}`} style={{ fontSize: 13, color: 'var(--c-text-mid)', cursor: isPending ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
            COC required
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6, paddingBottom: 4 }}>
          <Button type="submit" variant="primary" size="sm" isLoading={isPending} disabled={isPending}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
          {error}
        </div>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Decommission modal
// ---------------------------------------------------------------------------

interface DecommissionModalProps {
  node: Node
  projectId: string
  onDone: () => void
  onCancel: () => void
}

function DecommissionModal({ node, projectId, onDone, onCancel }: DecommissionModalProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await decommissionEquipmentNodeAction(projectId, node.id, reason.trim() || undefined)
      if ('error' in result) { setError(result.error); return }
      onDone()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Decommission equipment"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 24,
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
          Decommission {node.code}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
          The node will be marked decommissioned and hidden from active views. It is never deleted.
        </p>
        <form onSubmit={handleSubmit}>
          <FormField label="Reason (optional)" htmlFor="decommission-reason">
            <TextInput
              id="decommission-reason"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null) }}
              placeholder="e.g. Replaced by new switchgear"
              maxLength={500}
              disabled={isPending}
            />
          </FormField>
          {error && (
            <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" isLoading={isPending} disabled={isPending}>
              Decommission
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add panel — wraps EquipmentForm for the page create flow
// ---------------------------------------------------------------------------

interface AddPanelProps {
  projectId: string
  existingCodes: string[]
  defaultKind?: EquipmentKind
  onDone: () => void
}

function AddPanel({ projectId, existingCodes, defaultKind, onDone }: AddPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(values: EquipmentFormValues) {
    setError(null)
    return new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        const result = await createEquipmentNodeAction(
          projectId,
          values.kind,
          values.code,
          values.name,
          values.coc_required,
        )
        if ('error' in result) {
          reject(new Error(result.error))
        } else {
          onDone()
          resolve()
        }
      })
    })
  }

  return (
    <div style={{ padding: '16px', background: 'var(--c-surface-raised)', borderTop: '1px solid var(--c-border)' }}>
      <div style={{ marginBottom: 12, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
        Add equipment
      </div>
      <EquipmentForm
        existingCodes={existingCodes}
        defaultKind={defaultKind}
        onSubmit={handleSubmit}
        onCancel={onDone}
        isLoading={isPending}
      />
      {error && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KindGroup — collapsible group per node kind
// ---------------------------------------------------------------------------

interface KindGroupProps {
  kind: EquipmentKind
  nodes: Node[]
  projectId: string
  existingCodes: string[]
  showDecommissioned: boolean
  onAddClick: (kind: EquipmentKind) => void
  addingKind: EquipmentKind | null
  onAddDone: () => void
  ordersByNodeId: Record<string, NodeOrderData>
}

function KindGroup({
  kind,
  nodes,
  projectId,
  existingCodes,
  showDecommissioned,
  onAddClick,
  addingKind,
  onAddDone,
  ordersByNodeId,
}: KindGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [decommissioningNodeId, setDecommissioningNodeId] = useState<string | null>(null)
  const [, startReactivate] = useTransition()
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const [reactivateError, setReactivateError] = useState<string | null>(null)

  const visible = showDecommissioned ? nodes : nodes.filter((n) => n.status === 'active')
  const isAdding = addingKind === kind

  if (visible.length === 0 && !isAdding) return null

  function handleReactivate(nodeId: string) {
    setReactivateError(null)
    setReactivatingId(nodeId)
    startReactivate(async () => {
      const result = await reactivateEquipmentNodeAction(projectId, nodeId)
      if ('error' in result) setReactivateError(result.error)
      setReactivatingId(null)
    })
  }

  return (
    <>
      {decommissioningNodeId && (
        <DecommissionModal
          node={nodes.find((n) => n.id === decommissioningNodeId)!}
          projectId={projectId}
          onDone={() => setDecommissioningNodeId(null)}
          onCancel={() => setDecommissioningNodeId(null)}
        />
      )}

      <div style={{ marginBottom: 16 }}>
      <Card>
        {/* Group header */}
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600,
                color: 'var(--c-text)', display: 'flex', alignItems: 'center', gap: 6, padding: 0,
              }}
              aria-expanded={!collapsed}
            >
              <span style={{ fontSize: 11, color: 'var(--c-text-dim)', transition: 'transform 0.15s', display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
              {KIND_LABEL[kind]}
            </button>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
              {visible.filter((n) => n.status === 'active').length} active
              {showDecommissioned && visible.some((n) => n.status === 'decommissioned') &&
                ` · ${visible.filter((n) => n.status === 'decommissioned').length} decommissioned`}
            </span>
            <div style={{ marginLeft: 'auto' }}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setCollapsed(false); onAddClick(kind) }}
              >
                + Add
              </Button>
            </div>
          </div>
        </CardHeader>

        {!collapsed && (
          <CardBody>
            {/* Table */}
            {visible.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface-raised)' }}>
                      {['Code', 'Name', 'COC Required', 'Status', 'Order', ''].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 12px', textAlign: 'left', fontSize: 11,
                            fontWeight: 600, color: 'var(--c-text-dim)',
                            letterSpacing: '0.05em', textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((node) => (
                      <Fragment key={node.id}>
                        <tr
                          style={{
                            borderBottom: editingNodeId === node.id ? 'none' : '1px solid var(--c-border)',
                            opacity: node.status === 'decommissioned' ? 0.5 : 1,
                            background: editingNodeId === node.id ? 'var(--c-surface-raised)' : 'transparent',
                          }}
                        >
                          {/* Code */}
                          <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
                            {node.code}
                          </td>
                          {/* Name */}
                          <td style={{ padding: '10px 12px', color: 'var(--c-text-mid)' }}>
                            {node.name ?? <span style={{ color: 'var(--c-text-dim)', fontStyle: 'italic' }}>—</span>}
                          </td>
                          {/* COC required */}
                          <td style={{ padding: '10px 12px' }}>
                            {node.coc_required ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                background: 'var(--c-amber-dim)', color: 'var(--c-amber)',
                                border: '1px solid var(--c-amber-mid)',
                              }}>
                                Yes
                              </span>
                            ) : (
                              <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>No</span>
                            )}
                          </td>
                          {/* Status */}
                          <td style={{ padding: '10px 12px' }}>
                            {node.status === 'active' ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                background: 'var(--c-green-dim)', color: 'var(--c-green)',
                                border: '1px solid var(--c-green-mid)',
                              }}>
                                Active
                              </span>
                            ) : (
                              <div>
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                  background: 'var(--c-surface-raised)', color: 'var(--c-text-dim)',
                                  border: '1px solid var(--c-border)',
                                }}>
                                  Decommissioned
                                </span>
                                {node.decommission_reason && (
                                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)', fontStyle: 'italic' }}>
                                    {node.decommission_reason}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          {/* Order status */}
                          <td style={{ padding: '10px 12px' }}>
                            <NodeOrderCell
                              order={ordersByNodeId[node.id] ?? null}
                              projectId={projectId}
                            />
                          </td>
                          {/* Actions */}
                          <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              {node.status === 'active' ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingNodeId(editingNodeId === node.id ? null : node.id)}
                                  >
                                    {editingNodeId === node.id ? 'Cancel' : 'Edit'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDecommissioningNodeId(node.id)}
                                    style={{ color: 'var(--c-text-dim)' }}
                                  >
                                    Decommission
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  isLoading={reactivatingId === node.id}
                                  disabled={reactivatingId === node.id}
                                  onClick={() => handleReactivate(node.id)}
                                >
                                  Reactivate
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {editingNodeId === node.id && (
                          <tr>
                            <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--c-border)' }}>
                              <EditForm
                                node={node}
                                existingCodes={existingCodes.filter((c) => c !== node.code)}
                                projectId={projectId}
                                onDone={() => setEditingNodeId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Empty state within group */}
            {visible.length === 0 && !isAdding && (
              <div style={{ padding: '20px 16px', color: 'var(--c-text-dim)', fontSize: 13, fontFamily: 'var(--font-sans)', textAlign: 'center' }}>
                No {KIND_LABEL[kind].toLowerCase()} yet.{' '}
                <button
                  type="button"
                  onClick={() => onAddClick(kind)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-amber)', fontFamily: 'var(--font-sans)', fontSize: 13, padding: 0, textDecoration: 'underline' }}
                >
                  Add one.
                </button>
              </div>
            )}

            {/* Reactivate error */}
            {reactivateError && (
              <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
                {reactivateError}
              </div>
            )}

            {/* Add form */}
            {isAdding && (
              <AddPanel
                projectId={projectId}
                existingCodes={existingCodes}
                defaultKind={kind}
                onDone={onAddDone}
              />
            )}
          </CardBody>
        )}
      </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// EquipmentTable (top-level export)
// ---------------------------------------------------------------------------

interface Props {
  nodes: Node[]
  projectId: string
  ordersByNodeId: Record<string, NodeOrderData>
}

export function EquipmentTable({ nodes, projectId, ordersByNodeId }: Props) {
  const [showDecommissioned, setShowDecommissioned] = useState(false)
  const [addingKind, setAddingKind] = useState<EquipmentKind | null>(null)

  const existingCodes = useMemo(() => nodes.map((n) => n.code), [nodes])

  // Only equipment kinds (exclude tenant_db)
  const equipmentNodes = nodes.filter((n) => n.kind !== 'tenant_db')
  const decommissionedCount = equipmentNodes.filter((n) => n.status === 'decommissioned').length

  // Group by kind, respecting display order
  const byKind = new Map<EquipmentKind, Node[]>()
  for (const kind of KIND_ORDER) byKind.set(kind, [])
  for (const node of equipmentNodes) {
    const kind = node.kind as EquipmentKind
    if (byKind.has(kind)) byKind.get(kind)!.push(node)
  }

  function handleAddClick(kind: EquipmentKind) {
    setAddingKind((prev) => (prev === kind ? null : kind))
  }

  function handleAddDone() {
    setAddingKind(null)
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => {
            // Open first kind's add panel
            const firstKind = KIND_ORDER[0]
            setAddingKind(firstKind)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          + Add equipment
        </Button>

        {decommissionedCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showDecommissioned}
              onChange={(e) => setShowDecommissioned(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--c-amber)' }}
            />
            Show decommissioned ({decommissionedCount})
          </label>
        )}
      </div>

      {/* Kind groups */}
      {KIND_ORDER.map((kind) => {
        const kindNodes = byKind.get(kind) ?? []
        return (
          <KindGroup
            key={kind}
            kind={kind}
            nodes={kindNodes}
            projectId={projectId}
            existingCodes={existingCodes}
            showDecommissioned={showDecommissioned}
            onAddClick={handleAddClick}
            addingKind={addingKind}
            onAddDone={handleAddDone}
            ordersByNodeId={ordersByNodeId}
          />
        )
      })}

      {/* Empty state — no equipment at all */}
      {equipmentNodes.length === 0 && addingKind === null && (
        <Card>
          <CardBody>
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--c-text-mid)' }}>No equipment registered yet</div>
              <div style={{ fontSize: 13 }}>
                Add your first item — RMU, mini-sub, generator, or main board.
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
