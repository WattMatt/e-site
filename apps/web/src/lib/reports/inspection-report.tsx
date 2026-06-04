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

function SectionContent({ section, accent }: { section: ReportSection; accent: string }) {
  return (
    <>
      {/* Non-group rows in template order */}
      {section.rows.map((row) => (
        <ResultRow key={row.fieldId} row={row} />
      ))}

      {/* Repeating groups */}
      {section.groups.map((group) => (
        <GroupBlock key={group.fieldId} group={group} />
      ))}

      {/* Photo fields */}
      {section.photoFields.map((pf) => (
        <PhotoGrid key={pf.fieldId} field={pf} accent={accent} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// GroupBlock — group label sub-heading + per-entry rows
// ---------------------------------------------------------------------------

function GroupBlock({ group }: { group: ReportGroup }) {
  return (
    <View>
      <Text style={ss.groupLabel}>{group.label}</Text>
      {group.entries.map((entry) => (
        <View key={entry.index}>
          <Text style={ss.groupEntryLabel}>Entry {entry.index + 1}</Text>
          {entry.rows.map((row) => (
            <ResultRow key={row.fieldId} row={row} />
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
    a.fieldId ?? a.sectionId ?? '—',
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
          <Section key={section.sectionId} title={section.title} accent={accent}>
            <SectionContent section={section} accent={accent} />
          </Section>
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
