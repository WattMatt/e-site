'use server'

/**
 * Procurement quote — server actions.
 *
 * Multi-quote workflow: a procurement_item can collect N quotes
 * (procurement_quotes rows) before one is picked as the winner. The file
 * itself lives in the `quotes` storage bucket (50 MB cap, PDF + images +
 * XLSX). Upload happens client-side via createBrowserClient — bucket RLS
 * gates by `(storage.foldername(name))[1]::uuid IN public.get_user_org_ids()`
 * — and this module records the metadata row.
 *
 * `selectQuoteAction` does the heavy lifting:
 *   1. Flips `is_selected` from any previously-selected quote on the item
 *      to FALSE (the partial unique index would otherwise reject the new
 *      selection).
 *   2. Marks the chosen quote `is_selected = TRUE`.
 *   3. Updates `procurement_items.selected_quote_id`, `.quoted_price`,
 *      `.supplier_id` (if the quote has one), and flips `.status` to
 *      `quoted` if it's still earlier in the lifecycle.
 *
 * RLS gates the writes (migration 00046). Org members write, client viewers
 * read-only.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import { dispatchNotification } from '@/lib/notifications'

const uuid = z.string().uuid()

const recordQuoteSchema = z.object({
  procurementItemId: uuid,
  supplierId: uuid.optional().nullable(),
  supplierName: z.string().trim().max(200).optional().nullable(),
  quoteReference: z.string().trim().max(100).optional().nullable(),
  quotedPrice: z.number().nonnegative('Quoted price must be ≥ 0'),
  currency: z.string().length(3).default('ZAR'),
  validUntil: z.string().optional().nullable(),     // YYYY-MM-DD
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  filePath: z.string().min(1).max(500),
  fileSizeBytes: z.number().nonnegative(),
  fileMime: z.string().min(1).max(120),
})

const selectSchema = z.object({
  procurementItemId: uuid,
  quoteId: uuid,
})

export type RecordQuoteInput = z.infer<typeof recordQuoteSchema>

/**
 * Record an uploaded quote. Caller has ALREADY uploaded the file to the
 * `quotes` storage bucket via the browser supabase client; this action
 * just inserts the metadata row keyed to that path.
 */
export async function recordQuoteAction(
  input: RecordQuoteInput,
): Promise<{ id?: string; error?: string }> {
  const parsed = recordQuoteSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve organisation_id from the parent procurement_item so the row's
  // RLS check passes regardless of which org the caller's JWT routes to.
  const { data: item, error: itemErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('id, organisation_id, project_id, status')
    .eq('id', parsed.data.procurementItemId)
    .single()
  if (itemErr || !item) return { error: 'Procurement item not found' }

  const i = parsed.data
  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('procurement_quotes')
    .insert({
      procurement_item_id: i.procurementItemId,
      organisation_id: (item as { organisation_id: string }).organisation_id,
      supplier_id: i.supplierId ?? null,
      supplier_name: i.supplierName ?? null,
      quote_reference: i.quoteReference ?? null,
      quoted_price: i.quotedPrice,
      currency: i.currency,
      valid_until: i.validUntil || null,
      lead_time_days: i.leadTimeDays ?? null,
      notes: i.notes ?? null,
      file_path: i.filePath,
      file_size_bytes: i.fileSizeBytes,
      file_mime: i.fileMime,
      uploaded_by: user.id,
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Failed to record quote' }

  await trackServer(user.id, ANALYTICS_EVENTS.QUOTE_UPLOADED, {
    procurement_item_id: i.procurementItemId,
    has_file: !!i.filePath,
    supplier_id: i.supplierId ?? null,
  }).catch(() => {})

  revalidatePath(`/procurement/${i.procurementItemId}`)
  return { id: (row as { id: string }).id }
}

/**
 * Mark a quote as the selected winner. Flips procurement_items into
 * `status = quoted` if it's still in draft/sent.
 */
export async function selectQuoteAction(
  input: z.infer<typeof selectSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = selectSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { procurementItemId, quoteId } = parsed.data

  // Step 1: clear any previous winner on this item (the partial unique
  // index would otherwise reject an insert/update with a second TRUE).
  const { error: clearErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_quotes')
    .update({ is_selected: false })
    .eq('procurement_item_id', procurementItemId)
    .eq('is_selected', true)
    .neq('id', quoteId)
  if (clearErr) return { error: `Failed to clear previous: ${clearErr.message}` }

  // Step 2: mark the chosen quote as the winner.
  const { data: chosen, error: pickErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_quotes')
    .update({ is_selected: true })
    .eq('id', quoteId)
    .eq('procurement_item_id', procurementItemId)
    .select('id, quoted_price, currency, supplier_id')
    .single()
  if (pickErr || !chosen) {
    return { error: pickErr?.message ?? 'Quote not found' }
  }
  const c = chosen as {
    id: string
    quoted_price: number
    currency: string
    supplier_id: string | null
  }

  // Step 3: roll the winner's price + supplier onto the parent item and
  // bump status if it's still pre-quoted.
  const { data: item, error: itemReadErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('status, supplier_id')
    .eq('id', procurementItemId)
    .single()
  if (itemReadErr || !item) return { error: 'Procurement item missing' }
  const current = item as { status: string; supplier_id: string | null }

  const nextStatus =
    current.status === 'draft' || current.status === 'sent'
      ? 'quoted'
      : current.status

  const patch: Record<string, unknown> = {
    selected_quote_id: c.id,
    quoted_price: c.quoted_price,
    currency: c.currency,
    status: nextStatus,
  }
  // Only set supplier_id if the item doesn't have one yet AND the chosen
  // quote has one — don't accidentally overwrite a manual selection.
  if (c.supplier_id && !current.supplier_id) {
    patch.supplier_id = c.supplier_id
  }

  const { error: itemErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .update(patch)
    .eq('id', procurementItemId)
  if (itemErr) return { error: itemErr.message }

  await trackServer(user.id, ANALYTICS_EVENTS.QUOTE_SELECTED, {
    procurement_item_id: procurementItemId,
    quote_id: c.id,
    quoted_price: c.quoted_price,
  }).catch(() => {})

  // Notify project members. We resolve them via projects.project_members
  // for the item's project and dispatch a single batched notification.
  const { data: pi } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('project_id, description, organisation_id')
    .eq('id', procurementItemId)
    .single()
  const pj = pi as { project_id?: string; description?: string; organisation_id?: string } | null
  if (pj?.project_id) {
    const { data: members } = await (supabase as any)
      .schema('projects')
      .from('project_members')
      .select('user_id')
      .eq('project_id', pj.project_id)
      .eq('is_active', true)
    const recipients = ((members ?? []) as Array<{ user_id: string }>)
      .map((m) => m.user_id)
      .filter((id) => id !== user.id)
    await dispatchNotification({
      userIds: recipients,
      title: 'Procurement quote selected',
      body: `${pj.description ?? 'Procurement item'} — winner picked at R${c.quoted_price}`,
      route: `/procurement/${procurementItemId}`,
      type: 'procurement_quote_selected',
      entityType: 'procurement_item',
      entityId: procurementItemId,
    })
  }

  revalidatePath(`/procurement/${procurementItemId}`)
  return { ok: true }
}

/**
 * Delete a quote (metadata + bucket object). The bucket-object delete is
 * best-effort — failure leaves an orphan blob that can be cleaned up
 * lazily; we don't want a bucket transient to block the DB-side delete
 * (which is what the user actually sees).
 */
export async function deleteQuoteAction(
  quoteId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(quoteId).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: quote } = await (supabase as any)
    .schema('projects')
    .from('procurement_quotes')
    .select('id, procurement_item_id, file_path, is_selected')
    .eq('id', quoteId)
    .single()

  const file_path = (quote as { file_path?: string | null } | null)?.file_path
  const procurement_item_id = (quote as { procurement_item_id?: string } | null)?.procurement_item_id

  // If we're deleting the selected quote, clear the item's pointer first
  // to avoid a dangling FK after the row is gone (FK has ON DELETE SET NULL
  // but better to be explicit about the side effect on status).
  if ((quote as { is_selected?: boolean } | null)?.is_selected && procurement_item_id) {
    await (supabase as any)
      .schema('projects')
      .from('procurement_items')
      .update({ selected_quote_id: null, quoted_price: null })
      .eq('id', procurement_item_id)
  }

  const { error } = await (supabase as any)
    .schema('projects')
    .from('procurement_quotes')
    .delete()
    .eq('id', quoteId)
  if (error) return { error: error.message }

  if (file_path) {
    await supabase.storage.from('quotes').remove([file_path])
      .catch(() => {})  // best-effort
  }

  if (procurement_item_id) {
    revalidatePath(`/procurement/${procurement_item_id}`)
  }
  return { ok: true }
}
