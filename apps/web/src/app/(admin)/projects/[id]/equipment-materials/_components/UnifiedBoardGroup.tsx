'use client'

/**
 * UnifiedBoardGroup — one collapsible category card on the Equipment & Materials
 * tab. Mirrors the Materials tab's MaterialOrderGroup: a chevron-toggle header
 * over a table body. Groups start collapsed.
 *
 * Rows are BoardRow — a master board row that expands to a procurement detail.
 */

import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TableScrollX } from '@/components/ui/TableScrollX'
import type { UnifiedGroup } from '../_lib/gather-unified-boards'
import { BoardRow } from './BoardRow'

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
  group: UnifiedGroup
  projectId: string
  /** All node codes on the project — passed to BoardRow's Edit form for the uniqueness check. */
  existingCodes: string[]
}

export function UnifiedBoardGroup({ group, projectId, existingCodes }: Props) {
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
            {group.label}
          </button>
          <Badge variant="ghost">{group.boards.length}</Badge>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardBody>
          <TableScrollX style={{ margin: '-14px -18px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-panel-alt, var(--c-panel))' }}>
                  <th style={th}>Code</th>
                  <th style={th}>Name</th>
                  <th style={th}>Procurement</th>
                  <th style={th}>Required by</th>
                  <th style={th}>COC</th>
                  <th style={th}>Manage</th>
                </tr>
              </thead>
              <tbody>
                {group.boards.map((board) => (
                  <BoardRow key={board.nodeId} board={board} projectId={projectId} existingCodes={existingCodes} />
                ))}
              </tbody>
            </table>
          </TableScrollX>
        </CardBody>
      )}
    </Card>
  )
}
