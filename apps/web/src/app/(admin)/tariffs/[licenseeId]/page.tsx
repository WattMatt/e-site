import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  LICENSEE_KIND_LABELS, TARIFF_CATEGORY_LABELS, TARIFF_STRUCTURE_LABELS, TARIFF_YEAR_STATE_LABELS, displayLicenseeName, energyRangeText, labelOf, provinceLabel,
} from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadLicenseeWithYears, loadYearTariffList, type TariffListRow } from '@/lib/tariffs/explorer-data'
import { Breadcrumb, ChipLink, MUTED, Stat, autoGrid, formatIsoDate } from '../_components/explorer-ui'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORY_ORDER = ['domestic', 'commercial', 'industrial', 'agricultural', 'bulk', 'public_lighting', 'sseg', 'wheeling', 'other']

/** The code only when the name does not already carry it ("Megaflex 1 (Me01N)"). */
const codeSuffix = (t: TariffListRow) => (t.code && !t.name.includes(t.code) ? t.code : null)

const FIXED_SHOWN = 3

function TariffRow({ t, href }: { t: TariffListRow; href: string }) {
  const h = t.headline
  const code = codeSuffix(t)
  const wrap = { fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' } as const
  return (
    <li style={{ borderTop: '1px solid var(--c-border)' }}>
      <Link href={href} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center', padding: '10px 2px', textDecoration: 'none', color: 'inherit' }}>
        <span style={{ flex: '1 1 240px', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-amber)' }}>{t.name}</span>
          {code && <span style={{ fontSize: 12, ...MUTED }}> · {code}</span>}
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            <Badge variant="info">{labelOf(TARIFF_STRUCTURE_LABELS, t.structure)}</Badge>
            {h?.capacityOrDemand && <Badge variant="default">Capacity/demand charges</Badge>}
            {t.isLegacy && <Badge variant="ghost">Legacy</Badge>}
          </span>
        </span>
        {h && (
          <span style={{ display: 'grid', gap: 2, fontSize: 13, flex: '0 1 auto', minWidth: 0 }}>
            {h.energy ? <span style={wrap}><span style={{ fontSize: 11, ...MUTED }}>Energy </span>{energyRangeText(h.energy)}</span> : <span style={{ fontSize: 12, ...MUTED }}>No energy rate</span>}
            {h.fixed.slice(0, FIXED_SHOWN).map((f) => <span key={f.component} style={{ ...wrap, fontSize: 12, ...MUTED }}>{f.label} {f.text}</span>)}
            {h.fixed.length > FIXED_SHOWN && <span style={{ fontSize: 12, ...MUTED }}>+{h.fixed.length - FIXED_SHOWN} more fixed charge{h.fixed.length - FIXED_SHOWN === 1 ? '' : 's'}</span>}
          </span>
        )}
      </Link>
    </li>
  )
}

export default async function LicenseeTariffsPage({ params, searchParams }: {
  params: Promise<{ licenseeId: string }>
  searchParams: Promise<{ fy?: string; cat?: string }>
}) {
  const { licenseeId } = await params
  const { fy, cat } = await searchParams
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
  const name = displayLicenseeName(licensee.name)
  const year = years.find((y) => y.financialYear === fy) ?? years[0] ?? null
  const byCategory = new Map<string, TariffListRow[]>()
  for (const t of tariffs) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t])
  const categories = [...byCategory.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99))
  const activeCat = cat && byCategory.has(cat) ? cat : null
  const base = `/tariffs/${licensee.id}`
  const qs = (p: { fy?: string; cat?: string | null }) => {
    const s = new URLSearchParams()
    if (p.fy) s.set('fy', p.fy)
    if (p.cat) s.set('cat', p.cat)
    const str = s.toString()
    return str ? `${base}?${str}` : base
  }
  const shown = activeCat ? [activeCat] : categories

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Breadcrumb items={[{ href: '/tariffs', label: 'Tariffs' }, { label: name }]} />
      <Card>
        <CardHeader>
          <span className="data-panel-title" style={{ fontSize: 16 }}>{name}</span>
          <span style={{ fontSize: 12, ...MUTED }}>
            {labelOf(LICENSEE_KIND_LABELS, licensee.kind)}{licensee.province ? ` · ${provinceLabel(licensee.province)}` : ''}{licensee.nersaLicenceNo ? ` · NERSA licence ${licensee.nersaLicenceNo}` : ''}
          </span>
        </CardHeader>
        <CardBody>
          {years.length === 0
            ? <p style={{ fontSize: 13, margin: 0 }}>No tariff year is published for {name} yet. Its tariffs are being reviewed against the NERSA decision before they appear here.</p>
            : (
              <div style={{ display: 'grid', gap: 14 }}>
                {years.length > 1 && (
                  <nav aria-label="Financial year" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {years.map((y) => (
                      <ChipLink key={y.id} href={qs({ fy: y.financialYear, cat: activeCat })} active={y.id === year?.id}>
                        {y.financialYear} <span style={{ opacity: 0.75 }}>· {labelOf(TARIFF_YEAR_STATE_LABELS, y.state)}</span>
                      </ChipLink>
                    ))}
                  </nav>
                )}
                {year && (
                  <div style={autoGrid(140, 10)} role="group" aria-label="Year at a glance">
                    <Stat label="Financial year" value={year.financialYear} sub={labelOf(TARIFF_YEAR_STATE_LABELS, year.state) + (year.state === 'superseded' ? ' by a later year' : '')} />
                    <Stat label="In force" value={formatIsoDate(year.effectiveFrom)} sub={`to ${formatIsoDate(year.effectiveTo)}`} />
                    {year.approvedIncreasePct !== null && <Stat label="NERSA-approved increase" value={`${year.approvedIncreasePct} %`} />}
                    <Stat label="Tariffs" value={tariffs.length} sub={`in ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`} />
                  </div>
                )}
              </div>
            )}
        </CardBody>
      </Card>

      {year && categories.length > 1 && (
        <nav aria-label="Category" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ChipLink href={qs({ fy: year.financialYear })} active={activeCat === null}>All · {tariffs.length}</ChipLink>
          {categories.map((c) => (
            <ChipLink key={c} href={qs({ fy: year.financialYear, cat: c })} active={activeCat === c}>
              {labelOf(TARIFF_CATEGORY_LABELS, c)} · {byCategory.get(c)!.length}
            </ChipLink>
          ))}
        </nav>
      )}

      {year && shown.map((c) => {
        const list = byCategory.get(c)!
        const families = new Map<string, TariffListRow[]>()
        for (const t of list) families.set(t.family ?? '', [...(families.get(t.family ?? '') ?? []), t])
        const grouped = families.size > 1 || !families.has('')
        return (
          <Card key={c}>
            <CardHeader>
              <span className="data-panel-title">{labelOf(TARIFF_CATEGORY_LABELS, c)}</span>
              <span style={{ fontSize: 12, ...MUTED }}>{list.length} tariff{list.length === 1 ? '' : 's'}</span>
            </CardHeader>
            <CardBody>
              <div style={{ display: 'grid', gap: 14 }}>
                {[...families.entries()].map(([fam, ts]) => (
                  <section key={fam || 'none'} aria-label={fam || labelOf(TARIFF_CATEGORY_LABELS, c)}>
                    {grouped && <h3 style={{ fontSize: 12, margin: '0 0 2px', ...MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{fam || 'Other'} <span style={{ fontWeight: 400 }}>· {ts.length}</span></h3>}
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {ts.map((t) => <TariffRow key={t.id} t={t} href={`${base}/${t.id}`} />)}
                    </ul>
                  </section>
                ))}
              </div>
            </CardBody>
          </Card>
        )
      })}
      {year && tariffs.length === 0 && <p style={{ fontSize: 13 }}>This year has no tariffs in the library.</p>}
      {year && tariffs.length > 0 && (
        <p style={{ fontSize: 12, ...MUTED, margin: 0 }}>
          {tariffs.some((t) => t.headline === null)
            ? 'Headline rates could not be loaded; open a tariff for its charges.'
            : 'Rates excluding VAT. Energy is the active energy charge across every season, time-of-use period and block; network, ancillary and other per-kWh charges are listed on each tariff.'}
        </p>
      )}
    </div>
  )
}
