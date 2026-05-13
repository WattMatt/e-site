'use server'

/**
 * Engineer Equipment Schedule — server actions.
 *
 * The schedule is the engineer-authored bill-of-materials (BOM) for a
 * project. Each line tracks what *needs* to be procured; downstream
 * procurement_items (linked via schedule_item_id) track what's actually
 * been ordered, against which quote, etc.
 *
 * RLS gates everything — these actions are thin wrappers around the
 * Supabase client and trust the org-membership + role checks in the
 * policy. Migration 00046 enforces: owner / admin / project_manager /
 * field_worker can write; client_viewer cannot.
 *
 * The schedule line's `status` field is currently maintained by app code
 * (this module's `recomputeScheduleStatus`) rather than a DB trigger, to
 * keep migration 00046 lean. Status transitions:
 *   open               — no procurement linked yet
 *   partially_ordered  — some procurement_items linked, not all qty covered
 *   fully_ordered      — total ordered qty ≥ scheduled qty (all status ≥ approved)
 *   fully_delivered    — total delivered qty ≥ scheduled qty
 *   cancelled          — engineer marked the line as no-longer-needed
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'

const uuid = z.string().uuid()

const createSchema = z.object({
  projectId: uuid,
  itemCode: z.string().trim().max(64).optional().nullable(),
  description: z.string().trim().min(2, 'Description required').max(500),
  specification: z.string().trim().max(1000).optional().nullable(),
  quantity: z.number().positive('Quantity must be > 0'),
  unit: z.string().trim().max(32).optional().nullable(),
  estimatedUnitCost: z.number().nonnegative().optional().nullable(),
  currency: z.string().length(3).default('ZAR'),
  instructions: z.string().trim().max(4000).optional().nullable(),
  shopDrawingRequired: z.boolean().default(false),
})

const updateSchema = createSchema.partial().extend({ id: uuid })

const updateStatusSchema = z.object({
  id: uuid,
  status: z.enum([
    'open',
    'partially_ordered',
    'fully_ordered',
    'fully_delivered',
    'cancelled',
  ]),
})

export type CreateScheduleInput = z.infer<typeof createSchema>
export type UpdateScheduleInput = z.infer<typeof updateSchema>
export type UpdateScheduleStatusInput = z.infer<typeof updateStatusSchema>

export async function createScheduleItemAction(
  input: CreateScheduleInput,
): Promise<{ id?: string; error?: string }> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Look up the project's organisation_id — denormalised onto the
  // schedule row so RLS can match without a join.
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', parsed.data.projectId)
    .single()
  if (projErr || !project) {
    return { error: 'Project not found' }
  }

  const i = parsed.data
  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('engineer_equipment_schedule')
    .insert({
      project_id: i.projectId,
      organisation_id: (project as { organisation_id: string }).organisation_id,
      item_code: i.itemCode || null,
      description: i.description,
      specification: i.specification || null,
      quantity: i.quantity,
      unit: i.unit || null,
      estimated_unit_cost: i.estimatedUnitCost ?? null,
      currency: i.currency,
      instructions: i.instructions || null,
      shop_drawing_required: i.shopDrawingRequired,
      added_by: user.id,
    })
    .select('id')
    .single()

  if (error || !row) return { error: error?.message ?? 'Failed to create' }

  await trackServer(user.id, ANALYTICS_EVENTS.SCHEDULE_ITEM_CREATED, {
    project_id: i.projectId,
    has_specification: !!i.specification,
    shop_drawing_required: i.shopDrawingRequired,
  }).catch(() => {})

  revalidatePath(`/projects/${i.projectId}/schedule`)
  return { id: (row as { id: string }).id }
}

export async function updateScheduleItemAction(
  input: UpdateScheduleInput,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const i = parsed.data
  // Build a partial update object — only set fields that were provided.
  const patch: Record<string, unknown> = {}
  if (i.itemCode !== undefined) patch.item_code = i.itemCode || null
  if (i.description !== undefined) patch.description = i.description
  if (i.specification !== undefined) patch.specification = i.specification || null
  if (i.quantity !== undefined) patch.quantity = i.quantity
  if (i.unit !== undefined) patch.unit = i.unit || null
  if (i.estimatedUnitCost !== undefined) patch.estimated_unit_cost = i.estimatedUnitCost
  if (i.currency !== undefined) patch.currency = i.currency
  if (i.instructions !== undefined) patch.instructions = i.instructions || null
  if (i.shopDrawingRequired !== undefined) patch.shop_drawing_required = i.shopDrawingRequired

  const { error, data } = await (supabase as any)
    .schema('projects')
    .from('engineer_equipment_schedule')
    .update(patch)
    .eq('id', i.id)
    .select('project_id')
    .single()

  if (error) return { error: error.message }
  const projectId = (data as { project_id?: string } | null)?.project_id
  if (projectId) revalidatePath(`/projects/${projectId}/schedule`)
  return { ok: true }
}

export async function updateScheduleStatusAction(
  input: UpdateScheduleStatusInput,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateStatusSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error, data } = await (supabase as any)
    .schema('projects')
    .from('engineer_equipment_schedule')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)
    .select('project_id')
    .single()

  if (error) return { error: error.message }
  const projectId = (data as { project_id?: string } | null)?.project_id
  if (projectId) revalidatePath(`/projects/${projectId}/schedule`)
  return { ok: true }
}

export async function deleteScheduleItemAction(
  id: string,
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Capture project_id BEFORE the delete so we can revalidate.
  const { data: existing } = await (supabase as any)
    .schema('projects')
    .from('engineer_equipment_schedule')
    .select('project_id')
    .eq('id', id)
    .single()

  const { error } = await (supabase as any)
    .schema('projects')
    .from('engineer_equipment_schedule')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  const projectId = (existing as { project_id?: string } | null)?.project_id
  if (projectId) revalidatePath(`/projects/${projectId}/schedule`)
  return { ok: true }
}
