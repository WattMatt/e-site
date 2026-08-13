// No 'use client' — rendered server-side to PDF only.
//
// Glyph rule: every string drawn here must be WinAnsi-encodable. react-pdf does
// not raise on an unencodable character — it truncates the code point to its low
// byte and draws a different letter (lib/pdf/winansi.ts). Payload strings are
// already sanitised in equipment-materials-report-compute.ts; any literal added
// below must be checked by hand. '—' (U+2014) and '·' (U+00B7) are safe;
// '✓', '◐', '○' and '→' are NOT.
import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from './branding'
import type { EquipmentMaterialsReportData } from './equipment-materials-report-data'
import type { EquipmentRegisterRow } from './equipment-materials-report-compute'
import { Cover, pageStyles as s } from './components'
import { RunningHeader, RunningFooter, Section, Table } from './interior'

const ss = StyleSheet.create({
  groupHeading: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: 118, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#F5F5F4', borderRadius: 4 },
  cardLabel: { fontSize: 8, color: '#6B7280', marginBottom: 3 },
  cardValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111827' },
  cardSub: { fontSize: 7, color: '#9CA3AF', marginTop: 2 },
  scopeNote: { fontSize: 8, color: '#6B7280', marginBottom: 10 },
  notesRow: { paddingLeft: 4, paddingRight: 4, paddingBottom: 3, marginTop: -2 },
  notesText: { fontSize: 6.5, color: '#6B7280', fontFamily: 'Helvetica' },
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

const REGISTER_COLUMNS = [
  'Board', 'Line', 'Status', 'Ordered', 'Received', 'Required by',
  'Schedule', 'Quote', 'Order instr.', 'Shop dwg',
]

const registerCells = (r: EquipmentRegisterRow): string[] => [
  r.board, r.line, r.status, r.ordered, r.received, r.requiredBy,
  r.rag, r.quote, r.orderInstruction, r.shopDrawing,
]

/** Rows grouped by their board kind, preserving the order compute emitted. */
function groupRows(rows: EquipmentRegisterRow[]): Array<{ label: string; rows: EquipmentRegisterRow[] }> {
  const out: Array<{ label: string; rows: EquipmentRegisterRow[] }> = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last.label === r.group) last.rows.push(r)
    else out.push({ label: r.group, rows: [r] })
  }
  return out
}

export interface EquipmentMaterialsReportDocumentProps {
  data: EquipmentMaterialsReportData
  branding: ResolvedBranding
}

export function EquipmentMaterialsReportDocument({ data, branding }: EquipmentMaterialsReportDocumentProps) {
  const { accent, issuer, title } = branding
  const { kpis, rows } = data
  // Notes print as sub-lines beneath their group rather than as an eleventh
  // column — a free-text note would otherwise squeeze every other column.
  const grouped = groupRows(rows)

  return (
    <Document title="Equipment & Materials Report" producer="e-site.live">
      <Page size="A4" style={s.page}>
        <Cover resolved={branding} />
      </Page>

      <Page size="A4" style={s.page}>
        <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

        <Section title="Procurement KPIs" accent={accent}>
          <Text style={ss.scopeNote}>
            {`Scope: all active boards.${
              kpis.decommissionedExcluded > 0
                ? ` ${kpis.decommissionedExcluded} decommissioned board${kpis.decommissionedExcluded === 1 ? '' : 's'} excluded.`
                : ''
            }`}
          </Text>

          <StatGroup title="Register" accent={accent}>
            <StatCard label="Boards" value={String(kpis.totalBoards)} />
            <StatCard label="Procurement lines" value={String(kpis.totalLines)} />
            <StatCard label="Decommissioned" value={String(kpis.decommissionedExcluded)} sub="excluded from this report" />
          </StatGroup>

          <StatGroup title="Status" accent={accent}>
            <StatCard label="Required" value={String(kpis.status.required)} />
            <StatCard label="Ordered" value={String(kpis.status.ordered)} />
            <StatCard label="Received" value={String(kpis.status.received)} sub={`${kpis.receivedPct}% of ${kpis.actionableLines} to procure`} />
            <StatCard label="By tenant" value={String(kpis.status.byTenant)} sub="tenant-supplied" />
          </StatGroup>

          <StatGroup title="Schedule health" accent={accent}>
            <StatCard label="Overdue" value={String(kpis.schedule.overdue)} />
            <StatCard label="Due soon" value={String(kpis.schedule.dueSoon)} />
            <StatCard label="On track" value={String(kpis.schedule.onTrack)} />
            <StatCard label="No date" value={String(kpis.schedule.noDate)} sub="no required-by date" />
          </StatGroup>

          <StatGroup title="Documents on file" accent={accent}>
            <StatCard label="Quote" value={`${kpis.documents.withQuote} / ${kpis.totalLines}`} />
            <StatCard label="Order instruction" value={`${kpis.documents.withOrderInstruction} / ${kpis.totalLines}`} />
            <StatCard label="Shop drawing" value={`${kpis.documents.withShopDrawing} / ${kpis.totalLines}`} />
          </StatGroup>
        </Section>
      </Page>

      {/* Landscape — ten columns do not fit A4 portrait. */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

        <Section title="Board register" accent={accent}>
          {grouped.length === 0 ? (
            <Table
              columns={REGISTER_COLUMNS}
              rows={[['—', 'No active boards', '—', '—', '—', '—', '—', '—', '—', '—']]}
              repeatHeader
              dense
            />
          ) : (
            grouped.map((g, gi) => (
              <View key={gi}>
                <Text style={[ss.groupHeading, { color: accent }]} minPresenceAhead={40}>{g.label}</Text>
                <Table
                  columns={REGISTER_COLUMNS}
                  rows={g.rows.map(registerCells)}
                  repeatHeader={gi === 0}
                  unbreakableRows
                  dense
                />
                {g.rows.some((r) => r.notes) && (
                  <View>
                    {g.rows.filter((r) => r.notes).map((r, ri) => (
                      <View key={ri} style={ss.notesRow}>
                        <Text style={ss.notesText}>{`${r.board} · ${r.line} — ${r.notes}`}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
        </Section>
      </Page>
    </Document>
  )
}
