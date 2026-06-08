'use client'

/**
 * BoardRow — one master board row on the Equipment & Materials tab.
 *
 * Code · Name · Procurement summary · Required by (RAG) · COC · Manage.
 * Clicking the row toggles an expanded full-width detail row (BoardDetail).
 *
 * Equipment boards manage inline in the Manage cell: Edit / Decommission while
 * active, Reactivate once decommissioned (board authoring lives here now, not on
 * a separate Equipment Schedule tab). Tenant boards keep the scope rollup + a
 * "Tenant Schedule ↗" deep-link (scope/drawings/BO authoring stays there).
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { reactivateEquipmentNodeAction } from '@/actions/equipment.actions'
import type { ProcStatus, UnifiedBoard } from '../_lib/gather-unified-boards'
import { BoardDetail } from './BoardDetail'
import { EditBoardModal, DecommissionBoardModal } from './BoardManageModals'

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

/** Manage cell for an equipment board — inline Edit / Decommission / Reactivate. */
function EquipmentManage({
  board,
  projectId,
  existingCodes,
}: {
  board: UnifiedBoard
  projectId: string
  existingCodes: string[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [decommissioning, setDecommissioning] = useState(false)
  const [reactivateError, setReactivateError] = useState<string | null>(null)
  const [isReactivating, startReactivate] = useTransition()

  function handleReactivate() {
    setReactivateError(null)
    startReactivate(async () => {
      const result = await reactivateEquipmentNodeAction(projectId, board.nodeId)
      if ('error' in result) { setReactivateError(result.error); return }
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {board.status === 'active' ? (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDecommissioning(true)}
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
            isLoading={isReactivating}
            disabled={isReactivating}
            onClick={handleReactivate}
          >
            Reactivate
          </Button>
        )}
      </div>
      {reactivateError && (
        <span style={{ fontSize: 11, color: 'var(--c-red)' }} role="alert">{reactivateError}</span>
      )}

      {editing && (
        <EditBoardModal
          board={board}
          projectId={projectId}
          existingCodes={existingCodes.filter((c) => c !== board.code)}
          onClose={() => setEditing(false)}
        />
      )}
      {decommissioning && (
        <DecommissionBoardModal
          board={board}
          projectId={projectId}
          onClose={() => setDecommissioning(false)}
        />
      )}
    </div>
  )
}

export function BoardRow({
  board,
  projectId,
  existingCodes,
}: {
  board: UnifiedBoard
  projectId: string
  existingCodes: string[]
}) {
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
        {/* Manage — equipment manages inline; tenant deep-links to authoring */}
        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
          {isTenant ? (
            <Link
              href={`/projects/${projectId}/tenant-schedule`}
              style={{ fontSize: 12, color: 'var(--c-amber)' }}
            >
              Tenant Schedule ↗
            </Link>
          ) : (
            <EquipmentManage board={board} projectId={projectId} existingCodes={existingCodes} />
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
