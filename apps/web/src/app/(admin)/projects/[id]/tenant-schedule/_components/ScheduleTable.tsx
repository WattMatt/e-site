'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import type { Node } from '@esite/shared'

interface Props {
  nodes: Node[]
}

export function ScheduleTable({ nodes }: Props) {
  const [showDecommissioned, setShowDecommissioned] = useState(false)

  const activeNodes = nodes.filter((n) => n.status !== 'decommissioned')
  const decomNodes = nodes.filter((n) => n.status === 'decommissioned')
  const displayed = showDecommissioned ? nodes : activeNodes

  // Sort: active first (by shop_number string), decommissioned at bottom
  const sorted = [...displayed].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1
    }
    const aNum = a.shop_number ?? a.code ?? ''
    const bNum = b.shop_number ?? b.code ?? ''
    return aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' })
  })

  if (nodes.length === 0) {
    return (
      <div style={{
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--c-text-dim)',
        background: 'var(--c-panel)',
        borderRadius: 8,
        border: '1px solid var(--c-border)',
      }}>
        <p style={{ marginBottom: 6, fontWeight: 600 }}>No shops imported yet</p>
        <p style={{ fontSize: 13 }}>Upload a tenant schedule .xlsx file to get started.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Filter bar */}
      {decomNodes.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--c-text-mid)' }}>
            <input
              type="checkbox"
              checked={showDecommissioned}
              onChange={(e) => setShowDecommissioned(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Show decommissioned ({decomNodes.length})
          </label>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
              <Th>Shop No.</Th>
              <Th>Tenant</Th>
              <Th>GLA (m²)</Th>
              <Th>DB Code</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((node) => {
              const decommissioned = node.status === 'decommissioned'
              return (
                <tr
                  key={node.id}
                  style={{
                    borderBottom: '1px solid var(--c-border)',
                    opacity: decommissioned ? 0.45 : 1,
                  }}
                >
                  <Td mono>{node.shop_number ?? '—'}</Td>
                  <Td>{node.shop_name ?? node.name ?? '—'}</Td>
                  <Td mono>{node.shop_area_m2 != null ? node.shop_area_m2.toLocaleString() : '—'}</Td>
                  <Td mono>{node.code}</Td>
                  <Td>
                    {decommissioned ? (
                      <Badge variant="ghost">decommissioned</Badge>
                    ) : (
                      <Badge variant="success">active</Badge>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
        {activeNodes.length} active shop{activeNodes.length !== 1 ? 's' : ''}
        {decomNodes.length > 0 && ` · ${decomNodes.length} decommissioned`}
      </p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      padding: '8px 12px',
      textAlign: 'left',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--c-text-dim)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td style={{
      padding: '9px 12px',
      color: 'var(--c-text)',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      fontSize: mono ? 12 : 13,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </td>
  )
}
