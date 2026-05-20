'use client'

import { useState, Fragment } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { Node } from '@esite/shared'
import { ScopeOfWorkPanel } from './ScopeOfWorkPanel'
import { AddScopeItemModal } from './AddScopeItemModal'
import type { ScopeItemType, TenantScopeItem, TenantDetails } from './ScopeOfWorkPanel'

interface Props {
  nodes: Node[]
  projectId: string
  orgId: string
  scopeItemTypes: ScopeItemType[]
  scopeItemsByNode: Record<string, TenantScopeItem[]>   // node_id → items
  tenantDetailsByNode: Record<string, TenantDetails>    // node_id → details
}

export function ScheduleTable({
  nodes,
  projectId,
  orgId,
  scopeItemTypes: initialScopeItemTypes,
  scopeItemsByNode,
  tenantDetailsByNode,
}: Props) {
  const [showDecommissioned, setShowDecommissioned] = useState(false)
  // node_id of the currently-expanded scope panel (one at a time)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
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
  }

  function handleScopeItemAdded(id: string, key: string, label: string) {
    setScopeItemTypes((prev) => {
      if (prev.some((t) => t.id === id)) return prev
      const nextOrder = prev.length > 0 ? Math.max(...prev.map((t) => t.sort_order)) + 1 : 10
      return [...prev, { id, key, label, sort_order: nextOrder }]
    })
  }

  if (nodes.length === 0) {
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

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
              <Th>Shop No.</Th>
              <Th>Tenant</Th>
              <Th>GLA (m²)</Th>
              <Th>DB Code</Th>
              <Th>Scope Status</Th>
              {/* One column per scope item type */}
              {scopeItemTypes.map((t) => (
                <Th key={t.id}>{t.label}</Th>
              ))}
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

              return (
                <Fragment key={node.id}>
                  <tr
                    style={{
                      borderBottom: isExpanded ? 'none' : '1px solid var(--c-border)',
                      opacity: decommissioned ? 0.45 : 1,
                      background: isExpanded ? 'var(--c-bg)' : undefined,
                    }}
                  >
                    <Td mono>{node.shop_number ?? '—'}</Td>
                    <Td>{node.shop_name ?? node.name ?? '—'}</Td>
                    <Td mono>
                      {node.shop_area_m2 != null ? node.shop_area_m2.toLocaleString() : '—'}
                    </Td>
                    <Td mono>{node.code}</Td>

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

                    {/* Node status */}
                    <Td>
                      {decommissioned ? (
                        <Badge variant="ghost">decommissioned</Badge>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                    </Td>

                    {/* Scope action */}
                    <Td>
                      {!decommissioned && (
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
                      )}
                    </Td>
                  </tr>

                  {/* Expanded scope-of-work panel */}
                  {isExpanded && (
                    <tr>
                      <td
                        colSpan={7 + scopeItemTypes.length}
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
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

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

      {/* Add scope item modal */}
      {showAddModal && (
        <AddScopeItemModal
          projectId={projectId}
          orgId={orgId}
          onClose={() => setShowAddModal(false)}
          onAdded={handleScopeItemAdded}
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
