'use server'
/**
 * Handover checklist (spec §10): each item links ONE file of the project's E-Site Documents
 * (tenants.documents) or is marked N/A. The org template lives in /settings/solar (owner/admin).
 * 00217's bind trigger refuses a document from another project and stamps completion.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { parseHandoverTemplate, templateFromRow } from '@esite/shared/solar-operations'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { opsError } from '@/lib/solar/operations/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type Err = { error: string }

async function gate(projectId: string): Promise<{ supabase: AnyClient; userId: string } | Err> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}

async function itemLabel(supabase: AnyClient, itemId: string): Promise<string | null> {
  const { data } = await supabase.schema('solar').from('handover_items').select('label').eq('id', itemId).maybeSingle()
  return data ? String((data as Row).label) : null
}

export async function linkHandoverDocumentAction(input: { projectId: string; itemId: string; documentId: string | null }): Promise<{ ok: true } | Err> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const label = await itemLabel(g.supabase, input.itemId)
  if (!label) return { error: 'That checklist item no longer exists — reload.' }
  const { error } = await g.supabase.schema('solar').from('handover_items')
    .update({ document_id: input.documentId, not_applicable: false }).eq('id', input.itemId)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'handover_updated', objectRef: { item: label, documentId: input.documentId } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_handover_updated', properties: { change: input.documentId ? 'linked' : 'unlinked' } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

export async function setHandoverNotApplicableAction(input: { projectId: string; itemId: string; notApplicable: boolean; note: string }): Promise<{ ok: true } | Err> {
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > 1000) return { error: 'The note is at most 1000 characters.' }
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const label = await itemLabel(g.supabase, input.itemId)
  if (!label) return { error: 'That checklist item no longer exists — reload.' }
  const payload = input.notApplicable === true ? { not_applicable: true, document_id: null, note: note || null } : { not_applicable: false, note: note || null }
  const { error } = await g.supabase.schema('solar').from('handover_items').update(payload).eq('id', input.itemId)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'handover_updated', objectRef: { item: label, notApplicable: input.notApplicable === true } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_handover_updated', properties: { change: input.notApplicable ? 'not_applicable' : 'applicable' } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

export async function syncHandoverItemsAction(input: { projectId: string; installationId: string }): Promise<{ ok: true; added: number } | Err> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const solar = () => g.supabase.schema('solar')
  const { data: inst } = await solar().from('installations').select('id, organisation_id').eq('id', input.installationId).maybeSingle()
  if (!inst) return { error: 'The installation could not be found — reload.' }
  const [{ data: tpl }, { data: have }] = await Promise.all([
    solar().from('handover_templates').select('name, items').eq('organisation_id', String((inst as Row).organisation_id)).maybeSingle(),
    solar().from('handover_items').select('item_key, sort_order').eq('installation_id', input.installationId),
  ])
  const existing = new Set(((have ?? []) as Row[]).map((r) => String(r.item_key)))
  const maxOrder = Math.max(-1, ...((have ?? []) as Row[]).map((r) => Number(r.sort_order ?? 0)))
  const missing = templateFromRow((tpl as { name: unknown; items: unknown } | null) ?? null).items.filter((it) => !existing.has(it.key))
  if (missing.length === 0) return { ok: true, added: 0 }
  const { error } = await solar().from('handover_items').insert(missing.map((it, k) => ({
    installation_id: input.installationId, item_key: it.key, label: it.label, required: it.required, sort_order: maxOrder + 1 + k,
  })))
  if (error) return { error: opsError(error) }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, added: missing.length }
}

export async function saveHandoverTemplateAction(input: { name: string; items: unknown; expectedUpdatedAt: string | null }):
  Promise<{ ok: true; updatedAt: string } | Err | { fieldErrors: Record<string, string> }> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const r = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!r.ok) return { error: 'Only an organisation owner or admin can change the handover template.' }
  const parsed = parseHandoverTemplate({ name: typeof input.name === 'string' ? input.name.trim() : input.name, items: input.items })
  if (!parsed.ok) return { fieldErrors: { template: parsed.errors.join('; ') } }
  const values = { name: parsed.value.name, items: parsed.value.items }
  const t = () => supabase.schema('solar').from('handover_templates')
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ organisation_id: ctx.organisationId, ...values }).select('updated_at')
    : await t().update(values).eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}
