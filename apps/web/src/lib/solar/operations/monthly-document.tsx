/**
 * Solar monthly report PDF (spec §10). Server-side react-pdf only (no 'use client'). Renders the
 * model built from the STORED snapshot verbatim — every string through pdfText().
 */
import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { Cover, Document, pageStyles } from '@/lib/reports/components'
import type { ReportSection, ReportTable } from '@esite/shared/solar-reports'
import { pdfText } from '@/lib/solar/reports/pdf-text'

export interface MonthlyReportModelView { title: string; kicker: string; sections: ReportSection[] }

const s = StyleSheet.create({
  body: { paddingBottom: 40 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4, color: '#222222' },
  table: { marginTop: 4, marginBottom: 8, borderTopWidth: 0.5, borderTopColor: '#999999' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD' },
  head: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: '#999999', backgroundColor: '#F4F5F7' },
  cell: { flex: 1, fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  cellHead: { flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 2.5, paddingHorizontal: 3 },
  num: { textAlign: 'right' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
})

function Table({ t, accent }: { t: ReportTable; accent: string }) {
  return (
    <View style={[s.table, { borderTopColor: accent }]}>
      <View style={s.head} fixed>
        {t.columns.map((c, i) => <Text key={i} style={[s.cellHead, t.numeric[i] ? s.num : {}]}>{pdfText(c)}</Text>)}
      </View>
      {t.rows.map((r, ri) => (
        <View key={ri} style={s.row} wrap={false}>
          {r.map((c, ci) => <Text key={ci} style={[s.cell, t.numeric[ci] ? s.num : {}]}>{pdfText(c)}</Text>)}
        </View>
      ))}
    </View>
  )
}

export function MonthlyReportDocument({ model, branding }: { model: MonthlyReportModelView; branding: ResolvedBranding }) {
  return (
    <Document title={branding.title} producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={branding} />
      </Page>
      <Page size="A4" style={pageStyles.page} wrap>
        <View style={s.body}>
          {model.sections.map((sec) => (
            <View key={sec.title}>
              <Text style={[s.h2, { color: branding.accent }]} minPresenceAhead={60}>{pdfText(sec.title)}</Text>
              {sec.paragraphs.map((p, i) => <Text key={i} style={s.p}>{pdfText(p)}</Text>)}
              {sec.tables.map((t, i) => <Table key={i} t={t} accent={branding.accent} />)}
            </View>
          ))}
        </View>
        <View style={s.footer} fixed>
          <Text>{branding.footerStamp}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
