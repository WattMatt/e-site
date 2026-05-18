'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { StructureTreeNode } from '@esite/shared'
import {
  addSourceAction, addBoardAction,
  deleteSourceAction, deleteBoardAction,
  renameSourceAction, renameBoardAction,
} from '@/actions/cable-entities.actions'

const SOURCE_TYPES = [
  { value: 'COUNCIL_RMU', label: 'Council RMU' },
  { value: 'UTILITY', label: 'Utility' },
  { value: 'PV', label: 'PV plant' },
  { value: 'STANDBY', label: 'Standby generator' },
]
const BOARD_KINDS = [
  { value: 'CONSUMER_RMU', label: 'Consumer RMU' },
  { value: 'TRANSFORMER', label: 'Transformer / Minisub' },
  { value: 'MAIN_BOARD', label: 'Main board' },
  { value: 'SUB_BOARD', label: 'Sub board' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  [...SOURCE_TYPES, ...BOARD_KINDS].map((t) => [t.value, t.label]),
)

interface Props {
  projectId: string
  revisionId: string
  roots: StructureTreeNode[]
  unfed: StructureTreeNode[]
  canEdit: boolean
  /** Emits a CableForm "From" key (`source:<id>` / `board:<id>`) when "+ feed a board" is clicked. */
  onFeedBoard: (fromKey: string) => void
}

export function StructurePanel({ projectId, revisionId, roots, unfed, canEdit, onFeedBoard }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState<'source' | 'board' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<StructureTreeNode | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      setAdding(null)
      setConfirmDelete(null)
      router.refresh()
    })
  }

  const onRename = (node: StructureTreeNode, code: string) =>
    run(() => node.category === 'source'
      ? renameSourceAction(node.id, code)
      : renameBoardAction(node.id, code))

  const empty = roots.length === 0 && unfed.length === 0

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Structure</h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '2px 0 0' }}>
          Where power comes from, and the boards it feeds. Each branch is a cable — use "+ feed a board" to extend it.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(220,38,38,0.1)', color: '#dc2626', fontSize: 12 }}>✕ {error}</div>
      )}

      {empty ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontStyle: 'italic', margin: '4px 0 0' }}>
          Start here — add where power comes from (a council RMU, generator, etc.), then "+ feed a board" to wire the structure.
        </p>
      ) : (
        <>
          {roots.map((n) => (
            <TreeNode key={n.id} node={n} depth={0} canEdit={canEdit} pending={pending} projectId={projectId}
              onRename={onRename} onDelete={setConfirmDelete} onFeedBoard={onFeedBoard} />
          ))}
          {unfed.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 4 }}>
                Unfed — not yet on any feed
              </div>
              {unfed.map((n) => (
                <TreeNode key={n.id} node={n} depth={0} canEdit={canEdit} pending={pending}
                  onRename={onRename} onDelete={setConfirmDelete} onFeedBoard={onFeedBoard} />
              ))}
            </div>
          )}
        </>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn-primary-amber"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setAdding('source')}>+ Add source</button>
          <button type="button" className="btn-primary-amber"
            style={{ fontSize: 11, padding: '4px 10px', background: 'var(--c-panel)',
              border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
            onClick={() => setAdding('board')}>+ Add board (unfed)</button>
        </div>
      )}
      {adding && (
        <AddNodeForm category={adding} revisionId={revisionId} pending={pending}
          onCancel={() => setAdding(null)}
          onSubmit={(payload) => run(() => adding === 'source'
            ? addSourceAction(payload as never) : addBoardAction(payload as never))} />
      )}

      {confirmDelete && (
        <div role="dialog" aria-modal="true" aria-labelledby="structure-del-title"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirmDelete(null) }}
          tabIndex={-1}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="data-panel" style={{ padding: 16, minWidth: 340, maxWidth: 460,
            display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c-panel)' }}>
            <h3 id="structure-del-title" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Remove {confirmDelete.category}</h3>
            <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>
              Removing <strong>{confirmDelete.code}</strong> ({TYPE_LABEL[confirmDelete.nodeType] ?? confirmDelete.nodeType}) will also
              delete <strong>{confirmDelete.blastSupplies}</strong> suppl{confirmDelete.blastSupplies === 1 ? 'y' : 'ies'} and{' '}
              <strong>{confirmDelete.blastCables}</strong> cable{confirmDelete.blastCables === 1 ? '' : 's'}.
              {confirmDelete.category === 'board' && ' Child boards re-parent to top-level.'} Continue?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setConfirmDelete(null)} className="btn-primary-amber"
                autoFocus
                style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
                Cancel
              </button>
              <button type="button" disabled={pending} className="btn-primary-amber"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => run(() => confirmDelete.category === 'source'
                  ? deleteSourceAction(confirmDelete.id) : deleteBoardAction(confirmDelete.id))}>
                {pending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TreeNode({
  node, depth, canEdit, pending, projectId, onRename, onDelete, onFeedBoard,
}: {
  node: StructureTreeNode
  depth: number
  canEdit: boolean
  pending: boolean
  projectId: string
  onRename: (node: StructureTreeNode, code: string) => void
  onDelete: (node: StructureTreeNode) => void
  onFeedBoard: (fromKey: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(node.code)
  const escapeRef = useRef(false)
  useEffect(() => { setCode(node.code) }, [node.code])

  // Single-char glyph icons (text — not emoji — so they render at the row's
  // font size, line up, and don't dominate the row).
  const icon = node.category === 'source' ? '◆' : '▪'
  const iconColor = node.category === 'source'
    ? 'var(--c-amber)'
    : node.alsoFedElsewhere ? 'var(--c-text-dim)' : 'var(--c-text-mid)'
  const f = node.feedSummary

  // Inline action-button style — gives the actions visible breathing room and
  // a subtle hover affordance so they no longer mash into the node code.
  const actionBtnBase = {
    background: 'none',
    border: '1px solid transparent',
    cursor: 'pointer',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 4,
    lineHeight: 1.4,
  } as const

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', paddingLeft: depth * 22 }}>
        <span aria-hidden="true" style={{
          color: iconColor, fontFamily: 'var(--font-mono)', fontSize: 12,
          width: 14, display: 'inline-block', textAlign: 'center',
        }}>{icon}</span>
        {editing ? (
          <input className="ob-input" value={code} autoFocus style={{ width: 200 }}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => {
              if (escapeRef.current) { escapeRef.current = false; setEditing(false); return }
              setEditing(false)
              const trimmed = code.trim()
              if (trimmed && trimmed !== node.code) onRename(node, trimmed)
              setCode(node.code)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { escapeRef.current = true; setCode(node.code); setEditing(false) }
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }} />
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{node.code}</span>
        )}
        {f && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            ← {f.cableCount > 0 ? f.sizeLabel : 'no cable'}
            {f.vdPct ? ` · ${f.vdPct.toFixed(1)}% VD` : ''}
            {f.underRated && <span style={{ color: 'var(--c-red)', fontWeight: 700 }}> ⚠ under-rated</span>}
          </span>
        )}
        {node.alsoFedElsewhere && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
            ↻ also fed elsewhere
          </span>
        )}
        {node.ringClosesBackTo && (
          <span
            title={`Ring main closure — the cable from this node feeds back to ${node.ringClosesBackTo}, completing the ring.`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--c-amber)', fontStyle: 'italic', cursor: 'help',
            }}
          >
            ↻ closes ring back to {node.ringClosesBackTo}
          </span>
        )}
        {/* Spacer pushes the actions to the right of the row — clear visual
            separation from the node code + edge label. */}
        <div style={{ flex: 1 }} />
        {!editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Link
              href={`/projects/${projectId}/inspections/new?target_node_type=${node.category}&target_node_id=${node.id}`}
              style={{ ...actionBtnBase, color: 'var(--c-amber)', textDecoration: 'none' }}
              title={`Create a new inspection against this ${node.category}`}
            >
              + inspection
            </Link>
            {canEdit && !node.alsoFedElsewhere && (
              <>
                <button type="button" onClick={() => onFeedBoard(`${node.category}:${node.id}`)} disabled={pending}
                  style={{ ...actionBtnBase, color: 'var(--c-amber)', fontWeight: 600 }}>
                  + feed a board
                </button>
                <button type="button" onClick={() => setEditing(true)} disabled={pending}
                  style={{ ...actionBtnBase, color: 'var(--c-text-dim)' }}>
                  rename
                </button>
                <button type="button" onClick={() => onDelete(node)} disabled={pending}
                  style={{ ...actionBtnBase, color: '#dc2626' }}>
                  remove
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {!node.alsoFedElsewhere && node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} canEdit={canEdit} pending={pending} projectId={projectId}
          onRename={onRename} onDelete={onDelete} onFeedBoard={onFeedBoard} />
      ))}
    </div>
  )
}

function AddNodeForm({
  category, revisionId, pending, onCancel, onSubmit,
}: {
  category: 'source' | 'board'
  revisionId: string
  pending: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const types = category === 'source' ? SOURCE_TYPES : BOARD_KINDS
  const [code, setCode] = useState('')
  const [nodeType, setNodeType] = useState(types[0].value)
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--c-border)', borderRadius: 6,
      display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div>
        <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>Code *</label>
        <input className="ob-input" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder={category === 'source' ? 'COUNCIL RMU 1' : 'MAIN BOARD 1'} maxLength={80} />
      </div>
      <div>
        <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>Type *</label>
        <select className="ob-input" value={nodeType} onChange={(e) => setNodeType(e.target.value)}>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <button type="button" onClick={onCancel} className="btn-primary-amber"
        style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
        Cancel
      </button>
      <button type="button" disabled={pending || code.trim().length < 1} className="btn-primary-amber"
        onClick={() => onSubmit(category === 'source'
          ? { revisionId, code: code.trim(), type: nodeType }
          : { revisionId, code: code.trim(), kind: nodeType })}>
        {pending ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}
