import { COST_VIEW_ROLES } from '@esite/shared'
import { requireRolePage } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { Card, CardBody } from '@/components/ui/Card'
import { loadSources, logRateAccess, type AnyClient } from '@/lib/rate-library/data'
import { zar } from '@/lib/rate-library/format'
import { RatesNav } from '../_components/RatesNav'

export const dynamic = 'force-dynamic'

const KIND: Record<string, string> = { boq_import: 'E-Site project BOQ', historical_file: 'Historical priced BOQ', tender_submission: 'Tender submission', manual: 'Manual' }

interface Bill { sheet: string; statedTotal: number | null; sumOfLines: number; difference: number | null }

export default async function RateSourcesPage() {
  const ctx = await requireRolePage(COST_VIEW_ROLES)
  const db = (await createClient()) as AnyClient
  const sources = await loadSources(db, ctx.organisationId)
  await logRateAccess(db, ctx.organisationId, 'view_sources', null, { sources: sources.length })
  const cell = { padding: 8, verticalAlign: 'top' as const }
  const num = { ...cell, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <RatesNav active="/rates/sources" />
      {sources.length === 0 ? (
        <Card><CardBody><strong>No priced documents yet.</strong></CardBody></Card>
      ) : sources.map(s => {
        const rec = s.reconciliation as { bills?: Bill[]; reconciled?: boolean; sumOfLineAmounts?: number; importTotalExVat?: number | null; lines?: number }
        const queued = (s.counts.suggested ?? 0) + (s.counts.unmatched ?? 0) + (s.counts.rejected ?? 0)
        return (
          <Card key={s.id}>
            <CardBody>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>{s.contractor_name}</strong> — {s.project_label ?? 'no E-Site project'}{s.province ? ` · ${s.province}` : ''}
                  <div style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>
                    {KIND[s.kind] ?? s.kind} · priced {s.priced_on} ({s.priced_on_basis.replace('_', ' ')}) · {s.source_file ?? s.source_ref}
                  </div>
                </div>
                <div style={{ fontSize: 13, textAlign: 'right' }}>
                  {(s.counts.auto_confirmed ?? 0) + (s.counts.confirmed ?? 0)} matched · {queued} in review · {s.counts.excluded ?? 0} not rates
                </div>
              </div>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 360 }}>
                  <tbody>
                    {rec.bills ? rec.bills.map(b => (
                      <tr key={b.sheet} style={{ borderTop: '1px solid var(--c-border)' }}>
                        <td style={cell}>{b.sheet}</td><td style={num}>stated {zar(b.statedTotal)}</td>
                        <td style={num}>lines {zar(b.sumOfLines)}</td>
                        <td style={num}>{b.difference === 0 ? '✓ reconciles' : `difference ${zar(b.difference)}`}</td>
                      </tr>
                    )) : (
                      <tr style={{ borderTop: '1px solid var(--c-border)' }}>
                        <td style={cell}>{rec.lines ?? '—'} lines</td><td style={num}>import total {zar(rec.importTotalExVat ?? s.total_ex_vat)}</td>
                        <td style={num}>sum of lines {zar(rec.sumOfLineAmounts)}</td>
                        <td style={num}>difference {zar(rec.importTotalExVat != null && rec.sumOfLineAmounts != null ? Math.round((rec.importTotalExVat - rec.sumOfLineAmounts) * 100) / 100 : null)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
