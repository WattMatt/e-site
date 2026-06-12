'use client'

/**
 * Client shell for the fault-source impedance register: a table of the existing
 * facets + an add/edit form (FaultSourceForm). Owns only the "which row is being
 * edited" selection; the form does the persistence and the page refresh keeps the
 * table in sync. Mirrors the CostSummaryTable split (server page loads, client
 * component drives interactivity).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { TableScrollX } from '@/components/ui/TableScrollX'
import { FaultSourceForm, type AttachOption, type ExistingFaultSource } from './FaultSourceForm'

interface Props {
  revisionId: string
  sources: ExistingFaultSource[]
  attachOptions: AttachOption[]
  /** node:<id> / source:<id> → display code, for the table's "attaches to" cell. */
  attachLabels: Record<string, string>
  locked: boolean
}

const ROLE_VARIANT: Record<ExistingFaultSource['role'], 'info' | 'success' | 'warning' | 'danger'> = {
  utility: 'info',
  transformer: 'success',
  generator: 'warning',
  inverter: 'danger',
}

export function FaultSourcesManager({ revisionId, sources, attachOptions, attachLabels, locked }: Props) {
  const router = useRouter()
  // null = the "add new" form; otherwise the id being edited.
  const [editingId, setEditingId] = useState<string | null>(null)

  const editing = editingId ? sources.find((s) => s.id === editingId) ?? null : null

  const attachLabel = (s: ExistingFaultSource): string => {
    const key = s.nodeId ? `node:${s.nodeId}` : s.sourceId ? `source:${s.sourceId}` : ''
    return attachLabels[key] ?? key
  }

  function onSaved() {
    setEditingId(null)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {sources.length > 0 && (
        <TableScrollX className="data-panel">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--c-base)' }}>
                <Th>Attaches to</Th>
                <Th>Role</Th>
                <Th align="right">Key impedance</Th>
                {!locked && <Th align="right">Edit</Th>}
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <Td><strong>{attachLabel(s)}</strong></Td>
                  <Td><Badge variant={ROLE_VARIANT[s.role]}>{s.role}</Badge></Td>
                  <Td align="right" mono>{summariseImpedance(s)}</Td>
                  {!locked && (
                    <Td align="right">
                      <button
                        type="button"
                        onClick={() => setEditingId(s.id)}
                        style={{
                          background: 'var(--c-panel)', border: '1px solid var(--c-border)',
                          color: 'var(--c-text-mid)', borderRadius: 4, padding: '4px 10px',
                          fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollX>
      )}

      {locked ? (
        <p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          Revision is read-only — start a new revision to change source impedances.
        </p>
      ) : (
        <div>
          {editing && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Editing existing source</span>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                style={{
                  background: 'none', border: '1px solid var(--c-border)', color: 'var(--c-text-dim)',
                  borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                }}
              >
                + New instead
              </button>
            </div>
          )}
          {/* key forces a fresh form instance (and defaultValues) per selection. */}
          <FaultSourceForm
            key={editingId ?? 'new'}
            revisionId={revisionId}
            attachOptions={attachOptions}
            initial={editing}
            locked={locked}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  )
}

function summariseImpedance(s: ExistingFaultSource): string {
  switch (s.role) {
    case 'utility':
      return s.sscMva != null ? `S″k ${s.sscMva} MVA${s.xrRatio != null ? ` · X/R ${s.xrRatio}` : ''}` : '—'
    case 'transformer':
      return s.ukPct != null ? `uk ${s.ukPct}%${s.vectorGroup ? ` · ${s.vectorGroup}` : ''}` : '—'
    case 'generator':
      return s.xdPct != null ? `x″d ${s.xdPct}%` : '—'
    case 'inverter':
      return s.sRatedVa != null ? `${s.sRatedVa} VA${s.currentLimitFactor != null ? ` · ×${s.currentLimitFactor}` : ''}` : '—'
    default:
      return '—'
  }
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-dim)',
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({
  children, align, mono,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'middle',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      fontSize: 12, color: 'var(--c-text)', whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}
