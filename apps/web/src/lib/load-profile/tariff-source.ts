import 'server-only'
/**
 * Published tariffs for the Load profile tab, which every plan can open (E8-D1). The `tariffs`
 * schema's own policies admit only platform tariff admins and orgs with a Solar subscription
 * (00210, caller_has_any_solar_org), so this module reads it with the SERVICE client and narrows
 * every query to tariff years in state 'published' — NERSA-approved, public regulatory data.
 * Drafts (`in_review`) and superseded years are never read here. Callers must already have passed
 * the page's own project gate. When E7 settles the tariff audience (its D1), a SELECT policy can
 * replace this module; nothing else would change.
 */
import type { Tariff, TouCalendar } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { loadStudyCalendar } from '@/lib/solar/tariff/calendar-loader'
import { loadYearTariffs } from '@/lib/tariffs/load-year'
import type { AnyClient } from '@/lib/tariffs/admin-gate'

type Row = Record<string, unknown>
const service = () => createServiceClient() as unknown as AnyClient

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

export async function listPublishedLicensees(): Promise<PublishedLicensee[]> {
  const t = service().schema('tariffs')
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

export async function listPublishedTariffs(licenseeId: string): Promise<PublishedTariffOption[]> {
  const t = service().schema('tariffs')
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

/** The tariff as the engine models it, with its licensee's TOU calendar — or null if not published. */
export async function loadCostingTariff(tariffId: string): Promise<CostingTariff | null> {
  const client = service()
  const t = client.schema('tariffs')
  const { data: tr } = await t.from('tariff').select('id, tariff_year_id').eq('id', tariffId).maybeSingle()
  if (!tr) return null
  const { data: y } = await t.from('tariff_year').select('id, licensee_id, financial_year, effective_from, state').eq('id', (tr as Row).tariff_year_id as string).maybeSingle()
  const year = y as Row | null
  if (!year || year.state !== 'published') return null
  const { data: lic } = await t.from('licensee').select('name').eq('id', year.licensee_id as string).maybeSingle()
  const loaded = (await loadYearTariffs(client, String(year.id))).find((l) => l.id === tariffId)
  if (!loaded) return null
  const cal = await loadStudyCalendar(client, String(year.licensee_id), String(year.effective_from ?? new Date().toISOString().slice(0, 10)))
  const licenseeName = String((lic as Row | null)?.name ?? '')
  return {
    tariff: loaded.tariff,
    calendar: cal.calendar,
    calendarAssumedEskom: cal.assumedEskom,
    tariffId,
    label: `${licenseeName} · ${String(year.financial_year)} · ${loaded.tariff.name}`,
    licenseeName,
    financialYear: String(year.financial_year),
  }
}
