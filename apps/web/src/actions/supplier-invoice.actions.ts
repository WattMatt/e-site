'use server'

/**
 * Supplier invoice — server actions.
 *
 * Closes the procurement loop from GRN to "supplier paid". The contractor's
 * accounts team records the supplier's invoice once received, approves it
 * against the GRN'd quantity / quoted price, and finally marks it paid when
 * payment leaves the bank.
 *
 * Files reuse the `quotes` bucket (RLS already org-prefix-gated; same MIME
 * allowlist works for invoice scans / PDFs). Saves a 4th identical bucket.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

const uuid = z.string().uuid()

const recordSchema = z.object({
  procurementItemId: uuid,
  invoiceNumber: z.string().trim().min(1).max(100),
  supplierInvoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  amount: z.number().nonnegative(),
  vatAmount: z.number().nonnegative().optional().nullable(),
  currency: z.string().length(3).default('ZAR'),
  notes: z.string().trim().max(2000).optional().nullable(),
  filePath: z.string().min(1).max(500).optional().nullable(),
  fileSizeBytes: z.number().nonnegative().optional().nullable(),
  fileMime: z.string().min(1).max(120).optional().nullable(),
})

const markPaidSchema = z.object({
  id: uuid,
  paymentReference: z.string().trim().max(100).optional().nullable(),
})

const statusSchema = z.object({
  id: uuid,
  status: z.enum(['received', 'approved', 'paid', 'disputed']),
})

export async function recordSupplierInvoiceAction(
  input: z.infer<typeof recordSchema>,
): Promise<{ id?: string; error?: string }> {
  const parsed = recordSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: item, error: itemErr } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('id, organisation_id, project_id, description, quoted_price, quantity')
    .eq('id', parsed.data.procurementItemId)
    .single()
  if (itemErr || !item) return { error: 'Procurement item not found' }
  const pi = item as {
    id: string
    organisation_id: string
    project_id: string
    description: string
    quoted_price: number | null
    quantity: number | null
  }

  const i = parsed.data
  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('supplier_invoices')
    .insert({
      procurement_item_id: pi.id,
      organisation_id: pi.organisation_id,
      invoice_number: i.invoiceNumber,
      supplier_invoice_date: i.supplierInvoiceDate,
      amount: i.amount,
      vat_amount: i.vatAmount ?? null,
      currency: i.currency,
      notes: i.notes ?? null,
      file_path: i.filePath ?? null,
      file_size_bytes: i.fileSizeBytes ?? null,
      file_mime: i.fileMime ?? null,
      received_by: user.id,
      status: 'received',
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Failed to record invoice' }

  // Notify project members — AP / PM may need to approve.
  const { data: members } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', pi.project_id)
    .eq('is_active', true)
  const recipients = ((members ?? []) as Array<{ user_id: string }>)
    .map((m) => m.user_id)
    .filter((id) => id !== user.id)
  // Variance flag: invoice amount diverging materially from quoted_price *
  // quantity. Surfaces in the notification body so reviewers spot it.
  const expected = pi.quoted_price != null && pi.quantity != null
    ? Number(pi.quoted_price) * Number(pi.quantity)
    : null
  const variance = expected != null
    ? Math.abs(i.amount - expected) / Math.max(expected, 1)
    : 0
  const varianceTag = variance > 0.05 ? ' ⚠ variance >5%' : ''
  await dispatchNotification({
    userIds: recipients,
    title: 'Supplier invoice received',
    body: `${pi.description} — R${i.amount}${varianceTag}`,
    route: `/procurement/${pi.id}`,
    type: 'supplier_invoice_received',
    entityType: 'supplier_invoice',
    entityId: (row as { id: string }).id,
  })

  revalidatePath(`/procurement/${pi.id}`)
  return { id: (row as { id: string }).id }
}

export async function updateSupplierInvoiceStatusAction(
  input: z.infer<typeof statusSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = statusSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // 'paid' is the only status that should populate paid_at automatically;
  // other status changes leave the timestamp alone so it acts as a record
  // of when payment was actually committed.
  const patch: Record<string, unknown> = { status: parsed.data.status }
  if (parsed.data.status === 'paid') patch.paid_at = new Date().toISOString()

  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('supplier_invoices')
    .update(patch)
    .eq('id', parsed.data.id)
    .select('procurement_item_id')
    .single()
  if (error) return { error: error.message }
  const pid = (row as { procurement_item_id?: string } | null)?.procurement_item_id
  if (pid) revalidatePath(`/procurement/${pid}`)
  return { ok: true }
}

export async function markSupplierInvoicePaidAction(
  input: z.infer<typeof markPaidSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = markPaidSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: row, error } = await (supabase as any)
    .schema('projects')
    .from('supplier_invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_reference: parsed.data.paymentReference ?? null,
    })
    .eq('id', parsed.data.id)
    .select('procurement_item_id, invoice_number')
    .single()
  if (error || !row) return { error: error?.message ?? 'Failed to mark paid' }
  const r = row as { procurement_item_id: string; invoice_number: string }
  revalidatePath(`/procurement/${r.procurement_item_id}`)
  return { ok: true }
}

export async function deleteSupplierInvoiceAction(
  id: string,
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: existing } = await (supabase as any)
    .schema('projects')
    .from('supplier_invoices')
    .select('id, procurement_item_id, file_path')
    .eq('id', id)
    .single()

  const { error } = await (supabase as any)
    .schema('projects')
    .from('supplier_invoices')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }

  const e = existing as { procurement_item_id?: string; file_path?: string | null } | null
  if (e?.file_path) {
    await supabase.storage.from('quotes').remove([e.file_path]).catch(() => {})
  }
  if (e?.procurement_item_id) {
    revalidatePath(`/procurement/${e.procurement_item_id}`)
  }
  return { ok: true }
}
