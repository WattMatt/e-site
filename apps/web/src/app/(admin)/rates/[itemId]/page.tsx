import Link from 'next/link'
import { notFound } from 'next/navigation'
import { COST_VIEW_ROLES, type RateStats } from '@esite/shared'
import { requireRolePage } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { loadItemDetail, logRateAccess, type AnyClient, type LibraryFilters } from '@/lib/rate-library/data'
import { qs, zar } from '@/lib/rate-library/format'
import { RatesNav } from '../_components/RatesNav'
import { TrendChart } from '../_components/TrendChart'
import { VoidObservationButton } from '../_components/VoidObservationButton'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
const ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BASIS_LABEL: Record<string, string> = {
  document_date: 'date on the document', import_date: 'date imported into E-Site (assumed)', submission_date: 'tender submission date', stated: 'date stated by the importer',
}

function StatsRow({ label, s }: { label: string; s: RateStats }) {
  const c = { padding: 8, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }
  return (
    <tr style={{ borderTop: '1px solid var(--c-border)' }}>
      <td style={{ padding: 8 }}>{label}</td><td style={c}>{s.n}</td><td style={c}>{zar(s.min)}</td>
      <td style={c}><strong>{zar(s.median)}</strong></td><td style={c}>{zar(s.p75)}</td><td style={c}>{zar(s.max)}</td>
      <td style={c}>{zar(s.latest?.rate)} <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{s.latest?.pricedOn ?? ''}</span></td>
    </tr>
  )
}

export default async function RateItemPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireRolePage(COST_VIEW_ROLES)
  const { itemId } = await params
  if (!UUID.test(itemId)) notFound()
  const sp = await searchParams
  const f: LibraryFilters = {
    province: one(sp.province), contractor: one(sp.contractor),
    from: one(sp.from) && ISO.test(one(sp.from)!) ? one(sp.from) : undefined,
    to: one(sp.to) && ISO.test(one(sp.to)!) ? one(sp.to) : undefined,
  }
  const db = (await createClient()) as AnyClient
  const detail = await loadItemDetail(db, ctx.organisationId, itemId, f)
  if (!detail) notFound()
  await logRateAccess(db, ctx.organisationId, 'view_item', itemId, { filters: f })
  const { summary: s, byProvince, observations } = detail
  const head = { padding: 8, textAlign: 'right' as const, fontWeight: 600 }
  const cell = { padding: 8, verticalAlign: 'top' as const }
  const num = { ...cell, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <RatesNav active="/rates" />
      <div>
        <Link href={`/rates${qs({ province: f.province, contractor: f.contractor, from: f.from, to: f.to })}`}>← All items</Link>
        <h2 style={{ margin: '8px 0 0' }}>{s.item.description}</h2>
        <p style={{ color: 'var(--c-text-dim)', margin: '4px 0 0' }}>
          {s.item.code} · per {s.item.unit} · {s.item.origin === 'rule' ? 'named by the matcher rules' : 'created by a reviewer'}
          {f.province || f.contractor || f.from || f.to ? ' · filtered' : ''}
        </p>
      </div>

      <Card>
        <CardHeader><strong>Statistics</strong> <span style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>ZAR excl. VAT, per {s.item.unit}</span></CardHeader>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr><th style={{ ...head, textAlign: 'left' }}>Basis</th><th style={head}>n</th><th style={head}>Min</th><th style={head}>Median</th><th style={head}>P75</th><th style={head}>Max</th><th style={head}>Latest</th></tr></thead>
            <tbody>
              <StatsRow label="Today's money (CPI)" s={s.escalated} />
              <StatsRow label="As priced" s={s.nominal} />
              {byProvince.length > 1 ? byProvince.map(p => <StatsRow key={p.province} label={`${p.province} — today's money`} s={p.escalated} />) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader><strong>Trend</strong></CardHeader>
        <CardBody>
          <TrendChart unit={s.item.unit} points={observations.map(o => ({ date: o.priced_on, nominal: Number(o.rate), escalated: o.escalated, label: o.contractor_name }))} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><strong>Observations</strong> <span style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>— each traced to the line it came from</span></CardHeader>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              <th style={{ ...head, textAlign: 'left' }}>Contractor / project</th><th style={{ ...head, textAlign: 'left' }}>Priced</th>
              <th style={head}>Supply</th><th style={head}>Install</th><th style={head}>Rate</th><th style={head}>Today</th>
              <th style={{ ...head, textAlign: 'left' }}>Source line</th><th />
            </tr></thead>
            <tbody>
              {observations.map(o => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td style={cell}>{o.contractor_name}<div style={{ color: 'var(--c-text-dim)' }}>{o.project_label ?? '—'}{o.province ? ` · ${o.province}` : ''}</div></td>
                  <td style={cell}>{o.priced_on}<div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{BASIS_LABEL[o.source?.priced_on_basis ?? ''] ?? ''}</div></td>
                  <td style={num}>{zar(o.supply_rate)}</td><td style={num}>{zar(o.install_rate)}</td><td style={num}>{zar(o.rate)}</td>
                  <td style={num}>{zar(o.escalated)}<div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>
                    {o.flag === 'base_after_latest_index' ? 'newer than the latest CPI' : o.factor ? `×${o.factor.toFixed(4)}` : ''}</div></td>
                  <td style={cell}>
                    <div>{o.source?.source_file ?? o.source?.source_ref ?? '—'}</div>
                    {o.line ? (
                      <div style={{ color: 'var(--c-text-dim)' }}>
                        {[o.line.sheet, o.line.code].filter(Boolean).join(' · ')}{o.line.row_ref && !o.line.row_ref.startsWith('boq_item:') ? ` (${o.line.row_ref})` : ''}
                        <div>{o.line.section_path.join(' › ')} › <em>{o.line.description}</em> [{o.line.unit ?? '—'}]</div>
                      </div>
                    ) : null}
                    {o.occurrences > 1 ? <div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>same rate on {o.occurrences} lines of this document</div> : null}
                  </td>
                  <td style={cell}><VoidObservationButton observationId={o.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
