// No 'use client' — rendered server-side to PDF only.
import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from './branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import { orderStateLabel, scopeStateLabel, type ShopRow } from './tenant-schedule-report-compute'
import { Cover, pageStyles as s } from './components'
import { RunningHeader, RunningFooter, Section, Table } from './interior'

const ss = StyleSheet.create({
  groupHeading: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: 118, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#F5F5F4', borderRadius: 4 },
  cardLabel: { fontSize: 8, color: '#6B7280', marginBottom: 3 },
  cardValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111827' },
  cardSub: { fontSize: 7, color: '#9CA3AF', marginTop: 2 },
})

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={ss.card}>
      <Text style={ss.cardLabel}>{label}</Text>
      <Text style={ss.cardValue}>{value}</Text>
      {sub ? <Text style={ss.cardSub}>{sub}</Text> : null}
    </View>
  )
}

function StatGroup({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={[ss.groupHeading, { color: accent }]}>{title}</Text>
      <View style={ss.cardRow}>{children}</View>
    </View>
  )
}

const shopCell = (r: ShopRow): string[] => [
  r.shopNumber,
  r.tenantName,
  r.glaM2 != null ? r.glaM2.toLocaleString('en-ZA') : '—',
  r.breakerA != null ? (r.poleConfig ? `${r.breakerA} A ${r.poleConfig}` : `${r.breakerA} A`) : '—',
  orderStateLabel(r.db),
  orderStateLabel(r.lights),
  scopeStateLabel(r.scope),
  r.layoutIssued ? 'Issued' : 'Not issued',
  r.boDate ? (r.boOverdue ? `${r.boDate} (overdue)` : r.boDate) : '—',
]

export interface TenantScheduleReportDocumentProps {
  data: TenantScheduleReportData
  branding: ResolvedBranding
}

export function TenantScheduleReportDocument({ data, branding }: TenantScheduleReportDocumentProps) {
  const { accent, issuer, title } = branding
  const { kpis, shopRows } = data

  return (
    <Document title="Tenant Schedule Report" producer="e-site.live">
      <Page size="A4" style={s.page}>
        <Cover resolved={branding} />
      </Page>

      <Page size="A4" style={s.page}>
        <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

        <Section title="Project KPIs" accent={accent}>
          <StatGroup title="Shops & GLA" accent={accent}>
            <StatCard label="Total shops" value={String(kpis.totalShops)} />
            <StatCard label="Active" value={String(kpis.activeShops)} />
            <StatCard label="Decommissioned" value={String(kpis.decommissionedShops)} />
            <StatCard label="Total GLA" value={`${kpis.totalGlaM2.toLocaleString('en-ZA')} m²`} />
          </StatGroup>

          <StatGroup title="Scope & layout completion" accent={accent}>
            <StatCard label="Scope complete" value={`${kpis.scopeCompletePct}%`} sub="received or landlord-covered" />
            <StatCard label="Layouts issued" value={`${kpis.layoutsIssuedPct}%`} />
          </StatGroup>

          <StatGroup title="Landlord procurement — boards & lights" accent={accent}>
            <StatCard label="Boards ordered" value={`${kpis.boards.ordered} / ${kpis.boards.landlord}`} sub="ordered / landlord to order" />
            <StatCard label="Lights ordered" value={`${kpis.lights.ordered} / ${kpis.lights.landlord}`} sub="ordered / landlord to order" />
            <StatCard label="By tenant" value={String(kpis.byTenantCount)} sub="boards + lights tenant-supplied" />
          </StatGroup>

          <StatGroup title="BO readiness" accent={accent}>
            <StatCard label="Upcoming" value={String(kpis.bo.upcoming)} />
            <StatCard label="Overdue" value={String(kpis.bo.overdue)} />
            <StatCard label="No date set" value={String(kpis.bo.noDate)} />
          </StatGroup>
        </Section>
      </Page>

      <Page size="A4" style={s.page}>
        <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

        <Section title="Shop summary" accent={accent}>
          <Table
            columns={['Shop', 'Tenant', 'GLA m²', 'Breaker', 'DB', 'Lights', 'Scope', 'Layout', 'BO date']}
            rows={shopRows.length > 0 ? shopRows.map(shopCell) : [['—', 'No active shops', '—', '—', '—', '—', '—', '—', '—']]}
            repeatHeader
            unbreakableRows
            align={['left', 'left', 'right', 'right', 'left', 'left', 'left', 'left', 'left']}
          />
        </Section>
      </Page>
    </Document>
  )
}
