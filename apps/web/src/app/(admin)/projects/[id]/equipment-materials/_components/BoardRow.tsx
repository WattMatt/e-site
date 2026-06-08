'use client'

/**
 * BoardRow — one master board row on the Equipment & Materials tab.
 *
 * Code · Name · Procurement summary · Required by (RAG) · COC · Manage.
 * Clicking the row toggles an expanded full-width detail row (BoardDetail).
 *
 * Equipment boards show a status badge + an "Equipment Schedule ↗" deep-link;
 * tenant boards show the scope rollup + a "Tenant Schedule ↗" deep-link. Board
 * authoring (add/edit/decommission, scope, drawings) lives on those tabs.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import type { ProcStatus, UnifiedBoard } from '../_lib/gather-unified-boards'
import { BoardDetail } from './BoardDetail'

const RAG_COLOR: Record<UnifiedBoard['summary']['rag'], string> = {
  red: 'var(--c-red)',
  amber: 'var(--c-amber)',
  green: 'var(--c-green)',
  neutral: 'var(--c-text-dim)',
}

const RAG_TITLE: Record<UnifiedBoard['summary']['rag'], string> = {
  red: 'Overdue',
  amber: 'Due soon',
  green: 'On track',
  neutral: 'No deadline',
}

function statusBadge(status: ProcStatus | 'none') {
  const map: Record<
    ProcStatus | 'none',
    { variant: 'ghost' | 'warning' | 'info' | 'success'; label: string }
  > = {
    none: { variant: 'ghost', label: '—' },
    by_tenant: { variant: 'ghost', label: 'By tenant' },
    required: { variant: 'warning', label: 'Required' },
    ordered: { variant: 'info', label: 'Ordered' },
    received: { variant: 'success', label: 'Received' },
  }
  const { variant, label } = map[status] ?? { variant: 'ghost', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' }

export function BoardRow({ board, projectId }: { board: UnifiedBoard; projectId: string }) {
  const [expanded, setExpanded] = useState(false)
  const isTenant = board.type === 'tenant'

  return (
    <>
      <tr
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          borderBottom: '1px solid var(--c-border)',
          cursor: 'pointer',
          opacity: board.status === 'decommissioned' ? 0.55 : 1,
        }}
      >
        {/* Code */}
        <td style={{ ...td, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 10,
                color: 'var(--c-text-dim)',
                transition: 'transform 0.15s',
                display: 'inline-block',
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
            >
              ▼
            </span>
            {board.code}
          </span>
        </td>
        {/* Name */}
        <td style={{ ...td, fontSize: 13, color: 'var(--c-text-mid)' }}>
          {board.name || <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
        </td>
        {/* Procurement summary */}
        <td style={td}>
          {isTenant ? (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--c-text-mid)' }}>
              {board.summary.rollup ?? <span style={{ color: 'var(--c-text-dim)' }}>No scope orders</span>}
            </span>
          ) : (
            statusBadge(board.summary.status)
          )}
        </td>
        {/* Required by */}
        <td style={{ ...td, fontSize: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {board.summary.requiredBy ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                title={RAG_TITLE[board.summary.rag]}
                style={{ width: 8, height: 8, borderRadius: '50%', background: RAG_COLOR[board.summary.rag], flexShrink: 0 }}
              />
              <span style={{ color: board.summary.rag === 'red' ? 'var(--c-red)' : 'var(--c-text-mid)' }}>
                {board.summary.requiredBy}
              </span>
            </span>
          ) : (
            <span style={{ color: 'var(--c-text-dim)' }}>—</span>
          )}
        </td>
        {/* COC */}
        <td style={td}>
          {board.cocRequired ? (
            <Badge variant="info">COC</Badge>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>—</span>
          )}
        </td>
        {/* Manage — deep-link to the authoring tab */}
        <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          {isTenant ? (
            <Link
              href={`/projects/${projectId}/tenant-schedule`}
              style={{ fontSize: 12, color: 'var(--c-amber)' }}
            >
              Tenant Schedule ↗
            </Link>
          ) : (
            <Link
              href={`/projects/${projectId}/equipment-schedule`}
              style={{ fontSize: 12, color: 'var(--c-amber)' }}
            >
              Equipment Schedule ↗
            </Link>
          )}
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-panel)' }}>
          <td colSpan={6} style={{ padding: 0 }}>
            <BoardDetail board={board} projectId={projectId} />
          </td>
        </tr>
      )}
    </>
  )
}
