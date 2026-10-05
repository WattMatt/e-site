import 'server-only'
/**
 * Published tariffs for the Load profile tab, read through the CALLER's session. The database is
 * the gate (ADR-007, PR #239): `caller_can_read_tariff_library()` lets every signed-in org read the
 * published library; drafts stay admin-only. Every query is still narrowed to tariff years in state
 * 'published' here, so a tariff admin using this tab never sees an in-review draft either.
 * Until #239 is applied, an org without a Solar subscription reads nothing and the tab says so.
 */
import type { Tariff, TouCalendar } from '@esite/shared'
import { loadStudyCalendar } from '@/lib/solar/tariff/calendar-loader'
import { loadYearTariffs } from '@/lib/tariffs/load-year'
import type { AnyClient } from '@/lib/tariffs/admin-gate'

type Row = Record<string, unknown>

export interface PublishedLicensee { id: string; name: string; kind: string; province: string | null; aliases: string[] }
export interface PublishedTariffOption { id: string; name: string; code: string | null; structure: string; financialYear: string }
export interface CostingTariff {
  tariff: Tariff
  calendar: TouCalendar | null
  calendarAssumedEskom: boolean
  tariffId: string
  label: string
  licenseeName: string
  financialYear: string
}

export async function listPublishedLicensees(client: AnyClient): Promise<PublishedLicensee[]> {
  const t = client.schema('tariffs')
  const { data: years, error } = await t.from('tariff_year').select('licensee_id').eq('state', 'published')
  if (error) throw new Error(`tariff years: ${error.message}`)
  const ids = [...new Set(((years ?? []) as Row[]).map((y) => String(y.licensee_id)))]
  if (ids.length === 0) return []
  const [{ data: lic, error: e1 }, { data: al, error: e2 }] = await Promise.all([
    t.from('licensee').select('id, name, kind, province').in('id', ids),
    t.from('licensee_alias').select('alias, licensee_id').in('licensee_id', ids),
  ])
  if (e1 || e2) throw new Error(`licensees: ${(e1 ?? e2)!.message}`)
  const aliases = new Map<string, string[]>()
  for (const a of (al ?? []) as Row[]) aliases.set(String(a.licensee_id), [...(aliases.get(String(a.licensee_id)) ?? []), String(a.alias)])
  return ((lic ?? []) as Row[])
    .map((l) => ({ id: String(l.id), name: String(l.name), kind: String(l.kind), province: (l.province as string | null) ?? null, aliases: aliases.get(String(l.id)) ?? [] }))
    .sort((a, b) => (a.kind === 'eskom' ? -1 : b.kind === 'eskom' ? 1 : a.name.localeCompare(b.name)))
}

export async function listPublishedTariffs(client: AnyClient, licenseeId: string): Promise<PublishedTariffOption[]> {
  const t = client.schema('tariffs')
  const { data: years, error } = await t.from('tariff_year').select('id, financial_year').eq('licensee_id', licenseeId).eq('state', 'published')
  if (error) throw new Error(`tariff years: ${error.message}`)
  const ys = (years ?? []) as Row[]
  if (ys.length === 0) return []
  const fy = new Map(ys.map((y) => [String(y.id), String(y.financial_year)]))
  const { data: rows, error: e2 } = await t.from('tariff').select('id, name, code, structure, tariff_year_id').in('tariff_year_id', [...fy.keys()]).order('name')
  if (e2) throw new Error(`tariffs: ${e2.message}`)
  return ((rows ?? []) as Row[]).map((r) => ({
    id: String(r.id), name: String(r.name), code: (r.code as string | null) ?? null, structure: String(r.structure), financialYear: fy.get(String(r.tariff_year_id)) ?? '',
  }))
}

/**
 * The tariff as the engine models it, with its licensee's TOU calendar. A tariff whose year is no
 * longer published (superseded each April / July) follows into the licensee's CURRENT published
 * year by code, else by exact name; null when there is no such successor.
 */
export async function loadCostingTariff(client: AnyClient, tariffId: string): Promise<CostingTariff | null> {
  const t = client.schema('tariffs')
  const { data: tr } = await t.from('tariff').select('id, name, code, tariff_year_id').eq('id', tariffId).maybeSingle()
  const chosen = tr as Row | null
  if (!chosen) return null
  const { data: y } = await t.from('tariff_year').select('id, licensee_id, financial_year, effective_from, state').eq('id', chosen.tariff_year_id as string).maybeSingle()
  let year = y as Row | null
  if (!year) return null
  let id = tariffId
  let followedFrom: string | null = null
  if (year.state !== 'published') {
    const { data: cur } = await t.from('tariff_year').select('id, licensee_id, financial_year, effective_from, state')
      .eq('licensee_id', year.licensee_id as string).eq('state', 'published').order('financial_year', { ascending: false }).limit(1)
    const next = ((cur ?? []) as Row[])[0]
    if (!next) return null
    const q = t.from('tariff').select('id').eq('tariff_year_id', next.id as string)
    const { data: match } = await (chosen.code ? q.eq('code', chosen.code as string) : q.eq('name', chosen.name as string)).limit(2)
    const rows = (match ?? []) as Row[]
    if (rows.length !== 1) return null
    followedFrom = String(year.financial_year)
    id = String(rows[0].id)
    year = next
  }
  const { data: lic } = await t.from('licensee').select('name').eq('id', year.licensee_id as string).maybeSingle()
  const loaded = (await loadYearTariffs(client, String(year.id))).find((l) => l.id === id)
  if (!loaded) return null
  const cal = await loadStudyCalendar(client, String(year.licensee_id), String(year.effective_from ?? new Date().toISOString().slice(0, 10)))
  const licenseeName = String((lic as Row | null)?.name ?? '')
  return {
    tariff: loaded.tariff,
    calendar: cal.calendar,
    calendarAssumedEskom: cal.assumedEskom,
    tariffId: id,
    label: `${licenseeName} · ${String(year.financial_year)} · ${loaded.tariff.name}${followedFrom ? ` (chosen in ${followedFrom}; now ${String(year.financial_year)})` : ''}`,
    licenseeName,
    financialYear: String(year.financial_year),
  }
}
