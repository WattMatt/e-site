import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { formatSolarDate } from '@esite/shared'
import { RunMonitorButton } from './_components/RunMonitorButton'

export const dynamic = 'force-dynamic'

export default async function TariffLibraryOverview() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const [inReview, openReports, jobs, alerts, latest] = await Promise.all([
    t.from('tariff_year').select('id', { count: 'exact', head: true }).eq('state', 'in_review'),
    t.from('error_report').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    t.from('ingest_job').select('id', { count: 'exact', head: true }).in('status', ['queued', 'running']),
    t.from('due_year_alert').select('id, regime, missing_financial_year, latest_published_fy, checked_on, licensee:licensee_id(name)')
      .is('resolved_at', null).order('checked_on', { ascending: false }).limit(50),
    // A check records only licensees MISSING a year, so this is the latest alert, not the latest run.
    t.from('due_year_alert').select('created_at').order('created_at', { ascending: false }).limit(1),
  ])
  const latestAlertAt = (((latest.data ?? []) as Array<{ created_at: string }>)[0]?.created_at) ?? null
  const alertRows = (alerts.data ?? []) as unknown as Array<{ id: string; regime: string; missing_financial_year: string; latest_published_fy: string | null; checked_on: string; licensee: { name: string } | null }>
  const tiles = [
    { label: 'Years waiting for review', value: inReview.count ?? 0, href: '/admin/tariffs/years?state=in_review' },
    { label: 'Open error reports', value: openReports.count ?? 0, href: '/admin/tariffs/reports' },
    { label: 'PDF ingests queued or running', value: jobs.count ?? 0, href: '/admin/tariffs/sources' },
  ]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {tiles.map((x) => (
          <Link key={x.label} href={x.href} style={{ textDecoration: 'none' }}>
            <Card><CardBody><div style={{ fontSize: 24, fontWeight: 700 }}>{x.value}</div><div style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>{x.label}</div></CardBody></Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader><span className="data-panel-title">Due-year alerts</span></CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>
            The automatic schedule (1 April for Eskom, 1 July for municipal) starts once the owner enables it; until then, run a check here.{' '}
            <RunMonitorButton regime="eskom" /> <RunMonitorButton regime="municipal" />
          </p>
          <p style={{ fontSize: 12, margin: '0 0 8px', color: 'var(--c-text-dim)' }}>
            {latestAlertAt
              ? `Latest alert recorded ${formatSolarDate(latestAlertAt)}. A check records only licensees that are missing a year.`
              : 'No check has recorded a missing year yet — run a check now. A check records only licensees that are missing a year.'}
          </p>
          {alertRows.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>No open alerts.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {alertRows.map((a) => (
                  <li key={a.id}>
                    {a.licensee?.name ?? 'Unknown licensee'}: no published {a.missing_financial_year} (latest {a.latest_published_fy ?? 'none'}), found {formatSolarDate(a.checked_on)}.{' '}
                    <Link href="/admin/tariffs/sources">Upload the source</Link>
                  </li>
                ))}
              </ul>}
        </CardBody>
      </Card>
    </div>
  )
}
