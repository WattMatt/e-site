'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { snagStatusBadge } from '@/components/ui/Badge'
import { VisitForm } from '../../_components/VisitForm'
import {
  closeSnagOnVisitAction,
  addSnagToVisitAction,
  exportSnagVisitReportAction,
} from '@/actions/snag-visit.actions'

// ─── Types ───────────────────────────────────────────────────────────────────

type Member = { user_id: string; full_name: string | null; email: string | null }

interface VisitPhoto {
  id: string
  url?: string
  caption?: string
  photo_type: string
}

interface BucketSnagRow {
  id: string
  title: string
  location?: string | null
  category?: string | null
  priority: string
  status: string
  raised_on_visit_id: string | null
  closed_on_visit_id: string | null
  snag_photos?: VisitPhoto[]
  _assignedToName?: string | null
  _raisedByName?: string | null
}

interface VisitRow {
  id: string
  visit_no: number
  is_backlog: boolean
  visit_date: string
  conducted_by: string | null
  title?: string | null
  notes?: string | null
  attendees?: Array<{ name: string; company?: string }>
}

interface Props {
  projectId: string
  visit: VisitRow
  conductedByName: string | null
  newSnags: BucketSnagRow[]
  stillOpen: BucketSnagRow[]
  closedThisVisit: BucketSnagRow[]
  /** Map from visit UUID → visit_no, for "from Visit N" labels */
  visitNoById: Record<string, number>
  members: Member[]
  currentUserId: string
  /** Last exported report, if any. Populated by the server page on load. */
  lastExported?: { date: string; downloadUrl: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  critical: 'var(--c-red)',
  high:     '#f97316',
  medium:   'var(--c-amber)',
  low:      'var(--c-text-dim)',
}

function visitLabel(visit: VisitRow) {
  return visit.is_backlog ? 'Initial backlog' : `Site Visit ${visit.visit_no}`
}

function formatVisitDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function photoCount(snag: BucketSnagRow) {
  return (snag.snag_photos ?? []).length
}

function hasBeforeAfter(snag: BucketSnagRow) {
  const photos = snag.snag_photos ?? []
  return photos.some(p => p.photo_type === 'evidence') &&
         photos.some(p => p.photo_type === 'closeout')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: string }) {
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        display: 'inline-block',
        flexShrink: 0,
        background: PRIORITY_DOT[priority] ?? 'var(--c-text-dim)',
      }}
    />
  )
}

function PhotoCount({ snag, struck }: { snag: BucketSnagRow; struck?: boolean }) {
  const count = photoCount(snag)
  if (count === 0) return null
  const label = struck && hasBeforeAfter(snag) ? '📷 before+after' : `📷 ${count}`
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--c-text-dim)',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  )
}

// ── Snag row: new / still-open / closed ──

function SnagRow({
  snag,
  projectId,
  visitId,
  originVisitNo,
  variant,
}: {
  snag: BucketSnagRow
  projectId: string
  visitId: string
  originVisitNo?: number
  variant: 'new' | 'open' | 'closed'
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [closeError, setCloseError] = useState<string | null>(null)

  const struck = variant === 'closed'
  const subtitle = [snag.location, snag.category].filter(Boolean).join(' · ')

  function handleClose() {
    setCloseError(null)
    startTransition(async () => {
      const result = await closeSnagOnVisitAction(snag.id, visitId, projectId)
      if (result.error) {
        setCloseError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <Link
        href={`/snags/${snag.id}`}
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '9px 14px',
            borderRadius: 7,
            transition: 'background 0.12s',
            cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {/* Left: dot + title/subtitle */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, flex: 1, minWidth: 0 }}>
            <PriorityDot priority={snag.priority} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: struck ? 'var(--c-text-dim)' : 'var(--c-text)',
                  textDecoration: struck ? 'line-through' : 'none',
                  opacity: struck ? 0.7 : 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {snag.title}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--c-text-dim)',
                  marginTop: 2,
                }}
              >
                {subtitle}
                {variant === 'open' && originVisitNo != null && (
                  <span
                    style={{
                      marginLeft: 6,
                      color: 'var(--c-amber)',
                      fontWeight: 600,
                    }}
                  >
                    from Visit {originVisitNo}
                  </span>
                )}
                {variant === 'closed' && snag.raised_on_visit_id && (
                  <span style={{ marginLeft: 6, color: 'var(--c-text-dim)' }}>
                    raised Visit {originVisitNo}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: photo count + status chip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
            onClick={e => e.preventDefault()}
          >
            <PhotoCount snag={snag} struck={struck} />
            {snagStatusBadge(snag.status)}
          </div>
        </div>
      </Link>

      {/* Inline Close ✓ for still-open rows — outside the Link to avoid nesting */}
      {variant === 'open' && (
        <div style={{ paddingLeft: 37, paddingBottom: 4 }}>
          <button
            type="button"
            disabled={isPending}
            onClick={handleClose}
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: '#34d399',
              background: 'transparent',
              border: '1px solid rgba(52,211,153,0.3)',
              borderRadius: 5,
              padding: '3px 10px',
              cursor: isPending ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.6 : 1,
              transition: 'all 0.12s',
              letterSpacing: '0.04em',
            }}
          >
            {isPending ? 'Closing…' : 'Close ✓'}
          </button>
          {closeError && (
            <p
              style={{
                color: 'var(--c-red)',
                fontSize: 11,
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              {closeError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add snag form ──

const CATEGORIES = [
  'general', 'electrical', 'mechanical', 'civil', 'safety', 'quality', 'snagging',
]

const PRIORITY_OPTS = [
  { value: 'low',      label: 'Low',      color: 'var(--c-text-dim)',  bg: 'var(--c-panel)',     border: 'var(--c-border)' },
  { value: 'medium',   label: 'Medium',   color: '#60a5fa',            bg: 'rgba(37,99,235,0.15)',border: '#1d4ed8' },
  { value: 'high',     label: 'High',     color: 'var(--c-amber)',     bg: 'var(--c-amber-dim)', border: 'var(--c-amber-mid)' },
  { value: 'critical', label: 'Critical', color: 'var(--c-red)',       bg: 'var(--c-red-dim)',   border: '#6b1e1e' },
]

const FIELD_LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: 4,
}

const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-bg)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  color: 'var(--c-text)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

function labelFor(m: Member) {
  return m.full_name ?? m.email ?? m.user_id.slice(0, 8)
}

function AddSnagForm({
  visitId,
  projectId,
  members,
  onClose,
}: {
  visitId: string
  projectId: string
  members: Member[]
  onClose: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('general')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // All state hooks are unconditional — never after a conditional return.

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setError(null)
    startTransition(async () => {
      const result = await addSnagToVisitAction({
        visitId,
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        category,
        priority,
        assignedTo: assignedTo || undefined,
      })
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
        onClose()
      }
    })
  }

  return (
    <div
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border-mid)',
        borderRadius: 8,
        padding: '18px 20px',
        marginTop: 10,
      }}
    >
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
            fontWeight: 600,
            color: 'var(--c-text-mid)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          Add snag to this visit
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--c-text-dim)',
            fontSize: 16,
            padding: 4,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* NOTE: Photos are added AFTER creation on the snag detail page.
          This form intentionally only collects core snag fields.
          Keeping it simple — upload flow lives on /snags/[id]. */}
      <form onSubmit={onSubmit} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Title */}
          <div>
            <label style={FIELD_LABEL} htmlFor="asvf_title">Title *</label>
            <input
              id="asvf_title"
              style={FIELD_INPUT}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief defect description"
              maxLength={300}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label style={FIELD_LABEL} htmlFor="asvf_desc">Description</label>
            <textarea
              id="asvf_desc"
              style={{ ...FIELD_INPUT, resize: 'vertical', minHeight: 60 }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional additional detail"
              maxLength={5000}
            />
          </div>

          {/* Location + Category */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 160px' }}>
              <label style={FIELD_LABEL} htmlFor="asvf_loc">Location</label>
              <input
                id="asvf_loc"
                style={FIELD_INPUT}
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Level 2 corridor"
                maxLength={500}
              />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={FIELD_LABEL} htmlFor="asvf_cat">Category</label>
              <select
                id="asvf_cat"
                style={FIELD_INPUT}
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label style={FIELD_LABEL}>Priority</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRIORITY_OPTS.map(opt => {
                const sel = priority === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value as typeof priority)}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                      border: `1px solid ${sel ? opt.border : 'var(--c-border)'}`,
                      background: sel ? opt.bg : 'var(--c-panel)',
                      color: sel ? opt.color : 'var(--c-text-dim)',
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Assigned to */}
          <div>
            <label style={FIELD_LABEL} htmlFor="asvf_assign">Assigned to</label>
            <select
              id="asvf_assign"
              style={FIELD_INPUT}
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value)}
            >
              <option value="">— unassigned —</option>
              {members.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {labelFor(m)}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p style={{ color: 'var(--c-red)', fontSize: 12, marginTop: 0 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button type="submit" size="sm" isLoading={isPending}>
              Add snag
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VisitDetail({
  projectId,
  visit,
  conductedByName,
  newSnags,
  stillOpen,
  closedThisVisit,
  visitNoById,
  members,
  currentUserId,
  lastExported: initialLastExported,
}: Props) {
  const [showEditForm, setShowEditForm] = useState(false)
  const [showAddSnag, setShowAddSnag] = useState(false)
  const [openCollapsed, setOpenCollapsed] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [lastExported, setLastExported] = useState<{ date: string; downloadUrl: string } | null>(
    initialLastExported ?? null,
  )

  // All hooks unconditionally above any conditional render — React #310 rule.

  const totalTracked = newSnags.length + stillOpen.length + closedThisVisit.length
  const attendees: Array<{ name: string; company?: string }> =
    (visit as any).attendees ?? []

  const visitTitle = visit.is_backlog
    ? 'Initial backlog'
    : `Site Visit ${visit.visit_no}`

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {visitTitle}
            {!visit.is_backlog && (
              <span
                style={{
                  color: 'var(--c-text-dim)',
                  fontWeight: 400,
                  fontSize: '0.75em',
                  marginLeft: 10,
                }}
              >
                · {formatVisitDate(visit.visit_date)}
              </span>
            )}
          </h1>

          {conductedByName && (
            <p
              style={{
                fontSize: 13,
                color: 'var(--c-text-dim)',
                marginBottom: 2,
              }}
            >
              Conducted by <strong style={{ color: 'var(--c-text)' }}>{conductedByName}</strong>
              {attendees.length > 0 && (
                <>
                  {' · Attendees: '}
                  {attendees.map((a, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      {a.name}
                      {a.company ? ` (${a.company})` : ''}
                    </span>
                  ))}
                </>
              )}
            </p>
          )}

          {(visit as any).notes && (
            <p
              style={{
                fontSize: 13,
                color: 'var(--c-text-dim)',
                marginBottom: 0,
                fontStyle: 'italic',
              }}
            >
              {(visit as any).notes}
            </p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setShowAddSnag(v => !v); setShowEditForm(false) }}
          >
            + Add snag
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setShowEditForm(v => !v); setShowAddSnag(false) }}
          >
            Edit visit
          </Button>
          <button
            type="button"
            disabled={isExporting}
            onClick={async () => {
              setIsExporting(true)
              setExportError(null)
              const result = await exportSnagVisitReportAction(visit.id, projectId)
              setIsExporting(false)
              if ('error' in result) {
                setExportError(result.error)
                return
              }
              // Build download URL via the inline preview route, which re-renders the
              // current visit live (equivalent for the latest report). The server-load
              // path serves the frozen storage_path artifact via a signed URL instead.
              const previewUrl = `/api/projects/${projectId}/snags/visits/${visit.id}/report`
              setLastExported({
                date: new Date().toISOString(),
                downloadUrl: previewUrl,
              })
              // Open inline in a new tab so the browser's native PDF viewer handles it.
              window.open(previewUrl, '_blank', 'noopener')
            }}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--c-amber)',
              color: '#0D0B09',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.6 : 1,
              transition: 'all 0.12s',
              whiteSpace: 'nowrap',
            }}
          >
            {isExporting ? 'Exporting…' : '⬇ Export PDF'}
          </button>
        </div>
      </div>

      {/* ── Export error ──────────────────────────────────────────────── */}
      {exportError && (
        <p
          style={{
            color: 'var(--c-red)',
            fontSize: 12,
            margin: '4px 0 0',
          }}
        >
          Export failed: {exportError}
        </p>
      )}

      {/* ── Last exported banner ──────────────────────────────────────── */}
      {lastExported && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: 'var(--c-text-dim)',
            fontFamily: 'var(--font-mono)',
            margin: '6px 0 0',
          }}
        >
          <span>
            Last exported{' '}
            {new Date(lastExported.date).toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
          <span style={{ color: 'var(--c-border)' }}>·</span>
          <a
            href={lastExported.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--c-amber)', textDecoration: 'none' }}
          >
            re-download
          </a>
        </div>
      )}

      {/* ── Inline forms ──────────────────────────────────────────────── */}
      {showEditForm && (
        <VisitForm
          mode="edit"
          projectId={projectId}
          visitId={visit.id}
          currentUserId={currentUserId}
          members={members}
          defaultValues={{
            visitDate: (visit as any).visit_date,
            conductedBy: (visit as any).conducted_by ?? undefined,
            attendees: attendees,
            title: (visit as any).title ?? undefined,
            notes: (visit as any).notes ?? undefined,
          }}
          onClose={() => setShowEditForm(false)}
        />
      )}

      {showAddSnag && (
        <AddSnagForm
          visitId={visit.id}
          projectId={projectId}
          members={members}
          onClose={() => setShowAddSnag(false)}
        />
      )}

      {/* ── Stat strip ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          margin: '14px 0 20px',
        }}
      >
        {[
          { label: 'new this visit', value: newSnags.length, color: '#60a5fa' },
          { label: 'still open',     value: stillOpen.length, color: 'var(--c-amber)' },
          { label: 'closed this visit', value: closedThisVisit.length, color: '#34d399' },
          { label: 'tracked total',  value: totalTracked, color: 'var(--c-text)' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 9,
              padding: '7px 14px',
              fontSize: 12,
              background: 'var(--c-panel)',
              color: 'var(--c-text-dim)',
            }}
          >
            <strong style={{ fontSize: 18, display: 'block', color }}>{value}</strong>
            {label}
          </div>
        ))}
      </div>

      {/* ── New this visit ────────────────────────────────────────────── */}
      <div className="data-panel" style={{ marginBottom: 14 }}>
        <div className="data-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
                background: '#60a5fa', flexShrink: 0,
              }}
            />
            <span className="data-panel-title">New this visit</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--c-text-dim)',
              }}
            >
              ({newSnags.length})
            </span>
          </div>
        </div>

        <div style={{ padding: '4px 0' }}>
          {newSnags.length === 0 ? (
            <p
              style={{
                padding: '12px 18px',
                fontSize: 13,
                color: 'var(--c-text-dim)',
                margin: 0,
              }}
            >
              No new snags raised on this visit.
            </p>
          ) : (
            newSnags.map(snag => (
              <SnagRow
                key={snag.id}
                snag={snag}
                projectId={projectId}
                visitId={visit.id}
                variant="new"
              />
            ))
          )}

          {/* + Add a snag to this visit */}
          <button
            type="button"
            onClick={() => { setShowAddSnag(true); setShowEditForm(false) }}
            style={{
              width: '100%',
              textAlign: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '10px 14px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--c-text-dim)',
              letterSpacing: '0.04em',
              borderTop: '1px dashed var(--c-border)',
              marginTop: 4,
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--c-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--c-text-dim)')}
          >
            + Add a snag to this visit
          </button>
        </div>
      </div>

      {/* ── Still open — carried forward (collapsible) ────────────────── */}
      <div className="data-panel" style={{ marginBottom: 14 }}>
        <div
          className="data-panel-header"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setOpenCollapsed(v => !v)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <span
              style={{
                width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
                background: 'var(--c-amber)', flexShrink: 0,
              }}
            />
            <span className="data-panel-title">Still open — carried forward</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--c-text-dim)',
              }}
            >
              ({stillOpen.length})
            </span>
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--c-text-dim)',
              }}
            >
              {openCollapsed ? '▸ expand' : '▾ collapse'}
            </span>
          </div>
        </div>

        {!openCollapsed && (
          <div style={{ padding: '4px 0' }}>
            {stillOpen.length === 0 ? (
              <p
                style={{
                  padding: '12px 18px',
                  fontSize: 13,
                  color: 'var(--c-text-dim)',
                  margin: 0,
                }}
              >
                No open snags carried forward.
              </p>
            ) : (
              stillOpen.map(snag => {
                const originNo = snag.raised_on_visit_id
                  ? visitNoById[snag.raised_on_visit_id]
                  : undefined
                return (
                  <SnagRow
                    key={snag.id}
                    snag={snag}
                    projectId={projectId}
                    visitId={visit.id}
                    variant="open"
                    originVisitNo={originNo}
                  />
                )
              })
            )}
          </div>
        )}
      </div>

      {/* ── Closed this visit ─────────────────────────────────────────── */}
      <div className="data-panel" style={{ marginBottom: 14 }}>
        <div className="data-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
                background: '#34d399', flexShrink: 0,
              }}
            />
            <span className="data-panel-title">Closed this visit</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--c-text-dim)',
              }}
            >
              ({closedThisVisit.length})
            </span>
          </div>
        </div>

        <div style={{ padding: '4px 0' }}>
          {closedThisVisit.length === 0 ? (
            <p
              style={{
                padding: '12px 18px',
                fontSize: 13,
                color: 'var(--c-text-dim)',
                margin: 0,
              }}
            >
              No snags closed on this visit.
            </p>
          ) : (
            closedThisVisit.map(snag => {
              const originNo = snag.raised_on_visit_id
                ? visitNoById[snag.raised_on_visit_id]
                : undefined
              return (
                <SnagRow
                  key={snag.id}
                  snag={snag}
                  projectId={projectId}
                  visitId={visit.id}
                  variant="closed"
                  originVisitNo={originNo}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
