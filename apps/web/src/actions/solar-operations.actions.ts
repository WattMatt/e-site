'use server'
/**
 * Operations tab actions (spec §10). Every action gates its Solar level FIRST (requireSolarLevel
 * redirects a lower level), writes through the caller's session so 00217's RESTRICTIVE policies and
 * bind triggers decide, and reports trigger refusals in their own words (opsError).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAsBuilt, templateFromRow } from '@esite/shared/solar-operations'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { INSTALL_REASONS, loadInstallationSeed } from '@/lib/solar/operations/baseline-loader'
import { opsError } from '@/lib/solar/operations/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type Err = { error: string }
type FieldErrors = { fieldErrors: Record<string, string> }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
function realDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && Number(m[1]) >= 2000
}

async function gate(projectId: string, need: 'view' | 'edit' | 'edit_financials'): Promise<{ supabase: AnyClient; userId: string } | Err> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}
const done = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

// ── Installation ──────────────────────────────────────────────────────────
export async function createInstallationAction(input: { projectId: string }): Promise<{ ok: true; installationId: string; warning: string | null } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { supabase, userId } = g
  const { data: study } = await supabase.schema('solar').from('studies').select('id, organisation_id').eq('project_id', input.projectId).maybeSingle()
  if (!study) return { error: INSTALL_REASONS.noStudy }
  const s = study as Row
  const seed = await loadInstallationSeed(createServiceClient() as unknown as AnyClient, String(s.id))
  if (!seed.ok) return { error: seed.reason }

  const { data, error } = await supabase.schema('solar').from('installations')
    .insert({ study_id: s.id, proposal_id: seed.proposalId, baseline: seed.baseline, as_built: seed.asBuilt }).select('id')
  if (error) return { error: error.code === '23505' ? INSTALL_REASONS.exists : opsError(error) }
  const installationId = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!installationId) return { error: 'Could not record the installation — try again.' }

  // The guarantee starts as the accepted case's P50 with the case's own degradation: nobody retypes it.
  const warnings: string[] = []
  const { error: gErr } = await supabase.schema('solar').from('guarantees')
    .insert({ installation_id: installationId, basis: 'p50', degradation_pct_per_year: seed.degradationPctPerYear })
  if (gErr) warnings.push('The guarantee basis could not be saved — set it on the Guarantee card.')
  const { data: tpl } = await supabase.schema('solar').from('handover_templates').select('name, items').eq('organisation_id', s.organisation_id).maybeSingle()
  const template = templateFromRow((tpl as { name: unknown; items: unknown } | null) ?? null)
  const { error: hErr } = await supabase.schema('solar').from('handover_items').insert(
    template.items.map((it, k) => ({ installation_id: installationId, item_key: it.key, label: it.label, required: it.required, sort_order: k })))
  if (hErr) warnings.push('The handover checklist could not be created — use "Add missing items" on the checklist.')

  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'installation_created', objectRef: { installationId, proposalId: seed.proposalId } })
  await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_installation_saved', properties: { action: 'created' } })
  done(input.projectId)
  return { ok: true, installationId, warning: warnings.length ? warnings.join(' ') : null }
}

export async function saveInstallationAction(input: {
  projectId: string; installationId: string; commissioningDate: string | null; asBuilt: unknown; notes: string | null; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const fieldErrors: Record<string, string> = {}
  const date = input.commissioningDate === null || input.commissioningDate === '' ? null : String(input.commissioningDate)
  if (date !== null && !realDate(date)) fieldErrors.commissioningDate = 'Enter a real date (YYYY-MM-DD).'
  const ab = parseAsBuilt(input.asBuilt)
  if (!ab.ok) fieldErrors.asBuilt = ab.errors.join('; ')
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (notes.length > 5000) fieldErrors.notes = 'At most 5000 characters.'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const { data, error } = await g.supabase.schema('solar').from('installations')
    .update({ commissioning_date: date, as_built: ab.ok ? ab.value : null, notes: notes || null })
    .eq('id', input.installationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'installation_saved', objectRef: { installationId: input.installationId } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_installation_saved', properties: { action: 'saved' } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}
