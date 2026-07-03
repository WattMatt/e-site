'use client'

import { useState, Fragment } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TableScrollX } from '@/components/ui/TableScrollX'
import type { Node } from '@esite/shared'
import { ScopeOfWorkPanel } from './ScopeOfWorkPanel'
import { LayoutIssuedPanel } from './LayoutIssuedPanel'
import { AddScopeItemModal } from './AddScopeItemModal'
import type { ScopeItemType, TenantScopeItem, TenantDetails } from './ScopeOfWorkPanel'
import type { LayoutDetails } from './LayoutIssuedPanel'
import { NodeOrderCell } from '../../equipment-schedule/_components/NodeOrderCell'
import type { NodeOrderData } from '../../equipment-schedule/_components/NodeOrderCell'
import { BoPeriodSelect, BoDateCell } from './BoCells'
import type { TenantBoInfo } from './BoCells'
import { TenantDeleteModal } from './TenantDeleteModal'
import { TenantEditModal } from './TenantEditModal'
import { TenantRecycleButton, TenantRestoreButton } from './TenantRecycleButtons'

interface Props {
  nodes: Node[]
  // Soft-deleted tenants (recycle bin) — kind='tenant_db', deleted_at set.
  deletedNodes: Node[]
  projectId: string
  orgId: string
  scopeItemTypes: ScopeItemType[]
  scopeItemsByNode: Record<string, TenantScopeItem[]>   // node_id → items
  tenantDetailsByNode: Record<string, TenantDetails>    // node_id → details
  layoutDetailsByNode: Record<string, LayoutDetails>    // node_id → layout details
  // `${node_id}:${scope_item_type_id}` → order — from node_orders for tenant scope items
  ordersByNodeAndScope: Record<string, NodeOrderData>
  // node_id → beneficial-occupation info (period, override, effective date)
  tenantBoByNode: Record<string, TenantBoInfo>
}

export function ScheduleTable({
  nodes,
  deletedNodes,
  projectId,
  orgId,
  scopeItemTypes: initialScopeItemTypes,
  scopeItemsByNode,
  tenantDetailsByNode,
  layoutDetailsByNode,
  ordersByNodeAndScope,
  tenantBoByNode,
}: Props) {
  const [showDecommissioned, setShowDecommissioned] = useState(false)
  // Recycle-bin disclosure (closed by default; mirrors showDecommissioned).
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  // node_id of the currently-expanded scope panel (one at a time)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  // node_id of the currently-expanded layout panel (one at a time, independent of scope)
  const [expandedLayoutNodeId, setExpandedLayoutNodeId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  // Tenant board pending hard-delete (opens the confirmation modal)
  const [deletingNode, setDeletingNode] = useState<{ id: string; code: string } | null>(null)
  // Tenant entry being edited (shop number / name / GLA form modal)
  const [editingNode, setEditingNode] = useState<Node | null>(null)
  // Local copy of scope item types so adding a new one reflects immediately
  const [scopeItemTypes, setScopeItemTypes] = useState<ScopeItemType[]>(initialScopeItemTypes)

  const activeNodes = nodes.filter((n) => n.status !== 'decommissioned')
  const decomNodes = nodes.filter((n) => n.status === 'decommissioned')
  const displayed = showDecommissioned ? nodes : activeNodes

  const sorted = [...displayed].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1
    const aNum = a.shop_number ?? a.code ?? ''
    const bNum = b.shop_number ?? b.code ?? ''
    return aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' })
  })

  function toggleScope(nodeId: string) {
    setExpandedNodeId((prev) => (prev === nodeId ? null : nodeId))
    // Close layout panel for this node if scope opens (keep one panel open per row)
    if (expandedLayoutNodeId === nodeId) setExpandedLayoutNodeId(null)
  }

  function toggleLayout(nodeId: string) {
    setExpandedLayoutNodeId((prev) => (prev === nodeId ? null : nodeId))
    // Close scope panel for this node if layout opens
    if (expandedNodeId === nodeId) setExpandedNodeId(null)
  }

  function handleScopeItemAdded(id: string, key: string, label: string) {
    setScopeItemTypes((prev) => {
      if (prev.some((t) => t.id === id)) return prev
      const nextOrder = prev.length > 0 ? Math.max(...prev.map((t) => t.sort_order)) + 1 : 10
      return [...prev, { id, key, label, sort_order: nextOrder }]
    })
  }

  const sortedDeleted = [...deletedNodes].sort((a, b) => {
    const aNum = a.shop_number ?? a.code ?? ''
    const bNum = b.shop_number ?? b.code ?? ''
    return aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' })
  })

  if (nodes.length === 0 && deletedNodes.length === 0) {
    return (
      <div
        style={{
          padding: '40px 24px',
          textAlign: 'center',
          color: 'var(--c-text-dim)',
          background: 'var(--c-panel)',
          borderRadius: 8,
          border: '1px solid var(--c-border)',
        }}
      >
        <p style={{ marginBottom: 6, fontWeight: 600 }}>No shops imported yet</p>
        <p style={{ fontSize: 13 }}>Upload a tenant schedule .xlsx file to get started.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Filter bar + Add scope item button */}
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {decomNodes.length > 0 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--c-text-mid)',
              }}
            >
              <input
                type="checkbox"
                checked={showDecommissioned}
                onChange={(e) => setShowDecommissioned(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Show decommissioned ({decomNodes.length})
            </label>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowAddModal(true)}
          style={{ fontSize: 12 }}
        >
          + Add scope item
        </Button>
      </div>

      <TableScrollX>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
              <Th>Shop No.</Th>
              <Th>Tenant</Th>
              <Th>GLA (m²)</Th>
              <Th>DB Code</Th>
              <Th>Breaker</Th>
              <Th>Scope Status</Th>
              <Th>BO Period</Th>
              <Th>BO Date</Th>
              {/* One party column + one order-status column per scope item type */}
              {scopeItemTypes.map((t) => (
                <Th key={t.id}>{t.label}</Th>
              ))}
              {scopeItemTypes.map((t) => (
                <Th key={`order-${t.id}`}>{t.label} Order</Th>
              ))}
              <Th>Layout Status</Th>
              <Th>Node Status</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((node) => {
              const decommissioned = node.status === 'decommissioned'
              const details = tenantDetailsByNode[node.id] ?? null
              const nodeItems = scopeItemsByNode[node.id] ?? []
              const isExpanded = expandedNodeId === node.id
              const isLayoutExpanded = expandedLayoutNodeId === node.id
              const layoutDetails = layoutDetailsByNode[node.id] ?? null

              return (
                <Fragment key={node.id}>
                  <tr
                    style={{
                      borderBottom: (isExpanded || isLayoutExpanded) ? 'none' : '1px solid var(--c-border)',
                      opacity: decommissioned ? 0.45 : 1,
                      background: (isExpanded || isLayoutExpanded) ? 'var(--c-bg)' : undefined,
                    }}
                  >
                    <Td mono>{node.shop_number ?? '—'}</Td>
                    <Td>{node.shop_name ?? node.name ?? '—'}</Td>
                    <Td mono>
                      {node.shop_area_m2 != null ? node.shop_area_m2.toLocaleString() : '—'}
                    </Td>
                    <Td mono>{node.code}</Td>

                    {/* Incoming-supply electrical (derived from cable schedule) */}
                    <Td mono>
                      {formatBreaker(node)}
                      {node.incomer_under_protected && (
                        <span style={{ marginLeft: 6 }}>
                          <Badge variant="warning">under-rated</Badge>
                        </span>
                      )}
                    </Td>

                    {/* Scope status */}
                    <Td>
                      {details ? (
                        <Badge
                          variant={details.scope_status === 'received' ? 'success' : 'warning'}
                        >
                          {details.scope_status}
                        </Badge>
                      ) : (
                        <Badge variant="ghost">—</Badge>
                      )}
                    </Td>

                    {/* Beneficial occupation */}
                    <Td>
                      <BoPeriodSelect
                        projectId={projectId}
                        nodeId={node.id}
                        value={tenantBoByNode[node.id]?.boPeriodDays ?? null}
                      />
                    </Td>
                    <Td>
                      <BoDateCell
                        projectId={projectId}
                        nodeId={node.id}
                        effectiveDate={tenantBoByNode[node.id]?.effectiveDate ?? null}
                        isOverride={tenantBoByNode[node.id]?.boDateOverride != null}
                      />
                    </Td>

                    {/* Per-scope-item party cells */}
                    {scopeItemTypes.map((t) => {
                      const item = nodeItems.find((i) => i.scope_item_type_id === t.id)
                      return (
                        <Td key={t.id}>
                          {item ? (
                            <Badge variant={item.party === 'landlord' ? 'info' : 'warning'}>
                              {item.party === 'landlord' ? 'LL' : 'T'}
                            </Badge>
                          ) : (
                            <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>—</span>
                          )}
                        </Td>
                      )
                    })}

                    {/* Per-scope-item order-status cells */}
                    {scopeItemTypes.map((t) => (
                      <Td key={`order-${t.id}`}>
                        <NodeOrderCell
                          order={ordersByNodeAndScope[`${node.id}:${t.id}`] ?? null}
                          projectId={projectId}
                        />
                      </Td>
                    ))}

                    {/* Layout status */}
                    <Td>
                      {layoutDetails ? (
                        <Badge
                          variant={layoutDetails.layout_status === 'issued' ? 'success' : 'ghost'}
                        >
                          {layoutDetails.layout_status === 'issued' ? 'issued' : 'not issued'}
                        </Badge>
                      ) : (
                        <Badge variant="ghost">—</Badge>
                      )}
                    </Td>

                    {/* Node status */}
                    <Td>
                      {decommissioned ? (
                        <Badge variant="ghost">decommissioned</Badge>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                    </Td>

                    {/* Actions: scope + layout buttons */}
                    <Td>
                      {!decommissioned && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setEditingNode(node)}
                            title={`Edit ${node.shop_number ?? node.code}`}
                            style={{
                              background: 'none',
                              border: '1px solid var(--c-border)',
                              borderRadius: 5,
                              cursor: 'pointer',
                              padding: '4px 10px',
                              fontSize: 11,
                              color: 'var(--c-text-dim)',
                              fontWeight: 600,
                              transition: 'all 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleScope(node.id)}
                            style={{
                              background: isExpanded ? 'var(--c-amber-dim)' : 'none',
                              border: '1px solid',
                              borderColor: isExpanded ? 'var(--c-amber)' : 'var(--c-border)',
                              borderRadius: 5,
                              cursor: 'pointer',
                              padding: '4px 10px',
                              fontSize: 11,
                              color: isExpanded ? 'var(--c-amber)' : 'var(--c-text-dim)',
                              fontWeight: 600,
                              transition: 'all 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isExpanded ? 'Close' : 'Scope ↓'}
                          </button>
                          <button
                            onClick={() => toggleLayout(node.id)}
                            style={{
                              background: isLayoutExpanded ? 'var(--c-blue-dim)' : 'none',
                              border: '1px solid',
                              borderColor: isLayoutExpanded ? 'var(--c-blue)' : 'var(--c-border)',
                              borderRadius: 5,
                              cursor: 'pointer',
                              padding: '4px 10px',
                              fontSize: 11,
                              color: isLayoutExpanded ? 'var(--c-blue)' : 'var(--c-text-dim)',
                              fontWeight: 600,
                              transition: 'all 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isLayoutExpanded ? 'Close' : 'Layout ↓'}
                          </button>
                          <TenantRecycleButton
                            projectId={projectId}
                            nodeId={node.id}
                            code={node.code}
                          />
                        </div>
                      )}
                    </Td>
                  </tr>

                  {/* Expanded scope-of-work panel */}
                  {isExpanded && (
                    <tr>
                      <td
                        colSpan={11 + scopeItemTypes.length * 2}
                        style={{ padding: 0 }}
                      >
                        <ScopeOfWorkPanel
                          projectId={projectId}
                          nodeId={node.id}
                          shopName={node.shop_name ?? node.name}
                          scopeItemTypes={scopeItemTypes}
                          scopeItems={nodeItems}
                          tenantDetails={details}
                          onClose={() => setExpandedNodeId(null)}
                        />
                      </td>
                    </tr>
                  )}

                  {/* Expanded layout-issued panel */}
                  {isLayoutExpanded && (
                    <tr>
                      <td
                        colSpan={11 + scopeItemTypes.length * 2}
                        style={{ padding: 0 }}
                      >
                        <LayoutIssuedPanel
                          projectId={projectId}
                          nodeId={node.id}
                          shopName={node.shop_name ?? node.name}
                          layoutDetails={layoutDetails}
                          onClose={() => setExpandedLayoutNodeId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </TableScrollX>

      <p
        style={{
          marginTop: 8,
          fontSize: 11,
          color: 'var(--c-text-dim)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {activeNodes.length} active shop{activeNodes.length !== 1 ? 's' : ''}
        {decomNodes.length > 0 && ` · ${decomNodes.length} decommissioned`}
      </p>

      {/* Recycle bin — soft-deleted tenants, restorable or permanently deletable */}
      {deletedNodes.length > 0 && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--c-border)', paddingTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowRecycleBin((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--c-text-mid)',
            }}
            aria-expanded={showRecycleBin}
          >
            <span style={{ transition: 'transform 0.15s', transform: showRecycleBin ? 'rotate(90deg)' : 'none' }}>▸</span>
            Recycle bin ({deletedNodes.length})
          </button>

          {showRecycleBin && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sortedDeleted.map((node) => (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'var(--c-panel)',
                    border: '1px solid var(--c-border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text)' }}>
                      {node.code}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--c-text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.shop_name ?? node.name ?? '—'}
                    </span>
                    <Badge variant="ghost">in bin</Badge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TenantRestoreButton projectId={projectId} nodeId={node.id} />
                    <button
                      type="button"
                      onClick={() => setDeletingNode({ id: node.id, code: node.code })}
                      title={`Permanently delete ${node.code}`}
                      style={{
                        background: 'none',
                        border: '1px solid var(--c-red)',
                        borderRadius: 5,
                        cursor: 'pointer',
                        padding: '4px 10px',
                        fontSize: 11,
                        color: 'var(--c-red)',
                        fontWeight: 600,
                        transition: 'all 0.15s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Delete permanently
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add scope item modal */}
      {showAddModal && (
        <AddScopeItemModal
          projectId={projectId}
          orgId={orgId}
          onClose={() => setShowAddModal(false)}
          onAdded={handleScopeItemAdded}
        />
      )}

      {/* Tenant hard-delete confirmation modal */}
      {deletingNode && (
        <TenantDeleteModal
          projectId={projectId}
          nodeId={deletingNode.id}
          code={deletingNode.code}
          onClose={() => setDeletingNode(null)}
        />
      )}

      {/* Tenant entry edit modal (shop number / name / GLA) */}
      {editingNode && (
        <TenantEditModal
          projectId={projectId}
          node={editingNode}
          onClose={() => setEditingNode(null)}
        />
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '8px 12px',
        textAlign: 'left',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--c-text-dim)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: '9px 12px',
        color: 'var(--c-text)',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontSize: mono ? 12 : 13,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  )
}

/**
 * Breaker for display: a manually-set node value (mostly boards) wins; otherwise
 * the derived incomer breaker. Poles append when known (e.g. "63 A TP").
 */
function formatBreaker(node: Node): string {
  const a = node.breaker_rating_a ?? node.incomer_breaker_a
  if (a == null) return '—'
  const poles = node.pole_config ?? node.incomer_pole_config
  return poles ? `${a} A ${poles}` : `${a} A`
}
