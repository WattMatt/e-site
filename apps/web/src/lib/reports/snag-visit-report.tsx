/**
 * snag-visit-report.tsx
 *
 * react-pdf document for the Snag & Defect Report (Option A — snag cards with
 * inline photos).  Reuses the existing branded Cover verbatim from components.tsx.
 *
 * Layout per the design-of-record (report-composition.html, Option A):
 *   Cover page  — branded Cover component (issuer wordmark + amber accent rule +
 *                 "PREPARED WITH" parties strip + page-numbered footer)
 *   Body pages  — three status-group sections:
 *                   NEW THIS VISIT
 *                   STILL OPEN — CARRIED FORWARD
 *                   CLOSED THIS VISIT
 *                 Each snag = a card:
 *                   header row: number + title | priority badge + status badge
 *                   meta line:  location · category [· raised Visit N]
 *                   description (when present)
 *                   photos: inline beneath the card
 *                     open/new: all evidence photos in a 2-column grid
 *                     closed:   "Before" photos then "After" photos, labelled
 *                   photo grid: shared ReportPhotoGrid (photo-grid.tsx) — whole
 *                     photos, rows unbreakable, the card itself breakable
 *
 * Node-only: renderToBuffer is not available in the browser build.  Any test
 * file that imports renderSnagVisitReport must carry // @vitest-environment node.
 */

// No 'use client' — server-side PDF rendering only.
import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer'
import { Cover, pageStyles } from './components'
import { spacing } from './theme'
import { ReportPhotoGrid, PHOTO_GRID_2UP, MAX_LEAD_CHARS, type GridPhoto } from './photo-grid'
import type { SnagVisitReportData, ReportSnag, SnagPhotoData } from './snag-visit-report-data'

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  // ── Page body (inside Page, after Cover) ──────────────────────────────────

  // ── Section group header ──────────────────────────────────────────────────
  groupHeader: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    color: '#888888',
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    paddingBottom: 3,
    marginBottom: 8,
    marginTop: 16,
  },
  firstGroupHeader: {
    marginTop: 0,
  },

  emptyGroup: {
    fontSize: 8,
    color: '#BBBBBB',
    fontStyle: 'italic',
    marginBottom: 12,
  },

  // ── Snag card ─────────────────────────────────────────────────────────────
  // Rule closing a snag (the snag itself is a fragment of page-level units).
  card: {
    marginTop: 2,
    marginBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEEEEE',
  },

  // Card header row: number + title on the left, badges on the right
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 3,
  },
  cardTitleBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flex: 1,
    flexWrap: 'wrap',
    marginRight: 8,
  },
  snagNumber: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    marginRight: 5,
  },
  snagTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#222222',
    flex: 1,
  },
  snagTitleClosed: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#999999',
  },

  // Badges row
  badgeRow: {
    flexDirection: 'row',
    gap: 3,
  },
  badge: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  badgeCritical:  { backgroundColor: '#FEE2E2', color: '#991B1B' },
  badgeHigh:      { backgroundColor: '#FEF3C7', color: '#92400E' },
  badgeMedium:    { backgroundColor: '#DBEAFE', color: '#1E40AF' },
  badgeLow:       { backgroundColor: '#F3F4F6', color: '#374151' },
  badgeOpen:      { backgroundColor: '#FEF9C3', color: '#854D0E' },
  badgeInProgress:{ backgroundColor: '#DBEAFE', color: '#1E40AF' },
  badgePending:   { backgroundColor: '#EDE9FE', color: '#5B21B6' },
  badgeClosed:    { backgroundColor: '#DCFCE7', color: '#166534' },
  badgeDefault:   { backgroundColor: '#F3F4F6', color: '#374151' },

  // Meta line: location · category · raised
  meta: {
    fontSize: 7.5,
    color: '#777777',
    marginBottom: 3,
  },

  // Description
  description: {
    fontSize: 8,
    color: '#444444',
    lineHeight: 1.4,
    marginBottom: 4,
  },

  // ── Photo grid ────────────────────────────────────────────────────────────
  photoLabel: {
    fontSize: 6.5,
    color: '#888888',
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 3,
    marginTop: 6,
  },


  // ── Visit-info header block (top of first body page) ─────────────────────
  visitInfo: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  visitInfoLine: {
    fontSize: 8,
    color: '#555555',
    lineHeight: 1.5,
  },
  visitInfoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  visitInfoNotes: {
    fontSize: 8,
    color: '#777777',
    fontStyle: 'italic',
    lineHeight: 1.4,
    marginTop: 3,
  },

  // ── Running footer (fixed — repeats on every body page) ──────────────────
  footer: {
    position: 'absolute',
    bottom: 20,
    left: spacing.pagePaddingH,
    right: spacing.pagePaddingH,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#E0E0E0',
    paddingTop: 5,
  },
  footerText: {
    fontSize: 7,
    color: '#AAAAAA',
  },
})

// ---------------------------------------------------------------------------
// Priority & status badge helpers
// ---------------------------------------------------------------------------

type BadgeStyle =
  | 'badgeCritical' | 'badgeHigh' | 'badgeMedium' | 'badgeLow'
  | 'badgeOpen' | 'badgeInProgress' | 'badgePending' | 'badgeClosed' | 'badgeDefault'

function priorityBadgeStyle(priority: string | null): BadgeStyle {
  switch (priority?.toLowerCase()) {
    case 'critical': return 'badgeCritical'
    case 'high':     return 'badgeHigh'
    case 'medium':   return 'badgeMedium'
    case 'low':      return 'badgeLow'
    default:         return 'badgeDefault'
  }
}

function statusBadgeStyle(status: string): BadgeStyle {
  switch (status) {
    case 'open':            return 'badgeOpen'
    case 'in_progress':     return 'badgeInProgress'
    case 'resolved':
    case 'pending_sign_off':return 'badgePending'
    case 'signed_off':
    case 'closed':          return 'badgeClosed'
    default:                return 'badgeDefault'
  }
}

const STATUS_LABELS: Record<string, string> = {
  open:            'OPEN',
  in_progress:     'IN PROGRESS',
  resolved:        'RESOLVED',
  pending_sign_off:'PENDING SIGN-OFF',
  signed_off:      'SIGNED OFF',
  closed:          'CLOSED',
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VisitInfoBlock({
  conductedByName,
  visitDate,
  attendeeNames,
  notes,
}: {
  conductedByName: string | null
  visitDate: string | null
  attendeeNames: string[]
  notes: string | null
}) {
  // Nothing to show if all fields are empty
  if (!conductedByName && !visitDate && attendeeNames.length === 0 && !notes) return null
  return (
    <View style={s.visitInfo}>
      {(conductedByName || visitDate) && (
        <Text style={s.visitInfoLine}>
          {conductedByName ? `Conducted by ${conductedByName}` : ''}
          {conductedByName && visitDate ? ' · ' : ''}
          {visitDate ?? ''}
        </Text>
      )}
      {attendeeNames.length > 0 && (
        <Text style={s.visitInfoLine}>
          Attendees: {attendeeNames.join(', ')}
        </Text>
      )}
      {notes && (
        <Text style={s.visitInfoNotes}>{notes}</Text>
      )}
    </View>
  )
}

const toGrid = (photos: SnagPhotoData[]): GridPhoto[] =>
  photos.map((p) => ({ key: p.id, dataUri: p.dataUri, caption: p.caption }))

/**
 * One snag. The card is breakable and its rows are not (photo-grid.tsx): the
 * whole card used to be wrap={false}, so a snag with more photos than a page
 * holds was clipped at the page bottom. The heading rides inside the first
 * photo row; "Before" / "After" labels ride inside their grid's first row.
 */
function SnagCard({ snag, isClosed }: { snag: ReportSnag; isClosed: boolean }) {
  const metaParts: string[] = []
  if (snag.location) metaParts.push(snag.location)
  if (snag.category) metaParts.push(snag.category)
  if (snag.raisedOnVisitLabel) metaParts.push(`raised ${snag.raisedOnVisitLabel}`)

  const heading = (
    <View>
      <View style={s.cardHeader}>
        <View style={s.cardTitleBlock}>
          <Text style={s.snagNumber}>{snag.number}</Text>
          <Text style={isClosed ? s.snagTitleClosed : s.snagTitle}>{snag.title}</Text>
        </View>
        <View style={s.badgeRow}>
          {snag.priority && (
            <Text style={[s.badge, s[priorityBadgeStyle(snag.priority)]]}>
              {PRIORITY_LABELS[snag.priority] ?? snag.priority.toUpperCase()}
            </Text>
          )}
          <Text style={[s.badge, s[statusBadgeStyle(snag.status)]]}>
            {STATUS_LABELS[snag.status] ?? snag.status.toUpperCase()}
          </Text>
        </View>
      </View>
      {metaParts.length > 0 && <Text style={s.meta}>{metaParts.join(' · ')}</Text>}
    </View>
  )
  const description = snag.description ? <Text style={s.description}>{snag.description}</Text> : null
  const leadFits = (snag.description?.length ?? 0) <= MAX_LEAD_CHARS
  const head = leadFits ? <View>{heading}{description}</View> : null

  const grids: { label: string | null; photos: SnagPhotoData[] }[] = isClosed
    ? [
        { label: 'Before', photos: snag.beforePhotos },
        // Words only: a "✓" is not WinAnsi and react-pdf draws a different glyph.
        { label: 'After', photos: snag.afterPhotos },
      ].filter((g) => g.photos.length > 0)
    : snag.photos.length > 0
      ? [{ label: null, photos: snag.photos }]
      : []

  // A fragment, not a card <View>: rows must sit directly in the page flow
  // (photo-grid.tsx rule 2). The card's bottom rule is its own last unit.
  return (
    <>
      {!leadFits && (
        <>
          <View wrap={false} minPresenceAhead={60}>{heading}</View>
          {description}
        </>
      )}
      {grids.length === 0 && head && <View wrap={false}>{head}</View>}
      {grids.map((g, i) => (
        <ReportPhotoGrid
          key={g.label ?? 'photos'}
          photos={toGrid(g.photos)}
          layout={PHOTO_GRID_2UP}
          lead={
            <View>
              {i === 0 ? head : null}
              {g.label && <Text style={s.photoLabel}>{g.label}</Text>}
            </View>
          }
        />
      ))}
      <View style={s.card} />
    </>
  )
}

function SectionGroup({
  label,
  snags,
  isClosed,
  isFirst,
}: {
  label: string
  snags: ReportSnag[]
  isClosed: boolean
  isFirst?: boolean
}) {
  return (
    <>
      <Text style={[s.groupHeader, isFirst ? s.firstGroupHeader : {}]} minPresenceAhead={60}>{label}</Text>
      {snags.length === 0 ? (
        <Text style={s.emptyGroup}>None</Text>
      ) : (
        snags.map(snag => (
          <SnagCard key={snag.id} snag={snag} isClosed={isClosed} />
        ))
      )}
    </>
  )
}

function RunningFooter({ visitLabel }: { visitLabel: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Snag &amp; Defect Report · {visitLabel}</Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Main document
// ---------------------------------------------------------------------------

export function SnagVisitReportDocument({ data }: { data: SnagVisitReportData }) {
  const { visit } = data
  const visitLabel = visit.isBacklog
    ? 'Initial Backlog'
    : `Site Visit ${visit.visitNo}`

  return (
    <Document title={data.branding.title} producer="e-site.live">
      {/* ── Cover page ── */}
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={data.branding} />
      </Page>

      {/* ── Body pages ── */}
      <Page size="A4" style={pageStyles.page}>
        {/* No wrapping body <View>: snags are page-level units (photo-grid.tsx). */}
        <>
          <VisitInfoBlock
            conductedByName={visit.conductedByName}
            visitDate={visit.visitDate}
            attendeeNames={visit.attendeeNames}
            notes={visit.notes}
          />
          <SectionGroup
            label="NEW THIS VISIT"
            snags={data.newSnags}
            isClosed={false}
            isFirst
          />
          <SectionGroup
            label="STILL OPEN — CARRIED FORWARD"
            snags={data.stillOpen}
            isClosed={false}
          />
          <SectionGroup
            label="CLOSED THIS VISIT"
            snags={data.closedThisVisit}
            isClosed
          />
        </>
        <RunningFooter visitLabel={visitLabel} />
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/**
 * Render a SnagVisitReportData to a PDF Buffer.
 * Must be called in a Node runtime — the browser build of @react-pdf/renderer
 * stubs out renderToBuffer.
 */
export async function renderSnagVisitReport(
  data: SnagVisitReportData,
): Promise<Buffer> {
  const element = React.createElement(
    SnagVisitReportDocument,
    { data },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
