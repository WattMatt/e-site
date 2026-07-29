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
import {
  QC_CONFORMANCE_LABELS,
  QC_SEVERITY_LABELS,
  type QcConformance,
  type QcSeverity,
} from '@esite/shared'
import { Cover, Watermark, pageStyles } from './components'
import { passPillColors } from './theme'
import type {
  QcReportData,
  QcReportEntryData,
  QcReportPhotoData,
  QcReportCommentData,
  QcReportTally,
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

  // ── Conformance badge + severity chip ─────────────────────────────────────
  badge: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    marginLeft: 5,
  },
  badgeText: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },
  chip: {
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    marginLeft: 4,
  },
  chipText: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },

  // ── Image-unavailable placeholder cell (Defect S4) ────────────────────────
  photoPlaceholder: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    fontSize: 6.5,
    color: '#9CA3AF',
    fontFamily: 'Helvetica',
  },

  // ── Conformance summary block (after the report-info header) ───────────────
  summary: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  summaryHeading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 3,
  },
  summaryTally: {
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  summaryTallyText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  summarySeverity: {
    fontSize: 7.5,
    color: '#777777',
  },

  // ── Defect punch-list section ─────────────────────────────────────────────
  punchList: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  punchHeading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#991B1B',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  punchRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  punchNumber: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#991B1B',
    marginRight: 5,
  },
  punchTitle: {
    fontSize: 8,
    color: '#333333',
    flex: 1,
  },
  punchLocation: {
    fontSize: 7.5,
    color: '#888888',
    marginRight: 5,
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

// ── Conformance badge (Pass green / Fail red / N-A grey) ────────────────────
// Reuses passPillColors — the same pass/fail/na palette as the inspection
// report's ResultPill, so the two report families read consistently.
function ConformanceBadge({ conformance }: { conformance: QcConformance }) {
  const { bg, fg } = passPillColors(conformance)
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{QC_CONFORMANCE_LABELS[conformance]}</Text>
    </View>
  )
}

const SEVERITY_COLORS: Record<QcSeverity, { bg: string; fg: string }> = {
  minor: { bg: '#FEF3C7', fg: '#92400E' },
  major: { bg: '#FFEDD5', fg: '#9A3412' },
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
}

function SeverityChip({ severity }: { severity: QcSeverity }) {
  const { bg, fg } = SEVERITY_COLORS[severity]
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.chipText, { color: fg }]}>{QC_SEVERITY_LABELS[severity]}</Text>
    </View>
  )
}

// ── Conformance summary block (after the report-info header) ─────────────────
function ConformanceSummary({ tally }: { tally: QcReportTally }) {
  const total = tally.pass + tally.fail + tally.na
  if (total === 0) return null
  const pass = passPillColors('pass')
  const fail = passPillColors('fail')
  const na = passPillColors('na')
  // Only list the severities that actually occur (keeps a clean line for the
  // common "all minor" case and renders nothing when there are no fails).
  const severityParts = (['critical', 'major', 'minor'] as QcSeverity[])
    .filter((sev) => tally.failBySeverity[sev] > 0)
    .map((sev) => `${QC_SEVERITY_LABELS[sev]} ${tally.failBySeverity[sev]}`)
  return (
    <View style={s.summary}>
      <Text style={s.summaryHeading}>Conformance summary</Text>
      <View style={s.summaryRow}>
        <View style={[s.summaryTally, { backgroundColor: pass.bg }]}>
          <Text style={[s.summaryTallyText, { color: pass.fg }]}>{`Pass ${tally.pass}`}</Text>
        </View>
        <View style={[s.summaryTally, { backgroundColor: fail.bg }]}>
          <Text style={[s.summaryTallyText, { color: fail.fg }]}>{`Fail ${tally.fail}`}</Text>
        </View>
        <View style={[s.summaryTally, { backgroundColor: na.bg }]}>
          <Text style={[s.summaryTallyText, { color: na.fg }]}>{`N/A ${tally.na}`}</Text>
        </View>
      </View>
      {severityParts.length > 0 && (
        <Text style={s.summarySeverity}>{`Fails by severity: ${severityParts.join(' · ')}`}</Text>
      )}
    </View>
  )
}

// ── Defect punch-list (all fail entries) ────────────────────────────────────
function DefectPunchList({
  entries,
  location,
}: {
  entries: QcReportEntryData[]
  location: string | null
}) {
  const fails = entries.filter((e) => e.conformance === 'fail')
  if (fails.length === 0) return null
  return (
    <View style={s.punchList}>
      <Text style={s.punchHeading}>{`Defect punch-list (${fails.length})`}</Text>
      {fails.map((e) => (
        <View key={e.id} style={s.punchRow} wrap={false}>
          <Text style={s.punchNumber}>{e.number}</Text>
          <Text style={s.punchTitle}>{e.title}</Text>
          {location && <Text style={s.punchLocation}>{location}</Text>}
          {e.severity && <SeverityChip severity={e.severity} />}
        </View>
      ))}
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

function PhotoGrid({
  photos,
  omittedCount,
  unavailableCount,
}: {
  photos: QcReportPhotoData[]
  omittedCount: number
  unavailableCount: number
}) {
  if (photos.length === 0 && omittedCount === 0) return null
  // Fold the >cap omitted count and the within-cap download-failure count
  // (Defect S4) into one note. Failures still render as placeholder cells, so
  // this line is informational.
  const noteParts: string[] = []
  if (omittedCount > 0) noteParts.push(`+${omittedCount} omitted`)
  if (unavailableCount > 0) {
    noteParts.push(`${unavailableCount} image${unavailableCount === 1 ? '' : 's'} unavailable`)
  }
  return (
    <View style={s.photoSection}>
      <View style={s.photoGrid}>
        {photos.map(p => (
          // Each CELL is unbreakable (image + tag + caption stay together) but
          // the grid itself wraps across pages — the interior.tsx PhotoGrid
          // behaviour. Wrapping the whole grid (let alone the whole entry) in
          // wrap={false} silently clips photos past the page bottom.
          <View key={p.id} style={s.photoCell} wrap={false}>
            {p.dataUri ? (
              <Image src={p.dataUri} style={s.photoImage} />
            ) : (
              // Defect S4: a failed within-cap download keeps its slot as an
              // "image unavailable" placeholder so the "Photo N" tag — and any
              // per-photo comment referencing it — stays valid.
              <View style={[s.photoImage, s.photoPlaceholder]}>
                <Text style={s.photoPlaceholderText}>Image unavailable</Text>
              </View>
            )}
            <Text style={s.photoTag}>{photoTagText(p)}</Text>
            {p.caption && <Text style={s.photoCaption}>{p.caption}</Text>}
          </View>
        ))}
      </View>
      {noteParts.length > 0 && (
        <Text style={s.photoOmittedNote}>{noteParts.join(' · ')}</Text>
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
        {/* Header: number + title + conformance badge (+ severity chip on fails) */}
        <View style={s.cardHeader}>
          <Text style={s.entryNumber}>{entry.number}</Text>
          <Text style={s.entryTitle}>{entry.title}</Text>
          <ConformanceBadge conformance={entry.conformance} />
          {entry.conformance === 'fail' && entry.severity && (
            <SeverityChip severity={entry.severity} />
          )}
        </View>

        {/* Description */}
        {entry.description && (
          <Text style={s.description}>{entry.description}</Text>
        )}
      </View>

      {/* Photos */}
      <PhotoGrid
        photos={entry.photos}
        omittedCount={entry.omittedCount}
        unavailableCount={entry.unavailableCount}
      />

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
  // Preview/admin route renders drafts; only an 'issued' (or 'closed') report
  // is a final record, so anything else carries the DRAFT watermark.
  const isDraft = data.report.status !== 'issued'

  return (
    <Document title={data.branding.title} producer="e-site.live">
      {/* ── Cover page ── */}
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={data.branding} />
        {isDraft && <Watermark text="DRAFT" />}
      </Page>

      {/* ── Body pages ── */}
      <Page size="A4" style={pageStyles.page}>
        <View style={s.body}>
          <ReportInfoBlock report={data.report} />
          <ConformanceSummary tally={data.tally} />
          <DefectPunchList entries={data.entries} location={data.report.location} />
          {data.entries.length === 0 ? (
            <Text style={s.emptyNote}>No entries</Text>
          ) : (
            data.entries.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))
          )}
        </View>
        <RunningFooter reportLabel={reportLabel} />
        {isDraft && <Watermark text="DRAFT" />}
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
