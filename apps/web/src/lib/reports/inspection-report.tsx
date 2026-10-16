// No 'use client' — rendered server-side to PDF only.
import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { spacing, passPillColors } from './theme'
import type { ResolvedBranding } from './branding'
import type {
  InspectionReportData,
  ReportSummary,
  ReportSection,
  ReportGroup,
  ReportFieldRow,
  ReportPhotoField,
} from './inspection-report-data'
import { Cover, pageStyles as s } from './components'
import {
  RunningHeader,
  Section,
  ResultRow,
  PhotoGrid,
  Table,
  SignatureBlock,
  AnnexureList,
} from './interior'

// ---------------------------------------------------------------------------
// Styles (Summary-specific — not shared primitives)
// ---------------------------------------------------------------------------

const ss = StyleSheet.create({
  // Identity metabox
  summaryMeta: {
    marginBottom: spacing.sectionGap,
  },
  // Overall result banner
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.pillPaddingH,
    paddingVertical: 8,
    borderRadius: 4,
    marginBottom: spacing.sectionGap,
  },
  resultBannerLabel: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  // Tally row
  tallyRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: spacing.sectionGap,
  },
  tallyCell: {
    alignItems: 'center',
    gap: 2,
  },
  tallyCount: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
  },
  tallyLabel: {
    fontSize: 8,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Failed list
  failedHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
    color: '#991B1B',
  },
  failedEmpty: {
    fontSize: 9,
    color: '#9CA3AF',
    marginBottom: spacing.sectionGap,
  },
  failedItem: {
    fontSize: 9,
    color: '#374151',
    marginBottom: 2,
  },
  failedSansRef: {
    fontSize: 8,
    color: '#9CA3AF',
    marginLeft: 8,
  },
  // Group sub-heading
  groupLabel: {
    fontSize: spacing.sectionHeadingFontSize - 2,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginTop: 8,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E7EB',
  },
  groupEntryLabel: {
    fontSize: spacing.rowLabelFontSize,
    color: '#9CA3AF',
    fontFamily: 'Helvetica-Bold',
    marginTop: 4,
    marginBottom: 2,
  },
})

// ---------------------------------------------------------------------------
// Helper — format ISO datetime for display
// ---------------------------------------------------------------------------

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ')
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Helper — overall result label + pill colours
// Maps 'conditional_pass' to accent (amber) since it's not a passPillColors key.
// ---------------------------------------------------------------------------

function overallResultDisplay(
  result: string | null,
  accent: string,
): { label: string; bg: string; fg: string } {
  if (result === 'conditional_pass') {
    return { label: 'CONDITIONAL PASS', bg: accent + '33', fg: accent }
  }
  // pass / fail / null / unknown — all routed through the theme
  const pill = passPillColors(result === 'pass' || result === 'fail' ? result : null)
  const label = result === 'pass' ? 'PASS' : result === 'fail' ? 'FAIL' : (result ?? '— PENDING —')
  return { label, ...pill }
}

// ---------------------------------------------------------------------------
// Summary — report-specific, defined here not in interior.tsx
// ---------------------------------------------------------------------------

interface SummaryProps {
  summary: ReportSummary
  accent: string
}

function Summary({ summary, accent }: SummaryProps) {
  const {
    documentNumber,
    projectName,
    projectCode,
    targetLabel,
    templateName,
    templateVersion,
    inspectors,
    verifier,
    startedAt,
    certifiedAt,
    overallResult,
    sansReference,
    tally,
    failed,
  } = summary

  const overall = overallResultDisplay(overallResult, accent)

  // Identity rows rendered as ResultRow kind='value'
  const metaRows: Array<{ label: string; value: string }> = [
    { label: 'Document number', value: documentNumber },
    { label: 'Project', value: projectCode ? `${projectName} (${projectCode})` : projectName },
    { label: 'Target / subject', value: targetLabel },
    {
      label: 'Template',
      value: templateVersion ? `${templateName} v${templateVersion}` : templateName,
    },
    { label: 'Inspector(s)', value: inspectors },
    { label: 'Verifier', value: verifier ?? '—' },
    { label: 'Started', value: formatWhen(startedAt) },
    { label: 'Certified', value: formatWhen(certifiedAt) },
    { label: 'SANS reference', value: sansReference ?? '—' },
  ]

  return (
    <View>
      {/* Overall result banner */}
      <View style={[ss.resultBanner, { backgroundColor: overall.bg }]}>
        <Text style={[ss.resultBannerLabel, { color: overall.fg }]}>{overall.label}</Text>
      </View>

      {/* Pass/fail/na tally */}
      <View style={ss.tallyRow}>
        <View style={ss.tallyCell}>
          <Text style={[ss.tallyCount, { color: passPillColors('pass').fg }]}>{tally.pass}</Text>
          <Text style={ss.tallyLabel}>Pass</Text>
        </View>
        <View style={ss.tallyCell}>
          <Text style={[ss.tallyCount, { color: passPillColors('fail').fg }]}>{tally.fail}</Text>
          <Text style={ss.tallyLabel}>Fail</Text>
        </View>
        <View style={ss.tallyCell}>
          <Text style={[ss.tallyCount, { color: passPillColors('na').fg }]}>{tally.na}</Text>
          <Text style={ss.tallyLabel}>N/A</Text>
        </View>
      </View>

      {/* Identity metabox */}
      <View style={ss.summaryMeta}>
        {metaRows.map((r) => (
          <ResultRow
            key={r.label}
            row={{ fieldId: r.label, label: r.label, kind: 'value', value: r.value }}
          />
        ))}
      </View>

      {/* Failed fields list */}
      {failed.length === 0 ? (
        <Text style={ss.failedEmpty}>No failed fields.</Text>
      ) : (
        <View>
          <Text style={ss.failedHeading}>Failed fields ({failed.length})</Text>
          {failed.map((f, i) => (
            <View key={i}>
              <Text style={ss.failedItem}>{f.label}</Text>
              {f.sansRef && <Text style={ss.failedSansRef}>{f.sansRef}</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// SectionContent — renders rows, groups, photoFields for one ReportSection
// ---------------------------------------------------------------------------

/** A section's blocks in order. `small` marks one that fits well inside a page (one entry, or at
 *  most one row of photos), the only kind its heading may be bound to. */
function sectionBlocks(section: ReportSection, accent: string): Array<{ node: React.ReactNode; small: boolean }> {
  const oneRow = (n: number) => n <= spacing.photoGridCols
  return [
    // Non-group rows in template order, each with the photos taken against it
    ...section.rows.map((row) => ({
      node: <EntryWithPhotos key={row.fieldId} row={row} accent={accent} />,
      small: oneRow(row.photos?.photos.length ?? 0),
    })),
    // Repeating groups
    ...section.groups.map((group) => ({ node: <GroupBlock key={group.fieldId} group={group} accent={accent} />, small: false })),
    // Photo fields
    ...photoFieldBlocks(section.photoFields).map((pf) => ({ node: <PhotoGrid key={pf.fieldId} field={pf} accent={accent} />, small: oneRow(pf.photos.length) })),
  ]
}

/**
 * Consecutive photo fields holding one photo each print as one grid, three across, each photo
 * captioned with its field ("Board (Open)", "Meter"). One block per field left most of every page
 * empty on a photo-only audit (Shoprite: 13 pages for 27 photos).
 */
function photoFieldBlocks(fields: ReportPhotoField[]): ReportPhotoField[] {
  const out: ReportPhotoField[] = []
  let run: ReportPhotoField[] = []
  const flush = () => {
    if (run.length === 1) out.push(run[0])
    else if (run.length > 1) {
      out.push({
        sectionId: run[0].sectionId,
        fieldId: run.map((f) => f.fieldId).join('+'),
        label: '',
        photos: run.map((f) => ({ ...f.photos[0], caption: f.photos[0].caption ? `${f.label} · ${f.photos[0].caption}` : f.label })),
        omittedCount: 0,
      })
    }
    run = []
  }
  for (const f of fields) {
    if (f.photos.length === 1 && f.omittedCount === 0) run.push(f)
    else {
      flush()
      out.push(f)
    }
  }
  flush()
  // One block per row of photos (label on the first only): every block is then small enough to
  // travel with its section heading, so a heading never ends a page alone (W-11, 2026-10-13).
  const rows: ReportPhotoField[] = []
  for (const f of out) {
    if (f.photos.length <= spacing.photoGridCols) {
      rows.push(f)
      continue
    }
    for (let i = 0; i < f.photos.length; i += spacing.photoGridCols) {
      const last = i + spacing.photoGridCols >= f.photos.length
      rows.push({
        ...f,
        fieldId: `${f.fieldId}#${i}`,
        label: i === 0 ? f.label : '',
        photos: f.photos.slice(i, i + spacing.photoGridCols),
        omittedCount: last ? f.omittedCount : 0,
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// EntryWithPhotos — an entry and the photos taken against it, kept on one page
// when they fit one photo row (a check at a page foot with its photo overleaf
// reads as two unrelated things).
// ---------------------------------------------------------------------------

function EntryWithPhotos({ row, accent }: { row: ReportFieldRow; accent: string }) {
  if (!row.photos) return <ResultRow row={row} />
  return (
    <View wrap={row.photos.photos.length > spacing.photoGridCols}>
      <ResultRow row={row} />
      <PhotoGrid field={row.photos} accent={accent} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// GroupBlock — group label sub-heading + per-entry rows
// ---------------------------------------------------------------------------

function GroupBlock({ group, accent }: { group: ReportGroup; accent: string }) {
  return (
    <View>
      <Text style={ss.groupLabel}>{group.label}</Text>
      {group.entries.map((entry) => (
        <View key={entry.index}>
          <Text style={ss.groupEntryLabel}>Entry {entry.index + 1}</Text>
          {entry.rows.map((row) => (
            <EntryWithPhotos key={row.fieldId} row={row} accent={accent} />
          ))}
        </View>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------
// InspectionReportDocument
// ---------------------------------------------------------------------------

export interface InspectionReportDocumentProps {
  data: InspectionReportData
  branding: ResolvedBranding
}

export function InspectionReportDocument({ data, branding }: InspectionReportDocumentProps) {
  const { accent, issuer, title } = branding

  const auditRows = data.audit.map((a) => [
    formatWhen(a.at),
    a.fieldLabel ?? a.fieldId ?? a.sectionId ?? '—',
    a.by,
  ])

  return (
    <Document title="Inspection &amp; Test Report" producer="e-site.live">
      <Page size="A4" style={s.page}>
        {/*
         * Footer decision — Option (b):
         * Cover already renders its own fixed page-numbered footer via its
         * internal <View style={s.footer} fixed> block. To avoid double
         * footers, we render ONLY RunningHeader (fixed) as the running header
         * and rely on Cover's built-in footer as the single running footer.
         * RunningFooter is NOT rendered here; contractor is null in Phase 1.
         */}
        <RunningHeader
          issuerLogoDataUri={issuer.logoSrc ?? null}
          title={title}
          accent={accent}
        />

        {/* Cover — reused verbatim; includes its own fixed footer */}
        <Cover resolved={branding} />

        {/* Summary — identity metabox + overall result + tally + failed list */}
        <Section title="Summary" accent={accent}>
          <Summary summary={data.summary} accent={accent} />
        </Section>

        {/* Per-section content: rows → groups → photoFields */}
        {data.sections.map((section) => (
          // The section's first block travels with its heading (see Section's `lead`).
          (() => {
            const blocks = sectionBlocks(section, accent)
            const lead = blocks[0]?.small ? blocks[0].node : undefined
            return (
              <Section key={section.sectionId} title={section.title} accent={accent} lead={lead}>
                {(lead ? blocks.slice(1) : blocks).map((b) => b.node)}
              </Section>
            )
          })()
        ))}

        {/* Annexures */}
        <Section title="Annexures" accent={accent}>
          <AnnexureList annexures={data.annexures} />
        </Section>

        {/* Signatures */}
        <Section title="Signatures" accent={accent}>
          {data.signatures.map((sig) => (
            <SignatureBlock key={sig.role} signature={sig} />
          ))}
        </Section>

        {/* Audit history */}
        <Section title="Audit history" accent={accent}>
          <Table columns={['When', 'Field', 'By']} rows={auditRows} />
        </Section>
      </Page>
    </Document>
  )
}
