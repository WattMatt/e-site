'use client'

/**
 * MaterialOrderGroup — one collapsible category card on the Material Order Tracker.
 *
 * The Materials page is a server component, so the collapse state lives here.
 * The collapse UX mirrors the Equipment Schedule's KindGroup — a chevron-toggle
 * header over the table body. Groups start collapsed.
 */

import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { OrderRow, type OrderRowData } from './OrderRow'

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
}

interface Props {
  label: string
  rows: OrderRowData[]
  projectId: string
}

export function MaterialOrderGroup({ label, rows, projectId }: Props) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--c-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--c-text-dim)',
                transition: 'transform 0.15s',
                display: 'inline-block',
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}
            >
              ▼
            </span>
            {label}
          </button>
          <Badge variant="ghost">{rows.length}</Badge>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardBody>
          <div style={{ overflowX: 'auto', margin: '-14px -18px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-panel-alt, var(--c-panel))' }}>
                  <th style={th}>Node</th>
                  <th style={th}>Label</th>
                  <th style={th}>Status</th>
                  <th style={th}>Required by</th>
                  <th style={th}>Ordered</th>
                  <th style={th}>Received</th>
                  <th style={th}>Documents</th>
                  <th style={th}>Notes</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <OrderRow key={order.id} order={order} projectId={projectId} />
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      )}
    </Card>
  )
}
