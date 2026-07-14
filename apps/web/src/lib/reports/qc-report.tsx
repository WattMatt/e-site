/**
 * qc-report.tsx
 *
 * react-pdf document for the Quality Control Report.  Clone of
 * snag-visit-report.tsx (entry cards with inline photos); reuses the existing
 * branded Cover verbatim from components.tsx.
 *
 * Layout:
 *   Cover page  — branded Cover component (kicker "QUALITY CONTROL REPORT")
 *   Body pages  — report-info block (location / inspection date / raised by /
 *                 description), then one card per entry:
 *                   header row: entry number + title
 *                   description (when present)
 *                   photo grid: 2-column, each cell tagged "Photo N"
 *                     (markups tagged "Photo N · Drawing markup — {plan}")
 *                   comments block: author · date · body; per-photo comments
 *                     reference "Photo N"
 *                 Fixed running footer with page X / Y.
 *
 * Node-only: renderToBuffer is not available in the browser build.  Any test
 * file that imports renderQcReport must carry // @vitest-environment node.
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
import type {
  QcReportData,
  QcReportEntryData,
  QcReportPhotoData,
  QcReportCommentData,
} from './qc-report-data'

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

  emptyNote: {
    fontSize: 8,
    color: '#BBBBBB',
    fontStyle: 'italic',
    marginBottom: 12,
  },

  // ── Entry card ────────────────────────────────────────────────────────────
  card: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEEEEE',
  },

  // Card header row: number + title
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  entryNumber: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    marginRight: 5,
  },
  entryTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#222222',
    flex: 1,
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
  photoTag: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    marginTop: 2,
    textAlign: 'center',
  },
  photoCaption: {
    fontSize: 6.5,
    color: '#888888',
    marginTop: 1,
    textAlign: 'center',
  },
  photoOmittedNote: {
    fontSize: 6.5,
    color: '#BBBBBB',
    fontStyle: 'italic',
    marginTop: 3,
  },

  // ── Comments block ────────────────────────────────────────────────────────
  commentsHeader: {
    fontSize: 6.5,
    color: '#888888',
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 3,
    marginTop: 6,
  },
  comment: {
    marginBottom: 4,
  },
  commentMeta: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: '#999999',
    marginBottom: 1,
  },
  commentBody: {
    fontSize: 8,
    color: '#444444',
    lineHeight: 1.4,
  },

  // ── Report-info header block (top of first body page) ────────────────────
  reportInfo: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  reportInfoLine: {
    fontSize: 8,
    color: '#555555',
    lineHeight: 1.5,
  },
  reportInfoNotes: {
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
// Sub-components
// ---------------------------------------------------------------------------

function ReportInfoBlock({ report }: { report: QcReportData['report'] }) {
  const issuedDate = report.issuedAt ? report.issuedAt.slice(0, 10) : null
  // Nothing to show if all fields are empty
  if (!report.raisedByName && !report.inspectionDate && !report.location && !issuedDate && !report.description) {
    return null
  }
  return (
    <View style={s.reportInfo}>
      {(report.raisedByName || report.inspectionDate) && (
        <Text style={s.reportInfoLine}>
          {report.raisedByName ? `Raised by ${report.raisedByName}` : ''}
          {report.raisedByName && report.inspectionDate ? ' · ' : ''}
          {report.inspectionDate ?? ''}
        </Text>
      )}
      {report.location && (
        <Text style={s.reportInfoLine}>Location: {report.location}</Text>
      )}
      {issuedDate && (
        <Text style={s.reportInfoLine}>
          Issued {issuedDate}{report.issuedByName ? ` by ${report.issuedByName}` : ''}
        </Text>
      )}
      {report.description && (
        <Text style={s.reportInfoNotes}>{report.description}</Text>
      )}
    </View>
  )
}

function photoTagText(p: QcReportPhotoData): string {
  if (p.kind === 'markup') {
    return p.planName
      ? `Photo ${p.index} · Drawing markup — ${p.planName}`
      : `Photo ${p.index} · Drawing markup`
  }
  return `Photo ${p.index}`
}

function PhotoGrid({ photos, omittedCount }: { photos: QcReportPhotoData[]; omittedCount: number }) {
  if (photos.length === 0 && omittedCount === 0) return null
  return (
    <View style={s.photoSection}>
      <View style={s.photoGrid}>
        {photos.map(p => (
          // Each CELL is unbreakable (image + tag + caption stay together) but
          // the grid itself wraps across pages — the interior.tsx PhotoGrid
          // behaviour. Wrapping the whole grid (let alone the whole entry) in
          // wrap={false} silently clips photos past the page bottom.
          <View key={p.id} style={s.photoCell} wrap={false}>
            <Image src={p.dataUri} style={s.photoImage} />
            <Text style={s.photoTag}>{photoTagText(p)}</Text>
            {p.caption && <Text style={s.photoCaption}>{p.caption}</Text>}
          </View>
        ))}
      </View>
      {omittedCount > 0 && (
        <Text style={s.photoOmittedNote}>{`+${omittedCount} omitted`}</Text>
      )}
    </View>
  )
}

function CommentLine({ comment }: { comment: QcReportCommentData }) {
  const metaParts: string[] = []
  if (comment.photoIndex != null) metaParts.push(`Photo ${comment.photoIndex}`)
  metaParts.push(comment.authorName ?? 'Unknown')
  if (comment.createdAt) metaParts.push(comment.createdAt.slice(0, 10))
  return (
    // Unbreakable per LINE (meta never separates from its body) — the comments
    // BLOCK still flows across pages with the rest of the entry.
    <View style={s.comment} wrap={false}>
      <Text style={s.commentMeta}>{metaParts.join(' · ')}</Text>
      <Text style={s.commentBody}>{comment.body}</Text>
    </View>
  )
}

/**
 * One entry. The card itself MUST be breakable: an entry carries up to 24
 * photos (~1,300pt of grid) against ~766pt of usable A4 body, so a
 * wrap={false} card cannot fit any page and react-pdf silently clips
 * everything past the page bottom (photos AND the comments block). Only the
 * small header+description block is unbreakable, with minPresenceAhead
 * reserving room for at least one photo row so a title is never orphaned at
 * a page bottom; the photo grid and comments flow across pages (per-cell /
 * per-line wrap={false} keeps each unit intact) — interior.tsx PhotoGrid
 * behaviour.
 */
function EntryCard({ entry }: { entry: QcReportEntryData }) {
  return (
    <View style={s.card}>
      <View wrap={false} minPresenceAhead={120}>
        {/* Header: number + title */}
        <View style={s.cardHeader}>
          <Text style={s.entryNumber}>{entry.number}</Text>
          <Text style={s.entryTitle}>{entry.title}</Text>
        </View>

        {/* Description */}
        {entry.description && (
          <Text style={s.description}>{entry.description}</Text>
        )}
      </View>

      {/* Photos */}
      <PhotoGrid photos={entry.photos} omittedCount={entry.omittedCount} />

      {/* Comments */}
      {entry.comments.length > 0 && (
        <>
          <Text style={s.commentsHeader} minPresenceAhead={40}>Comments</Text>
          {entry.comments.map(c => (
            <CommentLine key={c.id} comment={c} />
          ))}
        </>
      )}
    </View>
  )
}

function RunningFooter({ reportLabel }: { reportLabel: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Quality Control Report · {reportLabel}</Text>
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

export function QcReportDocument({ data }: { data: QcReportData }) {
  const reportLabel = `QC Report ${data.report.reportNo}`

  return (
    <Document title={data.branding.title} producer="e-site.live">
      {/* ── Cover page ── */}
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={data.branding} />
      </Page>

      {/* ── Body pages ── */}
      <Page size="A4" style={pageStyles.page}>
        <View style={s.body}>
          <ReportInfoBlock report={data.report} />
          {data.entries.length === 0 ? (
            <Text style={s.emptyNote}>No entries</Text>
          ) : (
            data.entries.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))
          )}
        </View>
        <RunningFooter reportLabel={reportLabel} />
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/**
 * Render a QcReportData to a PDF Buffer.
 * Must be called in a Node runtime — the browser build of @react-pdf/renderer
 * stubs out renderToBuffer.
 */
export async function renderQcReport(
  data: QcReportData,
): Promise<Buffer> {
  const element = React.createElement(
    QcReportDocument,
    { data },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
