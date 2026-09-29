import { notFound } from 'next/navigation'
import { COMPONENT_LABELS, UNIT_LABELS, diffTariffYears, previousFinancialYear } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { loadPreviousPublished, loadYearTariffs } from '@/lib/tariffs/load-year'
import { describeChargeKeys } from '@/lib/tariffs/yoy-labels'

export const dynamic = 'force-dynamic'

export default async function YearDiffPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data: y } = await supabase.schema('tariffs').from('tariff_year').select('id, licensee_id, financial_year, approved_increase_pct').eq('id', yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; financial_year: string; approved_increase_pct: string | number | null } | null
  if (!year) notFound()
  const prevFy = previousFinancialYear(year.financial_year)
  const prev = await loadPreviousPublished(supabase, year.licensee_id, prevFy)
  if (!prev) return <Card><CardBody><p style={{ fontSize: 13 }}>No published {prevFy} year to compare with.</p></CardBody></Card>
  const approved = year.approved_increase_pct === null ? null : Number(year.approved_increase_pct)
  const cur = (await loadYearTariffs(supabase, year.id)).map((l) => l.tariff)
  const d = diffTariffYears(prev.tariffs, cur, approved)
  const added = describeChargeKeys(cur, d.added)
  const removed = describeChargeKeys(prev.tariffs, d.removed)
  const outlier = (pct: number | null) => pct === null || (approved !== null && Math.abs(pct - approved) > 3)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">{prevFy} → {year.financial_year}: {d.changed.length} changed · {d.added.length} new · {d.removed.length} removed · {d.unchanged} unchanged</span></CardHeader>
        <CardBody>
          {d.changed.length === 0
            ? <p style={{ fontSize: 13 }}>No charge changed value between {prevFy} and {year.financial_year}.</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><th align="left">Tariff</th><th align="left">Component</th><th align="right">{prevFy}</th><th align="right">{year.financial_year}</th><th align="left">Unit</th><th align="right">Change</th></tr></thead>
                <tbody>{d.changed.map((c) => (
                  <tr key={c.key} style={outlier(c.changePct) ? { background: 'var(--c-amber-dim)' } : undefined}>
                    <td>{c.tariff}</td><td>{COMPONENT_LABELS[c.component]}</td><td align="right">{c.prev}</td><td align="right">{c.next}</td><td>{UNIT_LABELS[c.unit]}</td>
                    <td align="right">{c.changePct === null ? 'unit changed' : `${c.changePct} %`}{outlier(c.changePct) ? ' ⚑' : ''}</td>
                  </tr>
                ))}</tbody>
              </table>}
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>⚑ = more than 3 percentage points from the approved increase ({approved ?? 'not recorded'} %), or the unit changed.</p>
        </CardBody>
      </Card>
      <Card><CardHeader><span className="data-panel-title">New charges</span></CardHeader><CardBody>{added.length ? <ul style={{ fontSize: 12 }}>{added.map((k, i) => <li key={d.added[i]}>{k}</li>)}</ul> : <p style={{ fontSize: 13 }}>No new charges this year.</p>}</CardBody></Card>
      <Card><CardHeader><span className="data-panel-title">Removed charges</span></CardHeader><CardBody>{removed.length ? <ul style={{ fontSize: 12 }}>{removed.map((k, i) => <li key={d.removed[i]}>{k}</li>)}</ul> : <p style={{ fontSize: 13 }}>No charges were removed this year.</p>}</CardBody></Card>
    </div>
  )
}
