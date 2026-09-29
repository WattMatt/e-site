'use server'
/**
 * Equipment catalogue (functional spec §11): Add, Edit, Retire (never delete — cases reference it),
 * Import from CSV. PAN/OND import deferred (D-19). Owner/admin of the ACTIVE org (the catalogue lives
 * in /settings/solar); 00216's equipment_*_authz policies (solar.library_orgs('admin')) decide in the DB.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { EQUIPMENT_KINDS, parseEquipmentCsv, parseEquipmentSpecs, type EquipmentKind } from '@esite/shared/solar-cases'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const NOT_ADMIN = 'Only an organisation owner or admin can change the equipment catalogue.'
const MAX_CSV_BYTES = 512 * 1024
const PAGE = '/settings/solar/equipment'

async function gate(): Promise<{ error: string } | { ctx: { organisationId: string; userId: string }; supabase: AnyClient }> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const r = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!r.ok) return { error: NOT_ADMIN }
  return { ctx, supabase }
}

export async function saveSolarEquipmentAction(input: { id: string | null; kind: EquipmentKind; make: string; model: string; specs: unknown; expectedUpdatedAt: string | null }):
  Promise<{ ok: true; id: string; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate()
  if ('error' in g) return { error: g.error }
  if (!EQUIPMENT_KINDS.includes(input.kind)) return { fieldErrors: { kind: 'Choose module, inverter or battery' } }
  const make = String(input.make ?? '').trim(), model = String(input.model ?? '').trim()
  if (!make) return { fieldErrors: { make: 'Enter the make' } }
  if (!model) return { fieldErrors: { model: 'Enter the model' } }
  if (make.length > 120 || model.length > 120) return { fieldErrors: { model: 'Keep the make and model under 120 characters' } }
  const specs = parseEquipmentSpecs(input.kind, input.specs)
  if (!specs.ok) return { fieldErrors: specs.errors }
  const t = () => g.supabase.schema('solar').from('equipment')
  const res = input.id === null
    ? await t().insert({ organisation_id: g.ctx.organisationId, kind: input.kind, make, model, specs: specs.specs, source: 'manual' }).select('id, updated_at')
    : await t().update({ make, model, specs: specs.specs })
      .eq('id', input.id).eq('organisation_id', g.ctx.organisationId).eq('kind', input.kind).eq('updated_at', input.expectedUpdatedAt ?? '').select('id, updated_at')
  if (res.error) return res.error.code === '23505' ? { fieldErrors: { model: 'This make and model is already in the catalogue' } } : { error: humanSolarError(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
  await emitProductEvent({ actorId: g.ctx.userId, projectId: null, organisationId: g.ctx.organisationId, event: 'solar_equipment_saved' })
  revalidatePath(PAGE)
  return { ok: true, id: res.data[0]!.id as string, updatedAt: res.data[0]!.updated_at as string }
}

export async function retireSolarEquipmentAction(input: { id: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate()
  if ('error' in g) return { error: g.error }
  const { data, error } = await g.supabase.schema('solar').from('equipment').update({ retired_at: new Date().toISOString() })
    .eq('id', input.id).eq('organisation_id', g.ctx.organisationId).select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was retired — platform rows cannot be retired, and the row may have moved on.' }
  revalidatePath(PAGE)
  return { ok: true }
}

export async function importSolarEquipmentCsvAction(input: { text: string }):
  Promise<{ ok: true; added: number; skipped: number } | { errors: Array<{ line: number; message: string }> } | { error: string }> {
  const g = await gate()
  if ('error' in g) return { error: g.error }
  const text = String(input.text ?? '')
  if (text.length > MAX_CSV_BYTES) return { error: 'The file is larger than 512 KB.' }
  const parsed = parseEquipmentCsv(text)
  if (parsed.errors.length > 0) return { errors: parsed.errors }
  let added = 0, skipped = 0
  for (const r of parsed.rows) {
    const { error } = await g.supabase.schema('solar').from('equipment')
      .insert({ organisation_id: g.ctx.organisationId, kind: r.kind, make: r.make, model: r.model, specs: r.specs, source: 'csv' })
    if (!error) added++
    else if (error.code === '23505') skipped++
    else return { error: `Stopped at ${r.make} ${r.model}: ${humanSolarError(error)} (${added} added before it).` }
  }
  if (added > 0) await emitProductEvent({ actorId: g.ctx.userId, projectId: null, organisationId: g.ctx.organisationId, event: 'solar_equipment_saved' })
  revalidatePath(PAGE)
  return { ok: true, added, skipped }
}
