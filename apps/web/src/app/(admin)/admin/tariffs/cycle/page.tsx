import Link from 'next/link'
import { summariseCycle, type CycleRow, type CycleYear, type RegimeCycle } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'

export const dynamic = 'force-dynamic'
type Row = Record<string, unknown>

function Rows({ rows, empty, withDiff = true }: { rows: CycleRow[]; empty: string; withDiff?: boolean }) {
  if (rows.length === 0) return <p style={{ fontSize: 13, margin: 0 }}>{empty}</p>
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
      {rows.map((r) => (
        <li key={r.yearId}>
          <Link href={`/admin/tariffs/years/${r.yearId}`}>{r.licensee} {r.financialYear}</Link>
          {r.blocking !== null && r.blocking > 0 && ` · ${r.blocking} blocking`}
          {withDiff && <> · <Link href={`/admin/tariffs/years/${r.yearId}/diff`}>diff vs previous year</Link></>}
        </li>
      ))}
    </ul>
  )
}

function Regime({ title, c, rule }: { title: string; c: RegimeCycle; rule: string }) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{title} · {c.targetFy}</span><span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{rule} Next year due {c.nextDue}.</span></CardHeader>
      <CardBody>
        <table style={{ fontSize: 13, borderCollapse: 'collapse', marginBottom: 12 }}>
          <tbody>
            {([['Published', c.counts.published], ['In review', c.counts.in_review], ['Ingesting', c.counts.ingesting], ['No year loaded', c.counts.missing]] as const).map(([k, v]) => (
              <tr key={k}><td style={{ paddingRight: 16 }}>{k}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</td></tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>Ready to publish (checked, 0 blocking)</h3>
        <Rows rows={c.readyToPublish} empty="None." />
        <h3 style={{ fontSize: 13, margin: '12px 0 4px' }}>Blocked</h3>
        <Rows rows={c.blocked} empty="Nothing is blocked." />
        <h3 style={{ fontSize: 13, margin: '12px 0 4px' }}>Not checked yet</h3>
        <Rows rows={c.notChecked} empty="Every year in review has been checked." />
        {c.missing.length > 0 && (
          <details style={{ marginTop: 12, fontSize: 13 }}>
            <summary>{c.missing.length} licensee{c.missing.length === 1 ? '' : 's'} with no {c.targetFy} year</summary>
            <p style={{ margin: '6px 0 0' }}>{c.missing.map((m) => m.licensee).join(', ')}</p>
          </details>
        )}
      </CardBody>
    </Card>
  )
}

export default async function TariffCyclePage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const [lic, yrs, queue] = await Promise.all([
    t.from('licensee').select('id, name, kind'),
    t.from('tariff_year').select('id, licensee_id, financial_year, state, validation_blocking, validated_at, published_at'),
    t.from('charge').select('id, tariff!inner(tariff_year!inner(state))', { count: 'exact', head: true })
      .eq('unit_inferred', true).is('reviewed_at', null).eq('tariff.tariff_year.state', 'in_review'),
  ])
  if (lic.error || yrs.error) {
    console.error('[tariff-cycle] read failed', { table: lic.error ? 'licensee' : 'tariff_year', code: (lic.error ?? yrs.error)?.code })
    return <ErrorState title="Could not load the update cycle" description="Reload the page." />
  }
  const years: CycleYear[] = ((yrs.data ?? []) as Row[]).map((y) => ({
    id: String(y.id), licenseeId: String(y.licensee_id), financialYear: String(y.financial_year), state: String(y.state),
    validationBlocking: y.validation_blocking === null ? null : Number(y.validation_blocking),
    validatedAt: (y.validated_at ?? null) as string | null, publishedAt: (y.published_at ?? null) as string | null,
  }))
  const s = summariseCycle((lic.data ?? []) as Array<{ id: string; name: string; kind: string }>, years, new Date().toISOString().slice(0, 10))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p style={{ fontSize: 13, margin: 0 }}>
        The yearly NERSA cycle: ingest the approved source, review what the checks raise, publish. The steps are in{' '}
        <code>docs/tariffs/annual-update-runbook.md</code>. Review queue: <strong>{queue.count ?? '—'}</strong> inferred-unit charge{queue.count === 1 ? '' : 's'} not yet reviewed in years under review.
      </p>
      <Regime title="Eskom" c={s.eskom} rule="Eskom's year starts 1 April; NERSA approves its increase in February or March." />
      <Regime title="Municipal" c={s.municipal} rule="Municipal years start 1 July; NERSA issues Reasons for Decision from May." />
      <Card>
        <CardHeader><span className="data-panel-title">Publish history</span></CardHeader>
        <CardBody>
          {s.publishHistory.length === 0
            ? <p style={{ fontSize: 13, margin: 0 }}>Nothing has been published yet.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {s.publishHistory.slice(0, 40).map((h) => (
                  <li key={h.yearId}>{h.publishedAt.slice(0, 10)} · <Link href={`/admin/tariffs/years/${h.yearId}`}>{h.licensee} {h.financialYear}</Link></li>
                ))}
              </ul>}
        </CardBody>
      </Card>
    </div>
  )
}
