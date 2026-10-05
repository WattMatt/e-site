// Node-only: renderToBuffer is not available in the browser build.
/**
 * The Load profile PDF: summary figures and notes, monthly energy/demand (and cost), TOU split,
 * average days, sources and data quality. Every string passes winAnsiSafe — react-pdf's standard
 * fonts silently draw the WRONG glyph outside WinAnsi (→ in a conversion note would print as ’).
 */
import React from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import type { ExportModel, Table } from './export-model'

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#1d1d1f' },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#555', marginBottom: 10 },
  h2: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', paddingVertical: 2 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#999', paddingVertical: 2, fontFamily: 'Helvetica-Bold' },
  cell: { flex: 1, paddingRight: 4 },
  note: { marginBottom: 2 },
  kpiLabel: { width: 150, color: '#555' },
  kpiValue: { width: 80, fontFamily: 'Helvetica-Bold', textAlign: 'right', paddingRight: 8 },
})

export const t = (v: string) => winAnsiSafe(v, { collapseWhitespace: false })

/** 1 234 567.8 — space-grouped, the form used across E-Site exports. */
export function fmtCell(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return t(v)
  const [i, d] = Math.abs(v).toString().split('.')
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${v < 0 ? '-' : ''}${grouped}${d ? `.${d}` : ''}`
}

function TableBlock({ table, maxRows }: { table: Table; maxRows?: number }) {
  const rows = maxRows ? table.rows.slice(0, maxRows) : table.rows
  return (
    <View wrap>
      <Text style={s.h2}>{t(table.title)}</Text>
      <View style={s.head} fixed>{table.header.map((h, i) => <Text key={i} style={s.cell}>{t(h)}</Text>)}</View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.row} wrap={false}>{r.map((c, ci) => <Text key={ci} style={s.cell}>{fmtCell(c)}</Text>)}</View>
      ))}
    </View>
  )
}

export function LoadProfileDocument({ model }: { model: ExportModel }) {
  return (
    <Document title={t(`${model.title} - ${model.subtitle}`)}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>{t(model.title)}</Text>
        <Text style={s.sub}>{t(model.subtitle)}</Text>
        {model.kpis.map(([label, value, unit], i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 2 }}>
            <Text style={s.kpiLabel}>{t(label)}</Text>
            <Text style={s.kpiValue}>{fmtCell(value)}</Text>
            <Text>{t(unit)}</Text>
          </View>
        ))}
        <Text style={s.h2}>Notes</Text>
        {model.notes.map((n, i) => <Text key={i} style={s.note}>{t(`- ${n}`)}</Text>)}
        <TableBlock table={model.monthly} />
        {model.cost && <TableBlock table={model.cost} />}
      </Page>
      <Page size="A4" orientation="landscape" style={s.page}>
        <TableBlock table={model.averageDays} />
      </Page>
      <Page size="A4" orientation="landscape" style={s.page}>
        <TableBlock table={model.sources} />
        <Text style={{ ...s.note, marginTop: 8, color: '#555' }}>
          {t('The 8 760-hour profile, the load duration curve and every bill line are in the Excel export.')}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderLoadProfilePdf(model: ExportModel): Promise<Buffer> {
  return renderToBuffer(React.createElement(LoadProfileDocument, { model }) as React.ReactElement<DocumentProps>)
}
