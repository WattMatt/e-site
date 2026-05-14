'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addSourceAction, addBoardAction,
  deleteSourceAction, deleteBoardAction,
  renameSourceAction, renameBoardAction,
} from '@/actions/cable-entities.actions'

export interface PanelNode {
  id: string
  code: string
  category: 'source' | 'board'
  /** source.type or board.kind */
  nodeType: string
  /** count of supplies + cables that would cascade-delete with this node */
  blastSupplies: number
  blastCables: number
}

interface Props {
  revisionId: string
  nodes: PanelNode[]
  canEdit: boolean
}

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

export function StructurePanel({ revisionId, nodes, canEdit }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState<'source' | 'board' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PanelNode | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const sources = nodes.filter((n) => n.category === 'source')
  const boards = nodes.filter((n) => n.category === 'board')

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

  // Render helper, NOT a nested component — calling it inline avoids a
  // component boundary, so AddNodeForm's local state never remounts.
  const renderColumn = (
    which: 'source' | 'board',
    items: PanelNode[],
    emptyHint: string,
  ) => (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--c-text-mid)',
        }}>
          {which === 'source' ? 'Sources' : 'Boards'} ({items.length})
        </span>
        {canEdit && (
          <button type="button" className="btn-primary-amber"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setAdding(which)}>
            + Add {which}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontStyle: 'italic', margin: '4px 0 0' }}>
          {emptyHint}
        </p>
      ) : (
        items.map((n) => (
          <NodeRow key={n.id} node={n} canEdit={canEdit} pending={pending}
            onRename={(code) => run(() => n.category === 'source'
              ? renameSourceAction(n.id, code) : renameBoardAction(n.id, code))}
            onDelete={() => setConfirmDelete(n)} />
        ))
      )}
      {adding === which && (
        <AddNodeForm category={which} revisionId={revisionId} pending={pending}
          onCancel={() => setAdding(null)}
          onSubmit={(payload) => run(() => which === 'source'
            ? addSourceAction(payload as never) : addBoardAction(payload as never))} />
      )}
    </div>
  )

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Structure</h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '2px 0 0' }}>
          Where power comes from, and the boards it feeds. Build this first, then wire up cables below.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(220,38,38,0.1)', color: '#dc2626', fontSize: 12 }}>✕ {error}</div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {renderColumn('source', sources,
          'Start here — add where power comes from (a council RMU, generator, etc.).')}
        {renderColumn('board', boards,
          'Add the boards power is distributed to (main boards, sub boards, minisubs).')}
      </div>

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
              Removing <strong>{confirmDelete.code}</strong> ({TYPE_LABEL[confirmDelete.nodeType]}) will also
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

function NodeRow({
  node, canEdit, pending, onRename, onDelete,
}: {
  node: PanelNode; canEdit: boolean; pending: boolean
  onRename: (code: string) => void; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(node.code)
  const escapeRef = useRef(false)
  useEffect(() => { setCode(node.code) }, [node.code])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      {editing ? (
        <input className="ob-input" value={code} autoFocus style={{ width: 200 }}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => {
            if (escapeRef.current) { escapeRef.current = false; setEditing(false); return }
            setEditing(false)
            const trimmed = code.trim()
            if (trimmed && trimmed !== node.code) onRename(trimmed)
            setCode(node.code)  // revert local draft; the [node.code] effect re-syncs to the new name on success
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { escapeRef.current = true; setCode(node.code); setEditing(false) }
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }} />
      ) : (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, minWidth: 200 }}>
          {node.code}
        </span>
      )}
      {canEdit && !editing && (
        <>
          <button type="button" onClick={() => setEditing(true)} disabled={pending}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 11 }}>
            rename
          </button>
          <button type="button" onClick={onDelete} disabled={pending}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11 }}>
            remove
          </button>
        </>
      )}
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
