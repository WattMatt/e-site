/**
 * valuation-report.tsx
 *
 * react-pdf document for the Payment Certificate. Reuses the existing branded
 * Cover verbatim from components.tsx and mirrors the snag-visit-report layout
 * shape (cover page + a body page with a fixed running footer).
 *
 * Layout:
 *   Cover page  — branded Cover ("Payment Certificate No. N")
 *   Body page   — per-bill schedule table
 *                 → summary block (Gross / less Retention / = Net to date /
 *                   less Previously certified / = Due this certificate ex VAT /
 *                   VAT @ 15% / Total due incl VAT)
 *                 → signature strip (Engineer/PQS + Contractor)
 *
 * Node-only: renderToBuffer is not available in the browser build. Any test
 * file that imports renderValuationReport must carry // @vitest-environment node.
 */

// No 'use client' — server-side PDF rendering only.
import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { Cover, Document, pageStyles } from './components'
import type { ValuationReportData, CertificateBill, CertificateSummary } from './valuation-report-data'

// ---------------------------------------------------------------------------
// Money formatting — South African Rand, thousands-separated, 2dp.
// ---------------------------------------------------------------------------

function money(n: number): string {
  const neg = n < 0
  const abs = Math.abs(n)
  const fixed = abs.toFixed(2)
  const [whole, frac] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg ? '-' : ''}R ${grouped}.${frac}`
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  body: {
    paddingHorizontal: 40,
    paddingTop: 28,
    paddingBottom: 48, // room for the running footer
    flex: 1,
  },

  // Status pill (top of body)
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  statusMeta: {
    fontSize: 9,
    color: '#555555',
  },
  statusPill: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusDraft: { backgroundColor: '#FEF9C3', color: '#854D0E' },
  statusCertified: { backgroundColor: '#DCFCE7', color: '#166534' },

  // Section group header
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

  // ── Per-bill table ─────────────────────────────────────────────────────────
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 0.5,
    borderBottomColor: '#D1D5DB',
  },
  tableBodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEEEEE',
  },
  tableTotalRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#888888',
    backgroundColor: '#FAFAFA',
  },
  th: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  td: {
    fontSize: 8,
    fontFamily: 'Helvetica',
    color: '#222222',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tdBold: {
    fontFamily: 'Helvetica-Bold',
  },
  // Columns: Bill (flex 3), Gross (flex 2, right), This period (flex 2, right), Retention (flex 2, right)
  colBill: { flex: 3 },
  colNum: { flex: 2, textAlign: 'right' },

  // ── Summary block ──────────────────────────────────────────────────────────
  summaryBlock: {
    marginTop: 18,
    alignSelf: 'flex-end',
    width: '60%',
    borderWidth: 0.5,
    borderColor: '#D1D5DB',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEEEEE',
  },
  summaryRowEmphasis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E0E0E0',
  },
  summaryRowFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: '#888888',
  },
  summaryLabel: {
    fontSize: 8.5,
    color: '#444444',
  },
  summaryLabelEmphasis: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#222222',
  },
  summaryValue: {
    fontSize: 8.5,
    fontFamily: 'Helvetica',
    color: '#222222',
  },
  summaryValueEmphasis: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
  },

  // ── Signature strip ────────────────────────────────────────────────────────
  signatureStrip: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 28,
  },
  signatureSlot: {
    flex: 1,
  },
  signatureRole: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#888888',
    marginBottom: 22,
  },
  signatureLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#888888',
    paddingTop: 4,
  },
  signatureName: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#222222',
  },
  signatureCaption: {
    fontSize: 7,
    color: '#888888',
    marginTop: 1,
  },

  // ── Running footer ──────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
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

function BillScheduleTable({ bills }: { bills: CertificateBill[] }) {
  const totalGross = bills.reduce((acc, b) => acc + b.grossToDate, 0)
  const totalThisPeriod = bills.reduce((acc, b) => acc + b.thisPeriod, 0)
  const totalRetention = bills.reduce((acc, b) => acc + b.retention, 0)

  return (
    <View>
      <View style={s.tableHeaderRow}>
        <Text style={[s.th, s.colBill]}>Bill</Text>
        <Text style={[s.th, s.colNum]}>Gross to date</Text>
        <Text style={[s.th, s.colNum]}>This period</Text>
        <Text style={[s.th, s.colNum]}>Retention</Text>
      </View>

      {bills.map((b, i) => (
        <View key={i} style={s.tableBodyRow} wrap={false}>
          <Text style={[s.td, s.colBill]}>{b.code ? `${b.code} · ${b.title}` : b.title}</Text>
          <Text style={[s.td, s.colNum]}>{money(b.grossToDate)}</Text>
          <Text style={[s.td, s.colNum]}>{money(b.thisPeriod)}</Text>
          <Text style={[s.td, s.colNum]}>{money(b.retention)}</Text>
        </View>
      ))}

      <View style={s.tableTotalRow} wrap={false}>
        <Text style={[s.td, s.tdBold, s.colBill]}>Total</Text>
        <Text style={[s.td, s.tdBold, s.colNum]}>{money(totalGross)}</Text>
        <Text style={[s.td, s.tdBold, s.colNum]}>{money(totalThisPeriod)}</Text>
        <Text style={[s.td, s.tdBold, s.colNum]}>{money(totalRetention)}</Text>
      </View>
    </View>
  )
}

function SummaryBlock({ summary }: { summary: CertificateSummary }) {
  return (
    <View style={s.summaryBlock} wrap={false}>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>Gross to date</Text>
        <Text style={s.summaryValue}>{money(summary.grossToDate)}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>less Retention</Text>
        <Text style={s.summaryValue}>{money(-summary.retention)}</Text>
      </View>
      <View style={s.summaryRowEmphasis}>
        <Text style={s.summaryLabelEmphasis}>= Net to date</Text>
        <Text style={s.summaryValueEmphasis}>{money(summary.netToDate)}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>less Previously certified</Text>
        <Text style={s.summaryValue}>{money(-summary.previousNet)}</Text>
      </View>
      <View style={s.summaryRowEmphasis}>
        <Text style={s.summaryLabelEmphasis}>= Due this certificate (ex VAT)</Text>
        <Text style={s.summaryValueEmphasis}>{money(summary.dueExVat)}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>VAT @ 15%</Text>
        <Text style={s.summaryValue}>{money(summary.vat)}</Text>
      </View>
      <View style={s.summaryRowFinal}>
        <Text style={s.summaryLabelEmphasis}>Total due (incl VAT)</Text>
        <Text style={s.summaryValueEmphasis}>{money(summary.dueInclVat)}</Text>
      </View>
    </View>
  )
}

function SignatureStrip({ certifiedByName }: { certifiedByName: string | null }) {
  return (
    <View style={s.signatureStrip}>
      <View style={s.signatureSlot}>
        <Text style={s.signatureRole}>Certified by — Engineer / PQS</Text>
        <View style={s.signatureLine}>
          <Text style={s.signatureName}>{certifiedByName ?? ' '}</Text>
          <Text style={s.signatureCaption}>Signature · Date</Text>
        </View>
      </View>
      <View style={s.signatureSlot}>
        <Text style={s.signatureRole}>Acknowledged — Contractor</Text>
        <View style={s.signatureLine}>
          <Text style={s.signatureName}> </Text>
          <Text style={s.signatureCaption}>Signature · Date</Text>
        </View>
      </View>
    </View>
  )
}

function RunningFooter({ certLabel }: { certLabel: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Payment Certificate · {certLabel}</Text>
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

export function ValuationReportDocument({ data }: { data: ValuationReportData }) {
  const { valuation } = data
  const certLabel = `No. ${valuation.no}`
  const isCertified = valuation.status === 'certified'

  return (
    <Document title={data.branding.title} producer="e-site.live">
      {/* ── Cover page ── */}
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={data.branding} />
      </Page>

      {/* ── Body page ── */}
      <Page size="A4" style={pageStyles.page}>
        <View style={s.body}>
          {/* Status + retention meta */}
          <View style={s.statusRow}>
            <Text style={s.statusMeta}>
              Valuation date {valuation.date} · Retention {valuation.retentionPct}%
            </Text>
            <Text style={[s.statusPill, isCertified ? s.statusCertified : s.statusDraft]}>
              {isCertified ? 'Certified' : 'Draft'}
            </Text>
          </View>

          {/* Per-bill schedule */}
          <Text style={s.groupHeader}>Schedule by bill</Text>
          <BillScheduleTable bills={data.bills} />

          {/* Summary */}
          <Text style={s.groupHeader}>Certificate summary</Text>
          <SummaryBlock summary={data.summary} />

          {/* Signatures */}
          <SignatureStrip certifiedByName={data.certifiedByName} />
        </View>
        <RunningFooter certLabel={certLabel} />
      </Page>
    </Document>
  )
}
