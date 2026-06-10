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
  // Narrative paragraph
  prose: {
    fontSize: spacing.rowValueFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
    marginBottom: spacing.smallGap,
  },
  // Appendix C zone group (board/centre)
  zoneGroup: {
    marginBottom: spacing.rowGap,
  },
  zoneGroupHeading: {
    fontSize: spacing.rowLabelFontSize,
    fontFamily: 'Helvetica-Bold',
    marginTop: spacing.smallGap,
    marginBottom: 2,
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
// Prose — narrative paragraphs, separated by blank lines
// ---------------------------------------------------------------------------

function Prose({ text }: { text: string }) {
  const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean)
  return (
    <>
      {paragraphs.map((p, i) => (
        <Text key={i} style={ss.prose}>{p}</Text>
      ))}
    </>
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
  const { model, breakdown, settings, narrative, zoneSummaries, zoneByShop } = data

  // ── Appendix A — Capital cost ──────────────────────────────────────────────
  const capitalRows: string[][] = [
    ['Generators', zar(breakdown.generators)],
    ['Board modifications', zar(breakdown.boardMods)],
    ['Supply cabling', zar(breakdown.cabling)],
    ['Control wiring', zar(breakdown.controlWiring)],
    ['Total capital cost', zar(breakdown.total)],
  ]

  // ── Appendix C — Tenant allocation, grouped by zone (board/centre) ──────────
  const tenantMonthlySum = model.allocations
    .filter((a) => a.participation === 'shared')
    .reduce((sum, a) => sum + a.monthly, 0)

  const allocRow = (a: (typeof model.allocations)[number]): string[] => {
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
  }

  // Bucket allocations by zone; subtotal the shared monthly per zone.
  const groupsMap = new Map<string, string[][]>()
  const subtotalMap = new Map<string, number>()
  for (const a of model.allocations) {
    const zoneName = zoneByShop[a.shopNumber] ?? 'Unzoned'
    if (!groupsMap.has(zoneName)) groupsMap.set(zoneName, [])
    groupsMap.get(zoneName)!.push(allocRow(a))
    if (a.participation === 'shared') {
      subtotalMap.set(zoneName, (subtotalMap.get(zoneName) ?? 0) + a.monthly)
    }
  }
  // Order: zones as the sizing table lists them, then any extras (e.g. Unzoned).
  const zoneOrder = zoneSummaries.map((z) => z.zoneName)
  const orderedZones = [
    ...zoneOrder.filter((z) => groupsMap.has(z)),
    ...[...groupsMap.keys()].filter((z) => !zoneOrder.includes(z)),
  ]
  const allocationGroups = orderedZones.map((zoneName) => ({
    zoneName,
    rows: groupsMap.get(zoneName)!,
    subtotal: subtotalMap.get(zoneName) ?? 0,
  }))
  // Suppress the heading when there is just a single unzoned bucket.
  const showZoneHeadings = !(
    allocationGroups.length === 1 && allocationGroups[0].zoneName === 'Unzoned'
  )

  // ── Plant Sizing table — per-zone connected load → required kVA ────────────
  const sizingRows: string[][] = zoneSummaries.map((z) => [
    z.zoneName,
    z.totalLoadKw.toFixed(2),
    z.requiredKva.toFixed(1),
    z.installedKva > 0 ? z.installedKva.toFixed(0) : '—',
  ])
  if (sizingRows.length > 0) {
    sizingRows.push([
      'Total',
      zoneSummaries.reduce((sum, z) => sum + z.totalLoadKw, 0).toFixed(2),
      zoneSummaries.reduce((sum, z) => sum + z.requiredKva, 0).toFixed(1),
      zoneSummaries.reduce((sum, z) => sum + z.installedKva, 0).toFixed(0),
    ])
  }

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

        {/* Narrative — standing report sections (precede the calculated tables) */}
        <Section title="Introduction" accent={accent}>
          <Prose text={narrative.introduction} />
        </Section>

        <Section title="Plant Sizing" accent={accent}>
          <Prose text={narrative.plantSizing} />
          {sizingRows.length > 0 && (
            <Table
              columns={['Board / Zone', 'Connected load (kW)', 'Required (kVA)', 'Installed (kVA)']}
              rows={sizingRows}
            />
          )}
        </Section>

        <Section title="Outline of System" accent={accent}>
          <Prose text={narrative.systemOutline} />
        </Section>

        <Section title="Switching System" accent={accent}>
          <Prose text={narrative.switching} />
        </Section>

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

        {/* Appendix C — Tenant allocation, grouped by zone (board/centre) */}
        <Section title="Appendix C — Tenant allocation" accent={accent}>
          {allocationGroups.map((g) => (
            <View key={g.zoneName} style={ss.zoneGroup}>
              {showZoneHeadings && (
                <Text style={[ss.zoneGroupHeading, { color: accent }]}>{g.zoneName}</Text>
              )}
              <Table
                columns={['Shop', 'Tenant', 'Area m²', 'Loading kW', '% of total', 'Monthly (excl VAT)', 'R/m²']}
                rows={[...g.rows, ['', 'Subtotal', '', '', '', zar(g.subtotal), '']]}
              />
            </View>
          ))}
          {/* Grand total reconciliation */}
          <Text style={ss.reconciliation}>
            {'Total tenant monthly '}
            <Text style={ss.reconciliationMatch}>{zar(tenantMonthlySum)}</Text>
            {' = monthly repayment '}
            <Text style={ss.reconciliationMatch}>{zar(model.monthlyCapitalRepayment)}</Text>
          </Text>
        </Section>
      </Page>
    </Document>
  )
}
