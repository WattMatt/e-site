import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'

export const dynamic = 'force-dynamic'
const STATES = ['in_review', 'ingesting', 'published', 'superseded'] as const

export default async function YearsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { supabase } = await requirePlatformTariffAdminPage()
  const sp = await searchParams
  const state = (STATES as readonly string[]).includes(sp.state ?? '') ? sp.state! : 'in_review'
  const { data } = await supabase.schema('tariffs').from('tariff_year')
    .select('id, financial_year, state, validated_at, validation_blocking, published_at, licensee:licensee_id(name)')
    .eq('state', state).order('financial_year', { ascending: false }).limit(500)
  const rows = (data ?? []) as unknown as Array<{ id: string; financial_year: string; state: string; validated_at: string | null; validation_blocking: number | null; licensee: { name: string } | null }>
  return (
    <Card>
      <CardHeader>
        <span className="data-panel-title">Tariff years</span>
        <span style={{ display: 'flex', gap: 8, fontSize: 13 }}>
          {STATES.map((s) => <Link key={s} href={`/admin/tariffs/years?state=${s}`} aria-current={s === state ? 'page' : undefined}>{s.replace('_', ' ')}</Link>)}
        </span>
      </CardHeader>
      <CardBody>
        {rows.length === 0
          ? <p style={{ fontSize: 13 }}>No {state.replace('_', ' ')} years. Ingest a source to create one.</p>
          : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/tariffs/years/${r.id}`}>{r.licensee?.name ?? 'Unknown'} {r.financial_year}</Link>
                  {r.state === 'in_review' && ` · ${r.validated_at ? `${r.validation_blocking} blocking` : 'not checked'}`}
                </li>
              ))}
            </ul>}
      </CardBody>
    </Card>
  )
}
