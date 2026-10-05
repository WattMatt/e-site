import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LICENSEE_KIND_LABELS, TARIFF_CATEGORY_LABELS, TARIFF_STRUCTURE_LABELS, TARIFF_YEAR_STATE_LABELS, labelOf } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadLicenseeWithYears, loadYearTariffList, type TariffListRow } from '@/lib/tariffs/explorer-data'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LicenseeTariffsPage({ params, searchParams }: {
  params: Promise<{ licenseeId: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { licenseeId } = await params
  const { fy } = await searchParams
  if (!UUID.test(licenseeId)) notFound()
  const supabase = (await createClient()) as unknown as AnyClient
  let lw: Awaited<ReturnType<typeof loadLicenseeWithYears>>
  let tariffs: TariffListRow[] = []
  try {
    lw = await loadLicenseeWithYears(supabase, licenseeId)
    const first = lw ? (lw.years.find((y) => y.financialYear === fy) ?? lw.years[0]) : undefined
    if (first) tariffs = await loadYearTariffList(supabase, first.id)
  } catch {
    return <ErrorState title="Could not load this supply authority" description="Reload the page. If it keeps failing, report it to support." />
  }
  if (!lw) notFound()
  const { licensee, years } = lw
  const year = years.find((y) => y.financialYear === fy) ?? years[0] ?? null
  const byCategory = new Map<string, TariffListRow[]>()
  for (const t of tariffs) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p style={{ fontSize: 13, margin: 0 }}><Link href="/tariffs">Tariffs</Link> / {licensee.name}</p>
      <Card>
        <CardHeader>
          <span className="data-panel-title">{licensee.name}</span>
          <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
            {labelOf(LICENSEE_KIND_LABELS, licensee.kind)}{licensee.province ? ` · ${licensee.province}` : ''}{licensee.nersaLicenceNo ? ` · NERSA licence ${licensee.nersaLicenceNo}` : ''}
          </span>
        </CardHeader>
        <CardBody>
          {years.length === 0
            ? <p style={{ fontSize: 13, margin: 0 }}>No tariff year is published for {licensee.name} yet. Its tariffs are being reviewed against the NERSA decision before they appear here.</p>
            : (
              <nav aria-label="Financial year" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                {years.map((y) => (
                  <Link key={y.id} href={`/tariffs/${licensee.id}?fy=${encodeURIComponent(y.financialYear)}`} aria-current={y.id === year?.id ? 'page' : undefined}
                    style={{ padding: '4px 10px', borderRadius: 6, textDecoration: 'none', border: '1px solid var(--c-border)',
                      background: y.id === year?.id ? 'var(--c-amber-dim)' : 'transparent', color: 'var(--c-text)' }}>
                    {y.financialYear} <span style={{ color: 'var(--c-text-mid)' }}>({labelOf(TARIFF_YEAR_STATE_LABELS, y.state)})</span>
                  </Link>
                ))}
              </nav>
            )}
          {year && (
            <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginBottom: 0 }}>
              In force {year.effectiveFrom} to {year.effectiveTo}{year.approvedIncreasePct !== null ? ` · NERSA-approved increase ${year.approvedIncreasePct} %` : ''}
              {year.state === 'superseded' ? ' · superseded by a later year' : ''}
            </p>
          )}
        </CardBody>
      </Card>
      {year && [...byCategory.entries()].map(([cat, list]) => (
        <Card key={cat}>
          <CardHeader><span className="data-panel-title">{labelOf(TARIFF_CATEGORY_LABELS, cat)}</span><span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{list.length} tariff{list.length === 1 ? '' : 's'}</span></CardHeader>
          <CardBody>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {list.map((t) => (
                <li key={t.id} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--c-border)' }}>
                  <Link href={`/tariffs/${licensee.id}/${t.id}`}>{t.name}</Link>
                  <span style={{ color: 'var(--c-text-mid)' }}> · {labelOf(TARIFF_STRUCTURE_LABELS, t.structure)}{t.code ? ` · ${t.code}` : ''}</span>
                  {t.isLegacy && <span style={{ marginLeft: 8 }}><Badge variant="ghost">Legacy</Badge></span>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
      {year && tariffs.length === 0 && <p style={{ fontSize: 13 }}>This year has no tariffs in the library.</p>}
    </div>
  )
}
