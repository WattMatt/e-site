import 'server-only'
/**
 * The ONE loader of a study's pricing (I-1). Reads the rows and hands them to the pure
 * `resolveStudyPricing` (packages/shared/src/solar/tariff/pricing.ts). Both money paths go through
 * here, so they cannot price a study differently:
 *   - the Tariff tab bill check (lib/solar/tariff/effective-tariff.ts, the caller's session), and
 *   - the case run + financials (lib/solar/cases/tariff.ts, the service client after the Solar gate).
 * `pricing-single-source.contract.test.ts` pins that neither builds a tariff on its own.
 *
 * Every failed read is an error (fail closed): a pricing built from a partial read would be a
 * plausible wrong number, which is worse than no number. That includes money rows RLS hid.
 * The hash that marks cases Stale is keyed server-side (pricing-hash.ts), in the run path only.
 */
import {
  overrideChargeFromDb, parseExportRule, readSolarOrgSettings, resolveStudyPricing,
  LICENSEE_KINDS, type LicenseeKind, type ResolvedStudyPricing, type SsegRule, type Tariff,
} from '@esite/shared'
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { exportRateFromRow } from '../tariff/rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type PgError = { code?: string; message?: string }

export const STUDY_PRICING_COLUMNS = 'id, organisation_id, tariff_id, tariff_override_id, export_rule, escalation, load_growth_pct, nmd_kva, licensee_id'

export type StudyPricingLoad =
  | {
      ok: true
      pricing: ResolvedStudyPricing
      study: { id: string; organisationId: string; tariffId: string; nmdKva: number | null; licenseeId: string | null }
      tariffYear: { id: string; financialYear: string; state: string; licenseeId: string }
      licenseeName: string
    }
  | { ok: false; code: 'noStudy' | 'notPinned' | 'tariffMissing' | 'unreadable' }
  | { ok: false; code: 'studyReadFailed'; error: PgError }

export function ssegFromRow(r: Row): SsegRule {
  return {
    crediting: r.crediting as SsegRule['crediting'], carryForward: r.carry_forward as SsegRule['carryForward'],
    fyEndMonth: Number(r.fy_end_month), capRule: r.cap_rule as SsegRule['capRule'], offsets: 'energy_only',
    forfeitOnOwnershipChange: Boolean(r.forfeit_on_ownership_change), maxKva: Number(r.max_kva),
    requiresTou: Boolean(r.requires_tou), requiresBidirectionalMeter: Boolean(r.requires_bidirectional_meter),
    locator: (r.locator ?? {}) as Record<string, string>,
  }
}

function unreadable(projectId: string, what: string, err: PgError | null | undefined): { ok: false; code: 'unreadable' } {
  console.error('[solar-pricing] read failed', { projectId, what, code: err?.code, err: err?.message })
  return { ok: false, code: 'unreadable' }
}

async function tariffWithCharges(t: ReturnType<AnyClient['schema']>, id: string): Promise<{ row: Row; tariff: Tariff } | 'missing' | { error: PgError }> {
  const [{ data: row, error: re }, { data: charges, error: ce }] = await Promise.all([
    t.from('tariff').select('*').eq('id', id).maybeSingle(),
    t.from('charge').select('*').eq('tariff_id', id),
  ])
  if (re) return { error: re }
  if (ce) return { error: ce }
  if (!row) return 'missing'
  return { row: row as Row, tariff: tariffFromRows(row as Row, (charges ?? []) as Row[]) }
}

export async function loadStudyPricing(client: AnyClient, projectId: string): Promise<StudyPricingLoad> {
  const solar = client.schema('solar')
  const t = client.schema('tariffs')
  const { data: s, error: se } = await solar.from('studies').select(STUDY_PRICING_COLUMNS).eq('project_id', projectId).maybeSingle()
  if (se) return { ok: false, code: 'studyReadFailed', error: se }
  const study = s as Row | null
  if (!study) return { ok: false, code: 'noStudy' }
  const tariffId = (study.tariff_id ?? null) as string | null
  if (!tariffId) return { ok: false, code: 'notPinned' }

  const main = await tariffWithCharges(t, tariffId)
  if (main === 'missing') return { ok: false, code: 'tariffMissing' }
  if ('error' in main) return unreadable(projectId, 'tariff', main.error)
  const { data: y, error: ye } = await t.from('tariff_year').select('id, licensee_id, financial_year, state').eq('id', String(main.row.tariff_year_id)).maybeSingle()
  if (ye || !y) return unreadable(projectId, 'tariff_year', ye)
  const year = y as Row
  const licenseeId = String(year.licensee_id)

  const overrideId = (study.tariff_override_id ?? null) as string | null
  const [lic, sseg, years, ov, rates, os, linked] = await Promise.all([
    t.from('licensee').select('name, kind').eq('id', licenseeId).maybeSingle(),
    t.from('sseg_rule').select('*').eq('tariff_year_id', String(year.id)).maybeSingle(),
    t.from('tariff_year').select('financial_year, approved_increase_pct').eq('licensee_id', licenseeId).in('state', ['published', 'superseded']),
    overrideId ? solar.from('tariff_override_charges').select('*').eq('override_id', overrideId) : Promise.resolve({ data: [] as Row[], error: null }),
    solar.from('study_export_rates').select('*').eq('study_id', String(study.id)),
    solar.from('org_settings').select('settings').eq('organisation_id', String(study.organisation_id)).maybeSingle(),
    main.row.export_tariff_id ? tariffWithCharges(t, String(main.row.export_tariff_id)) : Promise.resolve(null),
  ])
  for (const [what, r] of [['licensee', lic], ['sseg_rule', sseg], ['tariff_year list', years], ['tariff_override_charges', ov], ['study_export_rates', rates], ['org_settings', os]] as const) {
    if (r.error) return unreadable(projectId, what, r.error)
  }
  if (linked && linked !== 'missing' && 'error' in linked) return unreadable(projectId, 'export tariff', linked.error)
  // RLS hides money rows from a caller without financials access WITHOUT an error. An override the
  // study points at has at least its copied charges, and 00219 ties a manual rule to its rates, so
  // an empty read there means "not allowed to see it" — never price the partial picture.
  const ovRows = (ov.data ?? []) as Row[]
  const rateRows = (rates.data ?? []) as Row[]
  if (overrideId && ovRows.length === 0) return unreadable(projectId, 'tariff_override_charges (none visible)', null)
  if (parseExportRule(study.export_rule)?.method === 'manual' && rateRows.length === 0) return unreadable(projectId, 'study_export_rates (none visible)', null)
  const licRow = lic.data as Row | null
  const kind = String(licRow?.kind ?? '')

  let pricing: ResolvedStudyPricing
  try {
    pricing = resolveStudyPricing({
      study: {
        tariffOverrideId: overrideId,
        exportRule: study.export_rule ?? null,
        escalation: study.escalation ?? null,
        loadGrowthPct: (study.load_growth_pct ?? null) as number | string | null,
      },
      published: {
        tariffId,
        tariff: main.tariff,
        financialYear: String(year.financial_year ?? ''),
        licenseeKind: ((LICENSEE_KINDS as readonly string[]).includes(kind) ? kind : 'municipal') as LicenseeKind,
        exportTariff: linked && linked !== 'missing' ? linked.tariff : null,
        sseg: sseg.data ? ssegFromRow(sseg.data as Row) : null,
        years: ((years.data ?? []) as Row[]).map((r) => ({
          financialYear: String(r.financial_year),
          approvedIncreasePct: r.approved_increase_pct === null || r.approved_increase_pct === undefined ? null : Number(r.approved_increase_pct),
        })),
      },
      override: overrideId ? { id: overrideId, rows: ovRows.map(overrideChargeFromDb) } : null,
      exportRates: rateRows.map((r) => ({ ...exportRateFromRow(r), sourceNote: (r.source_note ?? null) as string | null })),
      orgSettings: readSolarOrgSettings((os.data as { settings?: unknown } | null)?.settings ?? null),
    })
  } catch (e) {
    // A corrupt row (e.g. a non-finite amount the canonical ordering refuses) is unreadable, not a crash.
    return unreadable(projectId, 'resolve', { message: String((e as Error)?.message ?? e) })
  }
  const nmd = study.nmd_kva
  return {
    ok: true, pricing,
    study: {
      id: String(study.id), organisationId: String(study.organisation_id), tariffId,
      nmdKva: nmd === null || nmd === undefined ? null : Number(nmd), licenseeId: (study.licensee_id ?? null) as string | null,
    },
    tariffYear: { id: String(year.id), financialYear: String(year.financial_year ?? ''), state: String(year.state ?? ''), licenseeId },
    licenseeName: String(licRow?.name ?? ''),
  }
}
