'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  issueRevisionAction,
  deleteDraftRevisionAction,
} from '@/actions/cable-revision.actions'

export interface RevisionRow {
  id: string
  code: string
  description: string | null
  status: 'DRAFT' | 'ISSUED' | 'SUPERSEDED'
  issued_at: string | null
  issued_by: string | null
  change_notes: string | null
  created_at: string
}

const STATUS_TONE: Record<RevisionRow['status'], string> = {
  DRAFT: 'badge-warning',
  ISSUED: 'badge-success',
  SUPERSEDED: 'badge-muted',
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function RevisionsList({
  projectId,
  revisions,
}: {
  projectId: string
  revisions: RevisionRow[]
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function onIssue(id: string) {
    const notes = window.prompt('Change notes for this issue (markdown, optional):') || null
    setPendingId(id)
    startTransition(async () => {
      const res = await issueRevisionAction({ revisionId: id, changeNotes: notes })
      setPendingId(null)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function onDelete(id: string) {
    if (!confirm('Discard this DRAFT revision? All sources, boards, supplies, cables and cost lines are deleted.')) return
    setPendingId(id)
    startTransition(async () => {
      const res = await deleteDraftRevisionAction(id)
      setPendingId(null)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div>
      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}
      <div className="data-panel" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <Th>Revision</Th>
              <Th>Status</Th>
              <Th>Description</Th>
              <Th>Created</Th>
              <Th>Issued</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/projects/${projectId}/cables/${r.id}`)}
                onMouseEnter={() => setHoveredId(r.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  borderTop: '1px solid var(--c-border)',
                  borderLeft: r.status === 'DRAFT' ? '3px solid var(--c-amber)' : '3px solid transparent',
                  background: hoveredId === r.id ? 'var(--c-elevated)' : undefined,
                  cursor: 'pointer',
                }}
              >
                <Td mono>
                  <Link
                    href={`/projects/${projectId}/cables/${r.id}`}
                    style={{ color: 'var(--c-amber)', fontWeight: 600, textDecoration: 'none' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.code}
                  </Link>
                </Td>
                <Td>
                  <span className={`badge ${STATUS_TONE[r.status]}`}>{r.status}</span>
                </Td>
                <Td>{r.description ?? '—'}</Td>
                <Td mono>{fmtDate(r.created_at)}</Td>
                <Td mono>{fmtDate(r.issued_at)}</Td>
                <Td align="right">
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    {r.status === 'DRAFT' && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onIssue(r.id) }}
                          disabled={pendingId === r.id}
                          style={{ ...actionBtn, color: '#16a34a' }}
                        >
                          ✓ Issue
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onDelete(r.id) }}
                          disabled={pendingId === r.id}
                          style={{ ...actionBtn, color: '#dc2626' }}
                        >
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                  <span
                    aria-hidden="true"
                    style={{
                      marginLeft: 10, fontFamily: 'var(--font-mono)', fontSize: 11,
                      color: hoveredId === r.id ? 'var(--c-amber)' : 'var(--c-text-dim)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Open →
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  color: 'var(--c-text-mid)',
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '10px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--c-text-dim)',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
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
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '10px 12px',
        verticalAlign: 'top',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontSize: mono ? 12 : 13,
        color: 'var(--c-text)',
      }}
    >
      {children}
    </td>
  )
}
