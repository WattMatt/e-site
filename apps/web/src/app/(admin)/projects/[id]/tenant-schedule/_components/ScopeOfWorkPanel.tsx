'use client'

/**
 * ScopeOfWorkPanel — per-tenant scope-of-work editor.
 *
 * Renders:
 *   1. READ-ONLY scope status display (auto-derived by the 00118 DB trigger)
 *   2. Scope documents (managed set via TenantDocumentList)
 *   3. Per-scope-item Landlord / Tenant radio grid
 *
 * Status is auto-derived from document/revision presence by the DB trigger.
 * The manual scope-status toggle was removed — it conflicted with the trigger
 * (spec §3.3).
 *
 * This is an "inline expand" panel — ScheduleTable renders it in a full-width
 * row below the tenant row when the user clicks the scope edit button.
 */

import { useState, useTransition } from 'react'
import { setScopeItemPartyAction } from '@/actions/tenant-scope.actions'
import { TenantDocumentList } from './TenantDocumentList'

// ---------------------------------------------------------------------------
// Types (local — structure schema isn't in generated DB types yet)
// ---------------------------------------------------------------------------

export interface ScopeItemType {
  id: string
  key: string
  label: string
  sort_order: number
}

export interface TenantScopeItem {
  id: string
  node_id: string
  scope_item_type_id: string
  party: 'landlord' | 'tenant'
}

export interface TenantDetails {
  node_id: string
  scope_status: 'awaited' | 'received'
}

interface Props {
  projectId: string
  nodeId: string
  shopName: string | null
  scopeItemTypes: ScopeItemType[]
  scopeItems: TenantScopeItem[]
  tenantDetails: TenantDetails | null
  onClose: () => void
}

// ---------------------------------------------------------------------------
// ScopeOfWorkPanel
// ---------------------------------------------------------------------------

export function ScopeOfWorkPanel({
  projectId,
  nodeId,
  shopName,
  scopeItemTypes,
  scopeItems: initialScopeItems,
  tenantDetails,
  onClose,
}: Props) {
  const [scopeItems, setScopeItems] = useState<TenantScopeItem[]>(initialScopeItems)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const scopeStatus = tenantDetails?.scope_status ?? 'awaited'

  // ── Scope item party toggle ───────────────────────────────────────────────

  function currentParty(typeId: string): 'landlord' | 'tenant' | null {
    return scopeItems.find((s) => s.scope_item_type_id === typeId)?.party ?? null
  }

  function handlePartyChange(typeId: string, party: 'landlord' | 'tenant') {
    setError(null)
    // Snapshot current state BEFORE the optimistic mutation so we can revert
    // to it (not to the stale mount-time prop) if the action fails.
    const snapshot = scopeItems
    setScopeItems((prev) => {
      const exists = prev.find((s) => s.scope_item_type_id === typeId)
      if (exists) {
        return prev.map((s) => (s.scope_item_type_id === typeId ? { ...s, party } : s))
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), node_id: nodeId, scope_item_type_id: typeId, party },
      ]
    })

    startTransition(async () => {
      const res = await setScopeItemPartyAction(projectId, nodeId, typeId, party)
      if ('error' in res) {
        setError(res.error)
        // Revert to the pre-mutation state, not the stale initial prop
        setScopeItems(snapshot)
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--c-bg)',
        borderTop: '1px solid var(--c-border)',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginRight: 8,
            }}
          >
            Scope of Work
          </span>
          {shopName && (
            <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{shopName}</span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--c-text-dim)',
            fontSize: 18,
            lineHeight: 1,
            padding: '2px 6px',
          }}
          aria-label="Close scope panel"
        >
          ×
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--c-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Section 1: Scope status display + document ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        {/* Status display (read-only — auto-derived by DB trigger) */}
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Scope Status
          </div>
          <div
            style={{
              display: 'inline-block',
              padding: '5px 12px',
              borderRadius: 5,
              border: '1px solid',
              fontSize: 12,
              fontWeight: 600,
              background:
                scopeStatus === 'received' ? 'var(--c-green-dim)' : 'var(--c-amber-dim)',
              borderColor:
                scopeStatus === 'received' ? 'var(--c-green)' : 'var(--c-amber)',
              color:
                scopeStatus === 'received' ? 'var(--c-green)' : 'var(--c-amber)',
            }}
          >
            {scopeStatus === 'received' ? 'Received' : 'Awaited'}
          </div>
        </div>

        {/* Scope documents (managed set) */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Scope Documents
          </div>
          <TenantDocumentList
            kind="scope"
            projectId={projectId}
            nodeId={nodeId}
            readOnly={false}
          />
        </div>
      </div>

      {/* ── Section 2: Landlord / Tenant scope grid ── */}
      {scopeItemTypes.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 10,
            }}
          >
            Scope Items
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            {scopeItemTypes.map((type) => {
              const party = currentParty(type.id)
              return (
                <div
                  key={type.id}
                  style={{
                    background: 'var(--c-panel)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 12,
                      color: 'var(--c-text)',
                      marginBottom: 8,
                    }}
                  >
                    {type.label}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['landlord', 'tenant'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePartyChange(type.id, p)}
                        disabled={isPending}
                        style={{
                          flex: 1,
                          padding: '4px 6px',
                          borderRadius: 4,
                          border: '1px solid',
                          cursor: isPending ? 'default' : 'pointer',
                          fontSize: 11,
                          fontWeight: 600,
                          transition: 'all 0.15s',
                          background:
                            party === p
                              ? p === 'landlord'
                                ? 'var(--c-blue-dim)'
                                : 'var(--c-amber-dim)'
                              : 'transparent',
                          borderColor:
                            party === p
                              ? p === 'landlord'
                                ? 'var(--c-blue)'
                                : 'var(--c-amber)'
                              : 'var(--c-border)',
                          color:
                            party === p
                              ? p === 'landlord'
                                ? 'var(--c-blue)'
                                : 'var(--c-amber)'
                              : 'var(--c-text-dim)',
                        }}
                      >
                        {p === 'landlord' ? 'LL' : 'T'}
                      </button>
                    ))}
                  </div>
                  {party && (
                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {party === 'landlord' ? 'Landlord scope' : 'By Tenant'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {scopeItemTypes.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
          No scope item types defined for this organisation yet.
        </div>
      )}
    </div>
  )
}
