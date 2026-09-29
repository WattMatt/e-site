/**
 * Client proposal PDF (spec §9.3). Renders a ProposalSnapshot ONLY, through keyFigures() and
 * financeOptionTable() — the same functions the client page uses — so the page and the PDF cannot
 * disagree (a portal and a PDF showing different assumptions is the failure this prevents).
 * Server-side only.
 */
import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { Cover, Document, Watermark, pageStyles } from '@/lib/reports/components'
import { financeOptionTable, isoDate, keyFigures, type ProposalSnapshot } from '@esite/shared/solar-reports'
import { pdfText } from './pdf-text'

const s = StyleSheet.create({
  body: { paddingBottom: 40 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4, color: '#222222' },
  bullet: { fontSize: 9, lineHeight: 1.4, marginLeft: 8, color: '#222222' },
  kv: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD', paddingVertical: 3 },
  k: { flex: 3, fontSize: 9, color: '#444444' },
  v: { flex: 2, fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD' },
  cell: { flex: 1, fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  cellHead: { flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 2.5, paddingHorizontal: 3 },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
})

function Para({ title, body, accent }: { title: string; body: string; accent: string }) {
  if (!body.trim()) return null
  return (
    <View>
      <Text style={[s.h2, { color: accent }]} minPresenceAhead={40}>{pdfText(title)}</Text>
      {body.split('\n').map((line, i) => <Text key={i} style={s.p}>{pdfText(line)}</Text>)}
    </View>
  )
}

function Bullets({ title, items, accent }: { title: string; items: string[]; accent: string }) {
  if (items.length === 0) return null
  return (
    <View>
      <Text style={[s.h2, { color: accent }]} minPresenceAhead={40}>{pdfText(title)}</Text>
      {items.map((it, i) => <Text key={i} style={s.bullet}>{pdfText(`• ${it}`)}</Text>)}
    </View>
  )
}

export function ProposalDocument({ snapshot, branding, preview }: { snapshot: ProposalSnapshot; branding: ResolvedBranding; preview: boolean }) {
  const a = branding.accent
  const t = financeOptionTable(snapshot)
  const x = snapshot.text
  return (
    <Document title={pdfText(snapshot.proposal.title)} producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        {preview && <Watermark text="PREVIEW" />}
        <Cover resolved={branding} />
      </Page>
      <Page size="A4" style={pageStyles.page} wrap>
        {preview && <Watermark text="PREVIEW" />}
        <View style={s.body}>
          <Text style={[s.h2, { color: a }]}>{pdfText(snapshot.proposal.title)}</Text>
          <Text style={s.p}>{pdfText(`Prepared for ${snapshot.client.name} · ${snapshot.project.name}${snapshot.project.address ? `, ${snapshot.project.address}` : ''}`)}</Text>
          <Text style={s.p}>{pdfText(`Version ${snapshot.proposal.version} · issued ${isoDate(snapshot.proposal.issuedAt)} · valid until ${isoDate(snapshot.proposal.validUntil)}`)}</Text>

          <Text style={[s.h2, { color: a }]}>{pdfText('Key figures')}</Text>
          {keyFigures(snapshot).map((f) => (
            <View key={f.label} style={s.kv} wrap={false}>
              <Text style={s.k}>{pdfText(f.label)}</Text>
              <Text style={s.v}>{pdfText(f.value)}</Text>
            </View>
          ))}

          <Para title="Summary" body={x.summary} accent={a} />
          <Para title="About this proposal" body={x.narrative} accent={a} />
          <Para title="Scope" body={x.scope} accent={a} />
          <Bullets title="Included" items={x.inclusions} accent={a} />
          <Bullets title="Excluded" items={x.exclusions} accent={a} />

          <Text style={[s.h2, { color: a }]} minPresenceAhead={80}>{pdfText('Finance options')}</Text>
          <View style={[s.row, { borderBottomColor: '#999999' }]}>
            {t.columns.map((c, i) => <Text key={i} style={s.cellHead}>{pdfText(c)}</Text>)}
          </View>
          {t.rows.map((r, ri) => (
            <View key={ri} style={s.row} wrap={false}>
              {r.map((c, ci) => <Text key={ci} style={ci === 0 ? s.cellHead : s.cell}>{pdfText(c)}</Text>)}
            </View>
          ))}

          <Para title="Price and payment terms" body={x.priceTerms} accent={a} />
          <Para title="Assumptions" body={x.assumptions} accent={a} />
          <Para title="Terms and conditions" body={x.terms} accent={a} />
          <Para title="Disclaimer" body={x.disclaimer} accent={a} />
          <Text style={s.p}>{pdfText(`Contact: ${snapshot.issuer.proposerName}${snapshot.issuer.proposerEmail ? ` (${snapshot.issuer.proposerEmail})` : ''}, ${snapshot.issuer.orgName}.`)}</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>{pdfText(`${snapshot.issuer.orgName} · proposal v${snapshot.proposal.version}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
