'use server'

/**
 * Cable length workflow — Measured (Designer) and Confirmed (Site Operator
 * + Verifier) lengths, with sign-off transitions per spec §15.
 *
 * Phase-1 simplification: org-role gating is enforced via RLS + a
 * permissive app-side check until the dedicated Designer / Site Operator
 * / Verifier roles land in C-8. Until then, any DRAFT-revision write
 * passes — the change_log records who actually did the edit, which is
 * the audit substance.
 *
 * Editing the confirmed_length:
 *   - blank measured + confirmed     → length_status stays UNMEASURED
 *   - measured set, no confirmed     → MEASURED
 *   - confirmed set, NOT signed off  → MEASURED (Phase-1; the Verifier
 *                                      role-based sign-off lands in C-8)
 *   - confirmed signed off, Δ ≤ threshold → CONFIRMED
 *   - confirmed signed off, Δ > threshold → DISCREPANCY
 *
 * The discrepancy threshold defaults to max(10% of measured, 5 m).
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()

const measuredSchema = z.object({
  cableId: uuid,
  measuredLengthM: z.number().nonnegative().nullable(),
  method: z.enum(['CAD','SCALE_RULE','MANUAL']).optional().nullable(),
})

const confirmedSchema = z.object({
  cableId: uuid,
  confirmedLengthM: z.number().nonnegative().nullable(),
  method: z.enum(['PULL_TAPE','LASER','DRUM_MARKING','REEL_LABEL']).optional().nullable(),
  evidenceUrl: z.string().max(800).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  /** Verifier sign-off — only true when the user is explicitly approving. */
  signOff: z.boolean().default(false),
  /** Discrepancy threshold override (absolute, metres). */
  discrepancyAbsM: z.number().nonnegative().optional(),
  /** Discrepancy threshold override (percentage 0–100). */
  discrepancyPct: z.number().nonnegative().optional(),
})

function discrepancyExceeded(
  measured: number | null,
  confirmed: number | null,
  thresholdAbsM = 5,
  thresholdPct = 10,
): boolean {
  if (measured == null || confirmed == null) return false
  const absDelta = Math.abs(confirmed - measured)
  if (absDelta > thresholdAbsM) return true
  const pct = measured > 0 ? (absDelta / measured) * 100 : 0
  if (pct > thresholdPct) return true
  return false
}

async function loadCableContext(supabase: any, cableId: string) {
  const { data: row, error } = await supabase
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, revision_id, organisation_id, measured_length_m, confirmed_length_m, length_status, ' +
      'revision:revisions!revision_id(id, status, project_id)',
    )
    .eq('id', cableId)
    .single()
  if (error || !row) return { error: 'Cable not found' as const }
  const r = row as any
  if (r.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to edit lengths.' as const }
  }
  return {
    revisionId: r.revision_id as string,
    projectId: r.revision.project_id as string,
    measured: r.measured_length_m == null ? null : Number(r.measured_length_m),
    confirmed: r.confirmed_length_m == null ? null : Number(r.confirmed_length_m),
    status: r.length_status as 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY',
  }
}

export async function updateMeasuredLengthAction(
  input: z.infer<typeof measuredSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = measuredSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadCableContext(supabase, parsed.data.cableId)
  if ('error' in ctx) return { error: ctx.error }

  // Status transitions:
  //   measured set, no confirmed     → MEASURED
  //   measured set, confirmed set    → recompute discrepancy
  //   measured cleared               → UNMEASURED (no confirmed) or MEASURED (with confirmed pending)
  const newMeasured = parsed.data.measuredLengthM
  let newStatus: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY' = 'UNMEASURED'
  if (newMeasured != null) {
    if (ctx.confirmed == null) newStatus = 'MEASURED'
    else newStatus = discrepancyExceeded(newMeasured, ctx.confirmed) ? 'DISCREPANCY' : 'CONFIRMED'
  } else {
    newStatus = ctx.confirmed == null ? 'UNMEASURED' : 'MEASURED'
  }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .update({
      measured_length_m: newMeasured,
      measured_length_by: newMeasured != null ? user.id : null,
      measured_length_at: newMeasured != null ? new Date().toISOString() : null,
      measured_length_method: parsed.data.method ?? null,
      length_status: newStatus,
    })
    .eq('id', parsed.data.cableId)
  if (error) return { error: error.message }

  // change_log
  await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert({
      revision_id: ctx.revisionId,
      organisation_id: (await (supabase as any)
        .schema('cable_schedule')
        .from('revisions')
        .select('organisation_id')
        .eq('id', ctx.revisionId)
        .single()).data?.organisation_id,
      entity_type: 'cable',
      entity_id: parsed.data.cableId,
      field_name: 'measured_length_m',
      old_value: ctx.measured,
      new_value: newMeasured,
      changed_by: user.id,
    })

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true }
}

export async function updateConfirmedLengthAction(
  input: z.infer<typeof confirmedSchema>,
): Promise<{ ok?: true; error?: string; status?: string }> {
  const parsed = confirmedSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadCableContext(supabase, parsed.data.cableId)
  if ('error' in ctx) return { error: ctx.error }

  const newConfirmed = parsed.data.confirmedLengthM
  // Status logic:
  //   confirmed cleared  → MEASURED (if measured) or UNMEASURED
  //   confirmed set, not signed off  → MEASURED (still pending sign-off)
  //   confirmed set + signOff + ≤ threshold  → CONFIRMED
  //   confirmed set + signOff + > threshold  → DISCREPANCY
  let newStatus: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY' = ctx.status
  if (newConfirmed == null) {
    newStatus = ctx.measured == null ? 'UNMEASURED' : 'MEASURED'
  } else if (!parsed.data.signOff) {
    newStatus = 'MEASURED'           // entered but pending Verifier sign-off
  } else {
    newStatus = discrepancyExceeded(
      ctx.measured, newConfirmed,
      parsed.data.discrepancyAbsM ?? 5,
      parsed.data.discrepancyPct ?? 10,
    ) ? 'DISCREPANCY' : 'CONFIRMED'
  }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .update({
      confirmed_length_m: newConfirmed,
      confirmed_length_by: newConfirmed != null ? user.id : null,
      confirmed_length_at: newConfirmed != null ? new Date().toISOString() : null,
      confirmed_length_method: parsed.data.method ?? null,
      confirmation_evidence_url: parsed.data.evidenceUrl ?? null,
      confirmation_notes: parsed.data.notes ?? null,
      length_status: newStatus,
    })
    .eq('id', parsed.data.cableId)
  if (error) return { error: error.message }

  // change_log — split into separate rows so the timeline view can filter
  // by field cleanly (§15.8).
  const { data: orgRow } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('organisation_id')
    .eq('id', ctx.revisionId)
    .single()
  const orgId = (orgRow as { organisation_id?: string } | null)?.organisation_id
  const events: Array<Record<string, unknown>> = []
  if (newConfirmed !== ctx.confirmed) {
    events.push({
      revision_id: ctx.revisionId, organisation_id: orgId,
      entity_type: 'cable', entity_id: parsed.data.cableId,
      field_name: 'confirmed_length_m',
      old_value: ctx.confirmed, new_value: newConfirmed,
      changed_by: user.id,
    })
  }
  if (newStatus !== ctx.status) {
    events.push({
      revision_id: ctx.revisionId, organisation_id: orgId,
      entity_type: 'cable', entity_id: parsed.data.cableId,
      field_name: 'length_status',
      old_value: ctx.status, new_value: newStatus,
      reason: parsed.data.notes ?? null,
      changed_by: user.id,
    })
  }
  if (events.length > 0) {
    await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  }

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true, status: newStatus }
}
