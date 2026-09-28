'use server'
/**
 * Review queue actions (spec §12). Approve / Edit / Reject a charge, delete a
 * tariff, Validate (records the verdict on the content it checked), Publish,
 * and the SSEG rule. Every action re-checks is_platform_tariff_admin; writes go
 * through the admin's session so 00209's guards decide (draft-only edits,
 * review stamps, publish rules, immutability).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { previousFinancialYear, validateRateEdit, type ChargeComponent, type TariffSeason, type TariffUnit } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError, TARIFF_GENERIC_ERROR } from '@/lib/tariffs/errors'
import { loadPreviousPublished, loadYearTariffs } from '@/lib/tariffs/load-year'
import { computeYearChecks } from '@/lib/tariffs/year-checks'
import { validateSsegForm, type SsegField, type SsegForm } from '@/lib/tariffs/sseg-form'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Ok = { ok: true } | { error: string }

const GONE = 'That charge no longer exists. Reload the page.'

function done(yearPath?: string): void {
  revalidatePath('/admin/tariffs', 'layout')
  if (yearPath) revalidatePath(yearPath)
}

export async function approveChargeAction(input: { chargeId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  // Any non-null stamp: tariffs.charge_review_bind rewrites it to (caller, now).
  const { data, error } = await gate.supabase.schema('tariffs').from('charge')
    .update({ reviewed_at: new Date().toISOString() }).eq('id', input.chargeId).select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: GONE }
  done()
  return { ok: true }
}

export async function editChargeAction(input: { chargeId: string; amount: string; unit: TariffUnit | ''; unitConfirmed: boolean }): Promise<
  { ok: true } | { error: string } | { fieldErrors: Partial<Record<'amount' | 'unit', string>> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const t = gate.supabase.schema('tariffs')
  const { data: row } = await t.from('charge').select('id, component, season, unit, unit_inferred, inference_reason').eq('id', input.chargeId).maybeSingle()
  const c = row as { component: ChargeComponent; season: TariffSeason; unit_inferred: boolean; inference_reason: string | null } | null
  if (!c) return { error: GONE }
  const rate = validateRateEdit({ component: c.component, season: c.season }, { amount: input.amount, unit: input.unit })
  if ('errors' in rate) return { fieldErrors: rate.errors }
  const confirmed = Boolean(input.unitConfirmed)
  const { data, error } = await t.from('charge').update({
    amount_excl_vat: rate.amountExclVat, unit: rate.unit,
    unit_inferred: confirmed ? false : c.unit_inferred, inference_reason: confirmed ? null : c.inference_reason,
    extraction_method: 'manual',
  }).eq('id', input.chargeId).select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: GONE }
  done()
  return { ok: true }
}

export async function rejectChargeAction(input: { chargeId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { error } = await gate.supabase.schema('tariffs').from('charge').delete().eq('id', input.chargeId)
  if (error) return { error: humanTariffError(error) }
  done()
  return { ok: true }
}

export async function deleteTariffAction(input: { tariffId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { error } = await gate.supabase.schema('tariffs').from('tariff').delete().eq('id', input.tariffId)
  if (error) return { error: humanTariffError(error) }
  done()
  return { ok: true }
}

export async function validateTariffYearAction(input: { yearId: string }): Promise<
  { ok: true; blocking: number; review: number; warn: number } | { error: string }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const svc = createServiceClient() as unknown as AnyClient
  const { data: y } = await svc.schema('tariffs').from('tariff_year')
    .select('id, licensee_id, financial_year, approved_increase_pct, state').eq('id', input.yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; financial_year: string; approved_increase_pct: number | string | null; state: string } | null
  if (!year) return { error: 'That tariff year does not exist.' }
  if (year.state !== 'ingesting' && year.state !== 'in_review') return { error: 'Only a draft year can be checked.' }
  // Fingerprint FIRST: the verdict is recorded only on the content read after it.
  const fp = await svc.schema('tariffs').rpc('year_content_fingerprint', { p_year_id: year.id })
  if (fp.error || typeof fp.data !== 'string') return { error: TARIFF_GENERIC_ERROR }
  let checks
  try {
    const loaded = await loadYearTariffs(svc, year.id)
    const prev = await loadPreviousPublished(svc, year.licensee_id, previousFinancialYear(year.financial_year))
    const approved = year.approved_increase_pct === null ? null : Number(year.approved_increase_pct)
    checks = computeYearChecks(loaded.map((l) => l.tariff), prev?.tariffs ?? null, approved)
  } catch (e) {
    console.error('[tariff-validate] load failed', { yearId: year.id, err: String(e) })
    return { error: TARIFF_GENERIC_ERROR }
  }
  const rec = await svc.schema('tariffs').rpc('record_year_validation', {
    p_year_id: year.id, p_blocking: checks.blocking, p_fingerprint: fp.data,
  })
  if (rec.error) return { error: humanTariffError(rec.error) }
  done(`/admin/tariffs/years/${year.id}`)
  return { ok: true, blocking: checks.blocking, review: checks.review, warn: checks.warn }
}

export async function publishTariffYearAction(input: { yearId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { data, error } = await gate.supabase.schema('tariffs').from('tariff_year')
    .update({ state: 'published' }).eq('id', input.yearId).eq('state', 'in_review').select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'This year is not waiting for review.' }
  done(`/admin/tariffs/years/${input.yearId}`)
  return { ok: true }
}

const SSEG_STALE = 'Someone else changed this SSEG rule. Reload to see their version.'

/**
 * Stale-guarded on tariffs.sseg_rule.updated_at (00213): an update is
 * conditioned on the value the form loaded, and a create (nothing loaded)
 * collides with UNIQUE (tariff_year_id) if someone created one meanwhile.
 */
export async function saveSsegRuleAction(input: { yearId: string; expectedUpdatedAt: string | null; form: SsegForm }): Promise<
  { ok: true; updatedAt: string } | { error: string } | { fieldErrors: Partial<Record<SsegField, string>> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const v = validateSsegForm(input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const t = gate.supabase.schema('tariffs')
  const { data: y } = await t.from('tariff_year').select('id, licensee_id, state').eq('id', input.yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; state: string } | null
  if (!year) return { error: 'That tariff year does not exist.' }
  const res = input.expectedUpdatedAt
    ? await t.from('sseg_rule').update(v.row).eq('tariff_year_id', year.id).eq('updated_at', input.expectedUpdatedAt).select('id, updated_at')
    : await t.from('sseg_rule').insert({ ...v.row, tariff_year_id: year.id, licensee_id: year.licensee_id }).select('id, updated_at')
  if (res.error) return { error: res.error.code === '23505' ? SSEG_STALE : humanTariffError(res.error) }
  const saved = (Array.isArray(res.data) ? res.data[0] : null) as { updated_at?: string } | null
  if (!saved) return { error: SSEG_STALE }
  done(`/admin/tariffs/years/${year.id}`)
  return { ok: true, updatedAt: String(saved.updated_at ?? '') }
}
