// No 'use client' — rendered server-side to PDF only.
import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { spacing } from './theme'
import type { ResolvedBranding } from './branding'
import type { GeneratorReportData } from './generator-report-data'
import { Cover, pageStyles as s } from './components'
import { RunningHeader, Section, Table } from './interior'

// ---------------------------------------------------------------------------
// Local helper — South African Rand formatter
// ---------------------------------------------------------------------------

function zar(n: number): string {
  return (
    'R ' +
    n.toLocaleString('en-ZA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

// ---------------------------------------------------------------------------
// Styles (document-specific)
// ---------------------------------------------------------------------------

const ss = StyleSheet.create({
  // Key/value line row (Appendix B)
  kvRow: {
    flexDirection: 'row',
    marginBottom: spacing.rowGap,
    gap: spacing.smallGap,
  },
  kvLabel: {
    fontSize: spacing.rowLabelFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
    flex: 1,
  },
  kvValue: {
    fontSize: spacing.rowValueFontSize,
    color: '#111827',
    fontFamily: 'Helvetica',
    flex: 1,
  },
  kvLabelBold: {
    fontSize: spacing.rowLabelFontSize,
    color: '#111827',
    fontFamily: 'Helvetica-Bold',
    flex: 1,
  },
  kvValueBold: {
    fontSize: spacing.rowValueFontSize,
    color: '#111827',
    fontFamily: 'Helvetica-Bold',
    flex: 1,
  },
  // Reconciliation line (Appendix C)
  reconciliation: {
    marginTop: spacing.sectionGap,
    fontSize: spacing.rowLabelFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
  },
  reconciliationMatch: {
    color: '#166534',
    fontFamily: 'Helvetica-Bold',
  },
})

// ---------------------------------------------------------------------------
// KeyValue — single key/value line for Appendix B
// ---------------------------------------------------------------------------

interface KeyValueProps {
  label: string
  value: string
  bold?: boolean
}

function KeyValue({ label, value, bold }: KeyValueProps) {
  return (
    <View style={ss.kvRow}>
      <Text style={bold ? ss.kvLabelBold : ss.kvLabel}>{label}</Text>
      <Text style={bold ? ss.kvValueBold : ss.kvValue}>{value}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// GeneratorReportDocument
// ---------------------------------------------------------------------------

export interface GeneratorReportDocumentProps {
  data: GeneratorReportData
  branding: ResolvedBranding
}

export function GeneratorReportDocument({ data, branding }: GeneratorReportDocumentProps) {
  const { accent, issuer, title } = branding
  const { model, breakdown, settings } = data

  // ── Appendix A — Capital cost ──────────────────────────────────────────────
  const capitalRows: string[][] = [
    ['Generators', zar(breakdown.generators)],
    ['Board modifications', zar(breakdown.boardMods)],
    ['Supply cabling', zar(breakdown.cabling)],
    ['Control wiring', zar(breakdown.controlWiring)],
    ['Total capital cost', zar(breakdown.total)],
  ]

  // ── Appendix C — Tenant allocation ────────────────────────────────────────
  const allocationRows: string[][] = model.allocations.map((a) => {
    const isOptOut = a.participation !== 'shared'
    return [
      a.shopNumber,
      a.shopName,
      a.areaM2.toFixed(0),
      isOptOut ? '—' : a.loadingKw.toFixed(2),
      isOptOut ? '—' : `${a.portionPercent.toFixed(2)}%`,
      isOptOut ? '—' : zar(a.monthly),
      isOptOut ? 'R0' : zar(a.ratePerSqm),
    ]
  })

  const tenantMonthlySum = model.allocations
    .filter((a) => a.participation === 'shared')
    .reduce((sum, a) => sum + a.monthly, 0)

  // Total row
  allocationRows.push([
    '',
    'Total',
    '',
    '',
    '',
    zar(tenantMonthlySum),
    '',
  ])

  return (
    <Document title="Generator Cost Recovery Report" producer="e-site.live">
      <Page size="A4" style={s.page}>
        {/*
         * RunningHeader (fixed) on every interior page.
         * Cover provides its own fixed footer — no RunningFooter needed.
         */}
        <RunningHeader
          issuerLogoDataUri={issuer.logoSrc ?? null}
          title={title}
          accent={accent}
        />

        {/* Cover */}
        <Cover resolved={branding} />

        {/* Appendix A — Capital cost breakdown */}
        <Section title="Appendix A — Capital cost" accent={accent}>
          <Table
            columns={['Item', 'Amount']}
            rows={capitalRows}
          />
        </Section>

        {/* Appendix B — Capital recovery + operational tariff */}
        <Section title="Appendix B — Capital recovery & operational tariff" accent={accent}>
          <KeyValue label="Capital cost" value={zar(breakdown.total)} />
          <KeyValue
            label="Recovery period"
            value={`${settings.capitalRecoveryPeriodYears} yrs`}
          />
          <KeyValue
            label="Recovery rate"
            value={`${settings.capitalRecoveryRatePercent}%`}
          />
          <KeyValue
            label="Monthly repayment"
            value={zar(model.monthlyCapitalRepayment)}
            bold
          />
          <KeyValue
            label="Diesel"
            value={`${zar(model.tariff.dieselPerKwh)}/kWh`}
          />
          <KeyValue
            label="Maintenance"
            value={`${zar(model.tariff.maintenancePerKwh)}/kWh`}
          />
          <KeyValue
            label="Contingency"
            value={`${settings.maintenanceContingencyPercent}%`}
          />
          <KeyValue
            label="Final tariff"
            value={`${zar(model.tariff.finalTariff)}/kWh`}
            bold
          />
        </Section>

        {/* Appendix C — Tenant allocation */}
        <Section title="Appendix C — Tenant allocation" accent={accent}>
          <Table
            columns={['Shop', 'Tenant', 'Area m²', 'Loading kW', '% of total', 'Monthly (excl VAT)', 'R/m²']}
            rows={allocationRows}
          />
          {/* Reconciliation line */}
          <Text style={ss.reconciliation}>
            {'Σ tenant monthly '}
            <Text style={ss.reconciliationMatch}>{zar(tenantMonthlySum)}</Text>
            {' = monthly repayment '}
            <Text style={ss.reconciliationMatch}>{zar(model.monthlyCapitalRepayment)}</Text>
          </Text>
        </Section>
      </Page>
    </Document>
  )
}
