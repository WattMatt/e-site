/**
 * site-form-report.tsx
 *
 * react-pdf document for the Site Form (termination & making-safe) record.
 * Reuses the branded `Cover` + `pageStyles` from ./components verbatim.
 *
 * Document order:
 *   cover
 *   → summary (form no., board, as-left status, date of work, electrician,
 *              circuits left in a temporary state)
 *   → each template section in order, with its answers
 *   → repeating groups as tables (chunked when very wide)
 *   → photographic evidence with captions
 *   → defect register, C1 rows visually flagged (C1 = immediate danger)
 *   → signature blocks with embedded signature images + registration numbers
 *   → response audit history table
 *
 * MANDATORY: every page carries the NOT_A_COC_DISCLAIMER verbatim, in a
 * `fixed` footer. The constant is imported from @esite/shared (the same one the
 * distribution email uses) so the PDF and the email cannot drift apart.
 *
 * Node-only: any test importing the renderer must carry
 * `// @vitest-environment node` — the browser build stubs out renderToBuffer.
 */

// No 'use client' — server-side PDF rendering only.
import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { NOT_A_COC_DISCLAIMER } from '@esite/shared'
import { Cover, pageStyles } from './components'
import type {
  SiteFormReportData,
  SiteFormReportSection,
  SiteFormGroupTable,
  SiteFormPhotoField,
  SiteFormDefectRow,
  SiteFormSignatureBlock,
  SiteFormAuditEntry,
} from './site-form-report-data'
import { MAX_TABLE_COLUMNS } from './site-form-report-data'

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const C1_RED = '#B91C1C'
const C1_BG = '#FEE2E2'
const WARN_AMBER = '#B45309'

const s = StyleSheet.create({
  bodyPage: {
    paddingHorizontal: 36,
    paddingTop: 30,
    // Room for the running footer + the two-line legal disclaimer beneath it.
    paddingBottom: 62,
    fontFamily: 'Helvetica',
    backgroundColor: '#FFFFFF',
  },

  // ── Section headings ──────────────────────────────────────────────────────
  partHeader: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    color: '#333333',
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    paddingBottom: 3,
    marginTop: 18,
    marginBottom: 8,
  },
  partHeaderFirst: { marginTop: 0 },
  sectionHeader: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#222222',
    borderBottomWidth: 0.5,
    borderBottomColor: '#CCCCCC',
    paddingBottom: 2,
    marginTop: 12,
    marginBottom: 5,
  },
  subheading: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#555555',
    marginTop: 6,
    marginBottom: 3,
    lineHeight: 1.35,
  },
  empty: {
    fontSize: 7.5,
    color: '#AAAAAA',
    fontStyle: 'italic',
    marginBottom: 6,
  },

  // ── Summary block ─────────────────────────────────────────────────────────
  asLeftBox: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderLeftWidth: 3,
    borderRadius: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  asLeftLabel: {
    fontSize: 6.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#888888',
    marginBottom: 3,
  },
  asLeftValue: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
  },
  warnBox: {
    borderWidth: 1,
    borderColor: WARN_AMBER,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  warnText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: WARN_AMBER,
  },
  warnSub: {
    fontSize: 7,
    color: '#666666',
    marginTop: 2,
  },
  dangerBox: {
    borderWidth: 1,
    borderColor: C1_RED,
    backgroundColor: C1_BG,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  dangerText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C1_RED,
  },

  // ── Label / value rows ────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    marginBottom: 2.5,
    alignItems: 'flex-start',
  },
  rowLabel: {
    width: '46%',
    fontSize: 7.5,
    color: '#666666',
    paddingRight: 6,
    lineHeight: 1.3,
  },
  rowValue: {
    flex: 1,
    fontSize: 7.5,
    color: '#111111',
    lineHeight: 1.3,
  },
  rowValueMuted: {
    flex: 1,
    fontSize: 7.5,
    color: '#AAAAAA',
    lineHeight: 1.3,
  },
  paragraph: {
    fontSize: 7.5,
    color: '#111111',
    lineHeight: 1.4,
    marginBottom: 4,
    marginTop: 1,
  },
  sansRef: {
    fontSize: 6,
    color: '#999999',
  },
  failReason: {
    fontSize: 6.5,
    color: C1_RED,
    marginTop: 1,
  },

  // ── Pills ─────────────────────────────────────────────────────────────────
  pill: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 2,
    alignSelf: 'flex-start',
  },
  pillPass: { backgroundColor: '#D1FAE5', color: '#065F46' },
  pillFail: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  pillNa: { backgroundColor: '#F3F4F6', color: '#374151' },
  pillNone: { backgroundColor: '#F9FAFB', color: '#9CA3AF' },

  // ── Tables ────────────────────────────────────────────────────────────────
  tableTitle: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#444444',
    marginTop: 8,
    marginBottom: 3,
  },
  tableHeadRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 0.5,
    borderBottomColor: '#CCCCCC',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.25,
    borderBottomColor: '#EEEEEE',
  },
  tableRowC1: {
    flexDirection: 'row',
    borderBottomWidth: 0.25,
    borderBottomColor: '#EEEEEE',
    backgroundColor: C1_BG,
  },
  th: {
    fontSize: 5.8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    paddingVertical: 3,
    paddingHorizontal: 3,
  },
  td: {
    fontSize: 6,
    color: '#111111',
    paddingVertical: 3,
    paddingHorizontal: 3,
    lineHeight: 1.25,
  },
  tdC1: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    color: C1_RED,
    paddingVertical: 3,
    paddingHorizontal: 3,
    lineHeight: 1.25,
  },
  colNarrow: { width: 22 },

  // ── Photos ────────────────────────────────────────────────────────────────
  photoBlock: { marginBottom: 8 },
  photoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#444444',
    marginBottom: 3,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  photoCell: { width: '31.8%' },
  photoImage: {
    width: '100%',
    height: 95,
    objectFit: 'cover',
    borderRadius: 2,
  },
  photoCaption: {
    fontSize: 5.5,
    color: '#777777',
    marginTop: 2,
    lineHeight: 1.2,
  },
  omitted: {
    fontSize: 6.5,
    color: '#999999',
    fontStyle: 'italic',
    marginTop: 2,
  },

  // ── Signatures ────────────────────────────────────────────────────────────
  sigBlock: {
    borderWidth: 0.5,
    borderColor: '#DDDDDD',
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  sigRole: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#666666',
    marginBottom: 4,
  },
  sigName: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
  },
  sigMeta: {
    fontSize: 7,
    color: '#666666',
    marginTop: 1,
  },
  sigImage: {
    height: 46,
    maxWidth: 180,
    objectFit: 'contain',
    marginTop: 5,
  },
  sigMissing: {
    fontSize: 6.5,
    color: '#AAAAAA',
    fontStyle: 'italic',
    marginTop: 5,
  },

  // ── Footers ───────────────────────────────────────────────────────────────
  runningFooter: {
    position: 'absolute',
    bottom: 34,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#E0E0E0',
    paddingTop: 4,
  },
  runningFooterText: {
    fontSize: 6.5,
    color: '#AAAAAA',
  },
  disclaimer: {
    position: 'absolute',
    bottom: 12,
    left: 36,
    right: 36,
  },
  disclaimerText: {
    fontSize: 5.5,
    color: '#777777',
    lineHeight: 1.25,
    textAlign: 'justify',
  },
})

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/**
 * The regulatory disclaimer, repeated on EVERY page via react-pdf's `fixed`.
 * This is the entire reason the form exists: the record must never be mistaken
 * for a Certificate of Compliance.
 */
function DisclaimerFooter() {
  return (
    <View style={s.disclaimer} fixed>
      <Text style={s.disclaimerText}>{NOT_A_COC_DISCLAIMER}</Text>
    </View>
  )
}

function RunningFooter({ left }: { left: string }) {
  return (
    <View style={s.runningFooter} fixed>
      <Text style={s.runningFooterText}>{left}</Text>
      <Text
        style={s.runningFooterText}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const shown = value != null && value !== '' ? value : '—'
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={value ? s.rowValue : s.rowValueMuted}>{shown}</Text>
    </View>
  )
}

function PassPill({ pass }: { pass: 'pass' | 'fail' | 'na' | null | undefined }) {
  const style =
    pass === 'pass' ? s.pillPass : pass === 'fail' ? s.pillFail : pass === 'na' ? s.pillNa : s.pillNone
  const label = pass ? pass.toUpperCase() : 'NOT ANSWERED'
  return <Text style={[s.pill, style]}>{label}</Text>
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryBlock({ data }: { data: SiteFormReportData }) {
  const { summary, branding } = data
  const temp = summary.circuitsLeftTemporary
  return (
    <View>
      <Text style={[s.partHeader, s.partHeaderFirst]}>Summary</Text>

      <View style={[s.asLeftBox, { borderLeftColor: branding.accent }]}>
        <Text style={s.asLeftLabel}>Board left as</Text>
        <Text style={s.asLeftValue}>{summary.asLeftStatusText}</Text>
      </View>

      {temp > 0 && (
        <View style={s.warnBox}>
          <Text style={s.warnText}>
            {temp} circuit{temp === 1 ? '' : 's'} left in a temporary state
          </Text>
          <Text style={s.warnSub}>
            Do not assume these are permanent connections. Check section 5 before energising or
            working further.
          </Text>
        </View>
      )}

      {summary.c1Count > 0 && (
        <View style={s.dangerBox}>
          <Text style={s.dangerText}>
            {summary.c1Count} C1 defect{summary.c1Count === 1 ? '' : 's'} recorded — immediate
            danger present
          </Text>
        </View>
      )}

      <InfoRow label="Form number" value={summary.formNo} />
      <InfoRow label="Status" value={summary.status.toUpperCase()} />
      <InfoRow label="Board (as found)" value={summary.boardLabel} />
      <InfoRow label="Board reference" value={summary.boardRef} />
      <InfoRow
        label="Project"
        value={summary.projectCode ? `${summary.projectName} (${summary.projectCode})` : summary.projectName}
      />
      <InfoRow
        label="Form template"
        value={
          summary.templateVersion
            ? `${summary.templateName} v${summary.templateVersion}`
            : summary.templateName
        }
      />
      <InfoRow label="Date of work" value={summary.dateOfWork} />
      <InfoRow label="Electrician" value={summary.electricianName} />
      <InfoRow label="Registered person" value={summary.registeredPersonName} />
      <InfoRow label="Circuits acted upon" value={String(summary.circuitCount)} />
      <InfoRow label="Circuits left in a temporary state" value={String(temp)} />
      <InfoRow label="Defects recorded" value={String(summary.defectCount)} />
      <InfoRow label="Created by" value={summary.createdByName} />
      <InfoRow
        label="Submitted"
        value={
          summary.submittedAt
            ? `${summary.submittedAt}${summary.submittedByName ? ` · ${summary.submittedByName}` : ''}`
            : null
        }
      />
      <InfoRow
        label="Distributed"
        value={
          summary.distributedAt
            ? `${summary.distributedAt}${summary.distributedByName ? ` · ${summary.distributedByName}` : ''}`
            : null
        }
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Repeating-group tables
// ---------------------------------------------------------------------------

/** Split a wide table into column chunks so nothing runs off an A4 page. */
function chunkColumns<T>(cols: T[], size: number): T[][] {
  if (cols.length <= size) return [cols]
  const out: T[][] = []
  for (let i = 0; i < cols.length; i += size) out.push(cols.slice(i, i + size))
  return out
}

function GroupTable({ group }: { group: SiteFormGroupTable }) {
  const chunks = chunkColumns(group.columns, MAX_TABLE_COLUMNS)
  return (
    <View>
      <Text style={s.tableTitle}>{group.label}</Text>
      {chunks.map((cols, chunkIdx) => {
        const offset = chunkIdx * MAX_TABLE_COLUMNS
        const width = `${(100 / cols.length).toFixed(3)}%`
        return (
          <View key={`chunk-${chunkIdx}`} style={{ marginBottom: 4 }}>
            {chunkIdx > 0 && (
              <Text style={s.omitted}>{group.label} (continued)</Text>
            )}
            <View style={s.tableHeadRow}>
              <Text style={[s.th, s.colNarrow]}>#</Text>
              {cols.map((c) => (
                <Text key={c.fieldId} style={[s.th, { width }]}>
                  {c.label}
                </Text>
              ))}
            </View>
            {group.rows.map((row) => (
              <View key={`${chunkIdx}-${row.entryNo}`} style={s.tableRow} wrap={false}>
                <Text style={[s.td, s.colNarrow]}>{row.entryNo}</Text>
                {cols.map((c, i) => (
                  <Text key={c.fieldId} style={[s.td, { width }]}>
                    {row.cells[offset + i] || '—'}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Template sections
// ---------------------------------------------------------------------------

function SectionBlock({ section }: { section: SiteFormReportSection }) {
  return (
    <View>
      <Text style={s.sectionHeader}>{section.title}</Text>
      {section.rows.length === 0 && section.groups.length === 0 && (
        <Text style={s.empty}>No answers recorded.</Text>
      )}
      {section.rows.map((row) => {
        if (row.kind === 'subheading') {
          return (
            <Text key={row.fieldId} style={s.subheading}>
              {row.label}
            </Text>
          )
        }
        if (row.kind === 'result') {
          return (
            <View key={row.fieldId} style={s.row} wrap={false}>
              <Text style={s.rowLabel}>
                {row.label}
                {row.sansRef ? <Text style={s.sansRef}>{`  ${row.sansRef}`}</Text> : null}
              </Text>
              <View style={{ flex: 1 }}>
                <PassPill pass={row.pass} />
                {row.failReason ? <Text style={s.failReason}>{row.failReason}</Text> : null}
              </View>
            </View>
          )
        }
        if (row.kind === 'paragraph') {
          if (!row.value) return <InfoRow key={row.fieldId} label={row.label} value={null} />
          return (
            <View key={row.fieldId}>
              <Text style={s.rowLabel}>{row.label}</Text>
              <Text style={s.paragraph}>{row.value}</Text>
            </View>
          )
        }
        return <InfoRow key={row.fieldId} label={row.label} value={row.value} />
      })}
      {section.groups.map((group) => (
        <GroupTable key={group.fieldId} group={group} />
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Photographic evidence
// ---------------------------------------------------------------------------

function PhotoFieldBlock({ field }: { field: SiteFormPhotoField }) {
  if (field.photos.length === 0 && field.omittedCount === 0) return null
  return (
    <View style={s.photoBlock}>
      <Text style={s.photoLabel}>{field.label}</Text>
      <View style={s.photoGrid}>
        {field.photos.map((p) => (
          <View key={p.id} style={s.photoCell} wrap={false}>
            <Image src={p.dataUri} style={s.photoImage} />
            {p.caption ? <Text style={s.photoCaption}>{p.caption}</Text> : null}
          </View>
        ))}
      </View>
      {field.omittedCount > 0 && (
        <Text style={s.omitted}>
          + {field.omittedCount} further photo{field.omittedCount === 1 ? '' : 's'} not rendered.
        </Text>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Defect register
// ---------------------------------------------------------------------------

const DEFECT_COLS: Array<{ key: keyof SiteFormDefectRow; label: string; width: string }> = [
  { key: 'classification', label: 'Class', width: '8%' },
  { key: 'description', label: 'Description', width: '25%' },
  { key: 'location', label: 'Location', width: '14%' },
  { key: 'regulationReference', label: 'Reference', width: '13%' },
  { key: 'actionTaken', label: 'Action taken', width: '20%' },
  { key: 'actionBy', label: 'Action by', width: '12%' },
  { key: 'targetDate', label: 'Target', width: '8%' },
]

function DefectRegister({ defects }: { defects: SiteFormDefectRow[] }) {
  return (
    <View>
      <Text style={s.partHeader}>Defect register</Text>
      {defects.length === 0 ? (
        <Text style={s.empty}>No defects recorded.</Text>
      ) : (
        <>
          <View style={s.tableHeadRow}>
            <Text style={[s.th, s.colNarrow]}>#</Text>
            {DEFECT_COLS.map((c) => (
              <Text key={String(c.key)} style={[s.th, { width: c.width }]}>
                {c.label}
              </Text>
            ))}
          </View>
          {defects.map((d) => (
            <View key={d.entryNo} style={d.isC1 ? s.tableRowC1 : s.tableRow} wrap={false}>
              <Text style={[d.isC1 ? s.tdC1 : s.td, s.colNarrow]}>{d.entryNo}</Text>
              {DEFECT_COLS.map((c) => (
                <Text key={String(c.key)} style={[d.isC1 ? s.tdC1 : s.td, { width: c.width }]}>
                  {String(d[c.key] ?? '') || '—'}
                </Text>
              ))}
            </View>
          ))}
          {defects.some((d) => d.isC1) && (
            <Text style={[s.warnText, { marginTop: 5, color: C1_RED }]}>
              C1 — immediate danger present. The supply to the affected circuit must remain
              disconnected until the danger is removed.
            </Text>
          )}
        </>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

function SignatureBlock({ block }: { block: SiteFormSignatureBlock }) {
  const registration = [block.registrationCategory, block.registrationNumber]
    .filter(Boolean)
    .join(' · ')
  return (
    <View style={s.sigBlock} wrap={false}>
      <Text style={s.sigRole}>{block.blockLabel}</Text>
      <Text style={s.sigName}>{block.signatoryName}</Text>
      {block.signatoryRole ? <Text style={s.sigMeta}>{block.signatoryRole}</Text> : null}
      {registration ? <Text style={s.sigMeta}>Registration: {registration}</Text> : null}
      {block.signedAt ? <Text style={s.sigMeta}>Signed {block.signedAt}</Text> : null}
      {block.imageDataUri ? (
        <Image src={block.imageDataUri} style={s.sigImage} />
      ) : (
        <Text style={s.sigMissing}>Signature image unavailable.</Text>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Audit history
// ---------------------------------------------------------------------------

function AuditTable({
  audit,
  omittedCount,
}: {
  audit: SiteFormAuditEntry[]
  omittedCount: number
}) {
  return (
    <View>
      <Text style={s.partHeader}>Response audit history</Text>
      {audit.length === 0 ? (
        <Text style={s.empty}>No responses recorded.</Text>
      ) : (
        <>
          <View style={s.tableHeadRow} fixed>
            <Text style={[s.th, { width: '18%' }]}>When</Text>
            <Text style={[s.th, { width: '20%' }]}>Section</Text>
            <Text style={[s.th, { width: '27%' }]}>Field</Text>
            <Text style={[s.th, { width: '20%' }]}>Value</Text>
            <Text style={[s.th, { width: '15%' }]}>By</Text>
          </View>
          {audit.map((entry, i) => (
            <View key={`${entry.at ?? 'n'}-${i}`} style={s.tableRow} wrap={false}>
              <Text style={[s.td, { width: '18%' }]}>{entry.at ?? '—'}</Text>
              <Text style={[s.td, { width: '20%' }]}>{entry.sectionTitle}</Text>
              <Text style={[s.td, { width: '27%' }]}>{entry.fieldLabel}</Text>
              <Text style={[s.td, { width: '20%' }]}>{entry.value || '—'}</Text>
              <Text style={[s.td, { width: '15%' }]}>{entry.by}</Text>
            </View>
          ))}
          {omittedCount > 0 && (
            <Text style={s.omitted}>
              + {omittedCount} earlier audit entr{omittedCount === 1 ? 'y' : 'ies'} not rendered.
            </Text>
          )}
        </>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Main document
// ---------------------------------------------------------------------------

export function SiteFormReportDocument({ data }: { data: SiteFormReportData }) {
  const footerLeft = `${data.summary.formNo} · ${data.summary.boardLabel}`

  return (
    <Document title={data.branding.title} producer="e-site.live">
      {/* ── Cover ── */}
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={data.branding} />
        <DisclaimerFooter />
      </Page>

      {/* ── Body ── */}
      <Page size="A4" style={s.bodyPage}>
        <SummaryBlock data={data} />

        <Text style={s.partHeader}>Record</Text>
        {data.sections.length === 0 ? (
          <Text style={s.empty}>No sections captured.</Text>
        ) : (
          data.sections.map((section) => (
            <SectionBlock key={section.sectionId} section={section} />
          ))
        )}

        <Text style={s.partHeader}>Photographic evidence</Text>
        {data.photoFields.length === 0 ? (
          <Text style={s.empty}>No photographs captured.</Text>
        ) : (
          data.photoFields.map((field) => (
            <PhotoFieldBlock key={`${field.sectionId}|${field.fieldId}`} field={field} />
          ))
        )}

        <DefectRegister defects={data.defects} />

        <Text style={s.partHeader}>Declarations and sign-off</Text>
        {data.signatures.length === 0 ? (
          <Text style={s.empty}>No signatures captured.</Text>
        ) : (
          data.signatures.map((block) => <SignatureBlock key={block.blockId} block={block} />)
        )}

        <AuditTable audit={data.audit} omittedCount={data.auditOmittedCount} />

        <RunningFooter left={footerLeft} />
        <DisclaimerFooter />
      </Page>
    </Document>
  )
}
