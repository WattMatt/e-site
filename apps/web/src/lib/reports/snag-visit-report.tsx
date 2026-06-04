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
 *                     closed:   "Before" photos then "After ✓" photos, labelled
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
  Image,
  StyleSheet,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer'
import { Cover, pageStyles } from './components'
import type { SnagVisitReportData, ReportSnag, SnagPhotoData } from './snag-visit-report-data'

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  // ── Page body (inside Page, after Cover) ──────────────────────────────────
  body: {
    paddingHorizontal: 36,
    paddingTop: 28,
    paddingBottom: 48, // leave room for the running footer
    flex: 1,
  },

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
  card: {
    marginBottom: 10,
    paddingBottom: 8,
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
  photoSection: {
    marginTop: 4,
  },
  photoLabel: {
    fontSize: 6.5,
    color: '#888888',
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 3,
    marginTop: 6,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  photoCell: {
    width: '48%',
  },
  photoImage: {
    width: '100%',
    height: 100,
    objectFit: 'cover',
    borderRadius: 2,
  },
  photoCaption: {
    fontSize: 6.5,
    color: '#888888',
    marginTop: 2,
    textAlign: 'center',
  },

  // ── Running footer (fixed — repeats on every body page) ──────────────────
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
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

function PhotoGrid({ photos, label }: { photos: SnagPhotoData[]; label?: string }) {
  if (photos.length === 0) return null
  return (
    <View style={s.photoSection}>
      {label && <Text style={s.photoLabel}>{label}</Text>}
      <View style={s.photoGrid}>
        {photos.map(p => (
          <View key={p.id} style={s.photoCell}>
            <Image src={p.dataUri} style={s.photoImage} />
            {p.caption && <Text style={s.photoCaption}>{p.caption}</Text>}
          </View>
        ))}
      </View>
    </View>
  )
}

function SnagCard({ snag, isClosed }: { snag: ReportSnag; isClosed: boolean }) {
  const metaParts: string[] = []
  if (snag.location) metaParts.push(snag.location)
  if (snag.category) metaParts.push(snag.category)
  if (snag.raisedOnVisitLabel) metaParts.push(`raised ${snag.raisedOnVisitLabel}`)

  return (
    <View style={s.card}>
      {/* Header: number + title + badges */}
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

      {/* Meta */}
      {metaParts.length > 0 && (
        <Text style={s.meta}>{metaParts.join(' · ')}</Text>
      )}

      {/* Description */}
      {snag.description && (
        <Text style={s.description}>{snag.description}</Text>
      )}

      {/* Photos */}
      {isClosed ? (
        <>
          <PhotoGrid photos={snag.beforePhotos} label="Before" />
          <PhotoGrid photos={snag.afterPhotos} label="After ✓" />
        </>
      ) : (
        <PhotoGrid photos={snag.photos} />
      )}
    </View>
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
    <View>
      <Text style={[s.groupHeader, isFirst ? s.firstGroupHeader : {}]}>{label}</Text>
      {snags.length === 0 ? (
        <Text style={s.emptyGroup}>None</Text>
      ) : (
        snags.map(snag => (
          <SnagCard key={snag.id} snag={snag} isClosed={isClosed} />
        ))
      )}
    </View>
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
        <View style={s.body}>
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
        </View>
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
