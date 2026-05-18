'use server'

/**
 * Shop drawing — server actions.
 *
 * Workflow:
 *   1. Supplier/contractor uploads a shop drawing for a procurement_item
 *      where the engineer schedule line flagged shop_drawing_required.
 *      Each upload is a row with revision = MAX(existing) + 1.
 *   2. Engineer/PM reviews and decides: approved | revise_and_resubmit |
 *      rejected. The decision is recorded in shop_drawing_approvals AND
 *      sets shop_drawings.status (one-decision-per-row model in Phase 2).
 *   3. procurement_items.status can advance to `approved` only when at
 *      least one shop_drawing for the item has status = 'approved'
 *      (app-side check — DB doesn't enforce, leaves flexibility for the
 *      "not required" case).
 *
 * RLS gates everything via migration 00047 — org members + scoped
 * client_viewers (read-only).
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

const uuid = z.string().uuid()

const uploadSchema = z.object({
  procurementItemId: uuid,
  title: z.string().trim().min(2).max(200),
  filePath: z.string().min(1).max(500),
  fileSizeBytes: z.number().nonnegative(),
  fileMime: z.string().min(1).max(120),
  notes: z.string().trim().max(2000).optional().nullable(),
})

const decisionSchema = z.object({
  shopDrawingId: uuid,
  decision: z.enum(['approved', 'revise_and_resubmit', 'rejected']),
  comments: z.string().trim().max(4000).optional().nullable(),
})

export type UploadShopDrawingInput = z.infer<typeof uploadSchema>
export type DecideShopDrawingInput = z.infer<typeof decisionSchema>

export async function uploadShopDrawingAction(
  input: UploadShopDrawingInput,
): Promise<{ id?: string; revision?: number; error?: string }> {
  const parsed = uploadSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: item, error: itemErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('id, organisation_id, project_id, description')
    .eq('id', parsed.data.procurementItemId)
    .single()
  if (itemErr || !item) return { error: 'Procurement item not found' }
  const pi = item as { id: string; organisation_id: string; project_id: string; description: string }

  // Resolve the next revision number — MAX existing + 1.
  const { data: latest } = await (supabase as any)
    .schema('projects')
    .from('shop_drawings')
    .select('revision')
    .eq('procurement_item_id', pi.id)
    .order('revision', { ascending: false })
    .limit(1)
  const nextRevision = ((latest?.[0] as { revision?: number } | undefined)?.revision ?? 0) + 1

  const i = parsed.data
  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('shop_drawings')
    .insert({
      project_id: pi.project_id,
      organisation_id: pi.organisation_id,
      procurement_item_id: pi.id,
      title: i.title,
      revision: nextRevision,
      file_path: i.filePath,
      file_size_bytes: i.fileSizeBytes,
      file_mime: i.fileMime,
      notes: i.notes ?? null,
      status: 'pending_review',
      submitted_by: user.id,
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Failed to record drawing' }

  // Notify project members that a review is needed.
  const { data: members } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', pi.project_id)
    .eq('is_active', true)
  const recipients = ((members ?? []) as Array<{ user_id: string }>)
    .map((m) => m.user_id)
    .filter((id) => id !== user.id)
  await dispatchNotification({
    userIds: recipients,
    title: 'Shop drawing submitted',
    body: `${pi.description} — rev ${nextRevision} awaiting review`,
    route: `/projects/${pi.project_id}/materials`,
    type: 'shop_drawing_submitted',
    entityType: 'shop_drawing',
    entityId: (row as { id: string }).id,
  })

  revalidatePath(`/projects/${pi.project_id}/materials`)
  return { id: (row as { id: string }).id, revision: nextRevision }
}

export async function decideShopDrawingAction(
  input: DecideShopDrawingInput,
): Promise<{ ok?: true; error?: string }> {
  const parsed = decisionSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Record the decision row.
  const { error: appErr } = await (supabase as any)
    .schema('projects')
    .from('shop_drawing_approvals')
    .insert({
      shop_drawing_id: parsed.data.shopDrawingId,
      approver_user_id: user.id,
      decision: parsed.data.decision,
      comments: parsed.data.comments ?? null,
    })
  if (appErr) return { error: appErr.message }

  // Update the drawing's status to mirror the most recent decision.
  const { data: drawing, error: updErr } = await (supabase as any)
    .schema('projects')
    .from('shop_drawings')
    .update({ status: parsed.data.decision })
    .eq('id', parsed.data.shopDrawingId)
    .select('procurement_item_id, title, revision, submitted_by, project_id')
    .single()
  if (updErr || !drawing) return { error: updErr?.message ?? 'Drawing missing' }
  const d = drawing as {
    procurement_item_id: string
    title: string
    revision: number
    submitted_by: string | null
    project_id: string
  }

  // Notify the submitter + the rest of the project members about the outcome.
  const { data: members } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', d.project_id)
    .eq('is_active', true)
  const recipients = ((members ?? []) as Array<{ user_id: string }>)
    .map((m) => m.user_id)
    .concat(d.submitted_by ? [d.submitted_by] : [])
    .filter((id) => id !== user.id)
  const verb =
    parsed.data.decision === 'approved' ? 'approved'
    : parsed.data.decision === 'revise_and_resubmit' ? 'returned for revision'
    : 'rejected'
  await dispatchNotification({
    userIds: recipients,
    title: `Shop drawing ${verb}`,
    body: `${d.title} (rev ${d.revision})`,
    route: `/projects/${d.project_id}/materials`,
    type: 'shop_drawing_decided',
    entityType: 'shop_drawing',
    entityId: parsed.data.shopDrawingId,
  })

  revalidatePath(`/projects/${d.project_id}/materials`)
  return { ok: true }
}

export async function deleteShopDrawingAction(
  id: string,
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: drawing } = await (supabase as any)
    .schema('projects')
    .from('shop_drawings')
    .select('id, procurement_item_id, project_id, file_path')
    .eq('id', id)
    .single()
  const d = drawing as {
    id?: string
    procurement_item_id?: string
    project_id?: string
    file_path?: string | null
  } | null

  const { error } = await (supabase as any)
    .schema('projects')
    .from('shop_drawings')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }

  if (d?.file_path) {
    await supabase.storage.from('shop-drawings').remove([d.file_path]).catch(() => {})
  }
  if (d?.project_id) {
    revalidatePath(`/projects/${d.project_id}/materials`)
  }
  return { ok: true }
}
