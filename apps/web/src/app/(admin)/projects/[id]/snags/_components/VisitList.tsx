'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { VisitForm } from './VisitForm'

// ─── Types ───────────────────────────────────────────────────────────────────

type Member = { user_id: string; full_name: string | null; email: string | null }

export interface VisitRow {
  id: string
  visit_no: number
  is_backlog: boolean
  visit_date: string
  conducted_by: string | null
  conducted_by_name?: string | null
  title?: string | null
  newCount: number
  openCount: number
  closedCount: number
}

interface Props {
  projectId: string
  visits: VisitRow[]
  currentUserId: string
  members: Member[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatVisitDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VisitList({ projectId, visits, currentUserId, members }: Props) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div>
      {/* Header row: count + start button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            letterSpacing: '0.04em',
          }}
        >
          {visits.length} visit{visits.length !== 1 ? 's' : ''}
        </span>
        {!showForm && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowForm(true)}
          >
            + Start site visit
          </Button>
        )}
      </div>

      {/* Inline create form */}
      {showForm && (
        <VisitForm
          mode="create"
          projectId={projectId}
          currentUserId={currentUserId}
          members={members}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Visit cards */}
      {visits.length === 0 && !showForm ? (
        <div
          className="data-panel"
          style={{
            padding: '48px 18px',
            textAlign: 'center',
            color: 'var(--c-text-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}
        >
          No site visits yet — start the first one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visits.map((visit) => (
            <VisitCard key={visit.id} visit={visit} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Visit Card ──────────────────────────────────────────────────────────────

function VisitCard({ visit, projectId }: { visit: VisitRow; projectId: string }) {
  const title = visit.is_backlog
    ? 'Initial backlog'
    : visit.title
      ? `Site Visit ${visit.visit_no} — ${visit.title}`
      : `Site Visit ${visit.visit_no}`

  const href = `/projects/${projectId}/snags/visits/${visit.id}`

  return (
    <Link
      href={href}
      style={{
        display: 'block',
        textDecoration: 'none',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: '14px 18px',
        transition: 'border-color 0.12s',
        ...(visit.is_backlog ? { opacity: 0.75 } : {}),
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--c-amber-mid)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--c-border)'
      }}
    >
      {/* Top row: title + count chips */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: visit.is_backlog ? 'var(--c-text-dim)' : 'var(--c-text)',
          }}
        >
          {title}
        </span>

        {/* Count chips */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          {visit.newCount > 0 && (
            <Badge variant="info">{visit.newCount} new</Badge>
          )}
          {visit.openCount > 0 && (
            <Badge variant="warning">{visit.openCount} open</Badge>
          )}
          {visit.closedCount > 0 && (
            <Badge variant="success">{visit.closedCount} closed</Badge>
          )}
          {visit.newCount === 0 && visit.openCount === 0 && visit.closedCount === 0 && (
            <Badge variant="ghost">no snags</Badge>
          )}
        </div>
      </div>

      {/* Bottom row: meta */}
      <div
        style={{
          marginTop: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--c-text-dim)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0 14px',
        }}
      >
        <span>{formatVisitDate(visit.visit_date)}</span>
        {visit.conducted_by_name && (
          <span>By {visit.conducted_by_name}</span>
        )}
      </div>
    </Link>
  )
}
