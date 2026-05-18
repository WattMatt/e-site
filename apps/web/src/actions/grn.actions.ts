'use server'

/**
 * Goods Received Note (GRN) — server actions.
 *
 * One GRN per delivery event. Procurement_items can accumulate multiple
 * GRNs (partial deliveries). When SUM(quantity_received) >= procurement
 * quantity, the parent procurement_item.status flips to 'fulfilled'.
 *
 * Photos + signed PODs live in the `grn-photos` bucket. Uploads happen
 * client-side (RLS-gated by org prefix); this module records the row +
 * computes the rollup.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

const uuid = z.string().uuid()

const recordSchema = z.object({
  procurementItemId: uuid,
  deliveredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  quantityReceived: z.number().nonnegative(),
  condition: z.enum(['complete', 'partial', 'damaged']).default('complete'),
  notes: z.string().trim().max(4000).optional().nullable(),
  photoPaths: z.array(z.string().min(1).max(500)).default([]),
  signedPodPath: z.string().min(1).max(500).optional().nullable(),
})

export type RecordGRNInput = z.infer<typeof recordSchema>

export async function recordGRNAction(
  input: RecordGRNInput,
): Promise<{ id?: string; itemFulfilled?: boolean; error?: string }> {
  const parsed = recordSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: item, error: itemErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('id, organisation_id, project_id, description, quantity, status')
    .eq('id', parsed.data.procurementItemId)
    .single()
  if (itemErr || !item) return { error: 'Procurement item not found' }
  const pi = item as {
    id: string
    organisation_id: string
    project_id: string
    description: string
    quantity: number | null
    status: string
  }

  const i = parsed.data
  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('goods_received_notes')
    .insert({
      procurement_item_id: pi.id,
      project_id: pi.project_id,
      organisation_id: pi.organisation_id,
      delivered_at: i.deliveredAt,
      quantity_received: i.quantityReceived,
      condition: i.condition,
      notes: i.notes ?? null,
      photo_paths: i.photoPaths,
      signed_pod_path: i.signedPodPath ?? null,
      received_by: user.id,
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Failed to record GRN' }

  // Roll up — sum all GRNs for this procurement_item, compare to ordered qty.
  const { data: allGRNs } = await (supabase as any)
    .schema('projects')
    .from('goods_received_notes')
    .select('quantity_received')
    .eq('procurement_item_id', pi.id)
  const totalReceived = ((allGRNs ?? []) as Array<{ quantity_received: number }>)
    .reduce((s, g) => s + Number(g.quantity_received ?? 0), 0)

  let fulfilled = false
  if (
    pi.quantity != null
    && totalReceived >= Number(pi.quantity)
    && pi.status !== 'fulfilled'
    && pi.status !== 'cancelled'
  ) {
    await (supabase as any)
      .schema('projects')
      .from('procurement_items')
      .update({ status: 'fulfilled', delivery_date: i.deliveredAt })
      .eq('id', pi.id)
    fulfilled = true
  }

  // Notify project members of the delivery.
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
    title: fulfilled ? 'Delivery received — order fulfilled' : 'Delivery received',
    body: `${pi.description} — ${i.quantityReceived} received (${i.condition})`,
    route: `/projects/${pi.project_id}/materials`,
    type: 'grn_recorded',
    entityType: 'procurement_item',
    entityId: pi.id,
  })

  revalidatePath(`/projects/${pi.project_id}/materials`)
  return { id: (row as { id: string }).id, itemFulfilled: fulfilled }
}

export async function deleteGRNAction(
  id: string,
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: grn } = await (supabase as any)
    .schema('projects')
    .from('goods_received_notes')
    .select('id, procurement_item_id, photo_paths, signed_pod_path')
    .eq('id', id)
    .single()
  const g = grn as {
    id?: string
    procurement_item_id?: string
    photo_paths?: string[] | null
    signed_pod_path?: string | null
  } | null

  const { error } = await (supabase as any)
    .schema('projects')
    .from('goods_received_notes')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }

  // Best-effort bucket cleanup
  const toRemove: string[] = [
    ...(g?.photo_paths ?? []),
    ...(g?.signed_pod_path ? [g.signed_pod_path] : []),
  ]
  if (toRemove.length > 0) {
    await supabase.storage.from('grn-photos').remove(toRemove).catch(() => {})
  }

  // Recompute parent status — if removed GRN unlinks fulfilment, roll back
  // to 'approved' (the prior canonical pre-delivery state).
  if (g?.procurement_item_id) {
    const { data: item } = await (supabase as any)
      .schema('projects')
      .from('procurement_items')
      .select('id, project_id, quantity, status')
      .eq('id', g.procurement_item_id)
      .single()
    const pi = item as { project_id: string; quantity: number | null; status: string } | null
    if (pi?.status === 'fulfilled' && pi.quantity != null) {
      const { data: rest } = await (supabase as any)
        .schema('projects')
        .from('goods_received_notes')
        .select('quantity_received')
        .eq('procurement_item_id', g.procurement_item_id)
      const total = ((rest ?? []) as Array<{ quantity_received: number }>)
        .reduce((s, r) => s + Number(r.quantity_received ?? 0), 0)
      if (total < Number(pi.quantity)) {
        await (supabase as any)
          .schema('projects')
          .from('procurement_items')
          .update({ status: 'approved' })
          .eq('id', g.procurement_item_id)
      }
    }
    if (pi?.project_id) {
      revalidatePath(`/projects/${pi.project_id}/materials`)
    }
  }
  return { ok: true }
}
