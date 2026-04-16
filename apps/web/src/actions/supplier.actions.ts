'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'

const SA_PROVINCES = [
  'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape',
  'Limpopo', 'Mpumalanga', 'North West', 'Free State', 'Northern Cape',
]

export async function registerSupplierAction(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()

  const email = (formData.get('email') as string)?.trim()
  const password = formData.get('password') as string
  const companyName = (formData.get('company_name') as string)?.trim()
  const tradingName = (formData.get('trading_name') as string | null)?.trim() || undefined
  const registrationNo = (formData.get('registration_no') as string | null)?.trim() || undefined
  const vatNumber = (formData.get('vat_number') as string | null)?.trim() || undefined
  const province = formData.get('province') as string
  const address = (formData.get('address') as string | null)?.trim() || undefined
  const categoriesRaw = formData.getAll('categories') as string[]
  const popiaConsent = formData.get('popia_consent') === 'on'

  if (!email || !password || !companyName) {
    return { error: 'Email, password and company name are required.' }
  }
  if (!popiaConsent) {
    return { error: 'POPIA consent is required to register.' }
  }
  if (categoriesRaw.length === 0) {
    return { error: 'Select at least one category.' }
  }

  // Sign up in Supabase Auth
  const { data: authData, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        popia_consent_at: new Date().toISOString(),
        role: 'supplier',
      },
    },
  })

  if (signUpErr || !authData.user) {
    return { error: signUpErr?.message ?? 'Sign-up failed' }
  }

  // Create an organisation for the supplier
  const { data: org, error: orgErr } = await supabase
    .from('organisations')
    .insert({
      name: companyName,
      industry: 'construction',
    })
    .select('id')
    .single()

  if (orgErr || !org) {
    return { error: orgErr?.message ?? 'Failed to create organisation' }
  }

  // Link user to org as owner
  await supabase.from('user_organisations').insert({
    user_id: authData.user.id,
    organisation_id: org.id,
    role: 'owner',
    is_active: true,
  })

  // Create supplier profile (marketplace_visible OFF by default)
  const { data: supplierRecord, error: supplierErr } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .insert({
      organisation_id: org.id,
      name: companyName,
      trading_name: tradingName,
      registration_no: registrationNo,
      vat_number: vatNumber,
      province,
      address,
      categories: categoriesRaw,
      is_verified: false,
      is_active: true,
    })
    .select('id')
    .single()

  if (supplierErr) {
    return { error: supplierErr.message }
  }

  revalidatePath('/supplier/profile')
  redirect('/supplier/profile?registered=1')
}

export async function updateSupplierProfileAction(
  supplierId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  const tradingName = (formData.get('trading_name') as string | null)?.trim() || null
  const registrationNo = (formData.get('registration_no') as string | null)?.trim() || null
  const vatNumber = (formData.get('vat_number') as string | null)?.trim() || null
  const province = (formData.get('province') as string | null)?.trim() || null
  const address = (formData.get('address') as string | null)?.trim() || null
  const website = (formData.get('website') as string | null)?.trim() || null
  const categoriesRaw = formData.getAll('categories') as string[]

  if (!name) return { error: 'Company name is required.' }

  const { error } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .update({
      name,
      trading_name: tradingName,
      registration_no: registrationNo,
      vat_number: vatNumber,
      province,
      address,
      website,
      categories: categoriesRaw,
    })
    .eq('id', supplierId)

  if (error) return { error: error.message }

  revalidatePath('/supplier/profile')
  return {}
}

export async function createCatalogueItemAction(formData: FormData): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Find supplier linked to this user's org
  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!mem) return { error: 'No organisation found' }

  const { data: supplier } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .select('id')
    .eq('organisation_id', mem.organisation_id)
    .limit(1)
    .single()
  if (!supplier) return { error: 'No supplier profile found. Complete your profile first.' }

  const name = (formData.get('name') as string)?.trim()
  const sku = (formData.get('sku') as string | null)?.trim() || null
  const description = (formData.get('description') as string | null)?.trim() || null
  const category = formData.get('category') as string
  const unit = (formData.get('unit') as string)?.trim() || 'each'
  const unitPrice = parseFloat(formData.get('unit_price') as string)
  const minOrderQty = parseInt(formData.get('min_order_qty') as string, 10) || 1
  const leadTimeDays = formData.get('lead_time_days') ? parseInt(formData.get('lead_time_days') as string, 10) : null
  const marketplaceVisible = formData.get('marketplace_visible') === 'on'

  if (!name || !category || isNaN(unitPrice)) {
    return { error: 'Name, category and unit price are required.' }
  }

  const { data, error } = await supabase
    .schema('marketplace')
    .from('catalogue_items')
    .insert({
      supplier_id: supplier.id,
      supplier_org_id: mem.organisation_id,
      name,
      sku,
      description,
      category,
      unit,
      unit_price: unitPrice,
      min_order_qty: minOrderQty,
      lead_time_days: leadTimeDays,
      marketplace_visible: marketplaceVisible,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/supplier/catalogue')
  return { id: data.id }
}

export async function updateCatalogueItemAction(
  itemId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const name = (formData.get('name') as string)?.trim()
  const sku = (formData.get('sku') as string | null)?.trim() || null
  const description = (formData.get('description') as string | null)?.trim() || null
  const category = formData.get('category') as string
  const unit = (formData.get('unit') as string)?.trim() || 'each'
  const unitPrice = parseFloat(formData.get('unit_price') as string)
  const minOrderQty = parseInt(formData.get('min_order_qty') as string, 10) || 1
  const leadTimeDays = formData.get('lead_time_days') ? parseInt(formData.get('lead_time_days') as string, 10) : null
  const marketplaceVisible = formData.get('marketplace_visible') === 'on'

  if (!name || !category || isNaN(unitPrice)) {
    return { error: 'Name, category and unit price are required.' }
  }

  const { error } = await supabase
    .schema('marketplace')
    .from('catalogue_items')
    .update({
      name, sku, description, category, unit,
      unit_price: unitPrice,
      min_order_qty: minOrderQty,
      lead_time_days: leadTimeDays,
      marketplace_visible: marketplaceVisible,
    })
    .eq('id', itemId)

  if (error) return { error: error.message }

  revalidatePath('/supplier/catalogue')
  return {}
}

export async function toggleCatalogueVisibilityAction(
  itemId: string,
  visible: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema('marketplace')
    .from('catalogue_items')
    .update({ marketplace_visible: visible })
    .eq('id', itemId)

  if (error) return { error: error.message }

  revalidatePath('/supplier/catalogue')
  return {}
}

export async function updateOrderStatusAction(
  orderId: string,
  status: string,
  extras?: { notes?: string; quotedAmount?: number },
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const updates: Record<string, unknown> & any = { status }
  if (extras?.notes !== undefined) updates.notes = extras.notes
  if (extras?.quotedAmount !== undefined) updates.total_amount = extras.quotedAmount

  const { error } = await supabase
    .schema('marketplace')
    .from('orders')
    .update(updates)
    .eq('id', orderId)

  if (error) return { error: error.message }

  // Notify contractor (best-effort)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      const { data: order } = await supabase
        .schema('marketplace')
        .from('orders')
        .select('created_by')
        .eq('id', orderId)
        .single()

      if (order?.created_by && order.created_by !== user.id) {
        const STATUS_LABELS: Record<string, string> = {
          confirmed: 'Confirmed', in_transit: 'In Transit', delivered: 'Delivered',
          cancelled: 'Cancelled', submitted: 'Submitted',
        }
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            userIds: [order.created_by],
            title: 'Order updated',
            body: `Order status: ${STATUS_LABELS[status] ?? status}`,
            data: { route: `/marketplace/orders/${orderId}` },
          }),
        }).catch(() => {/* non-blocking */})
      }
    }
  } catch {/* non-blocking */}

  revalidatePath('/supplier/orders')
  revalidatePath(`/supplier/orders/${orderId}`)
  return {}
}

export async function placeOrderAction(formData: FormData): Promise<{ error?: string; orderId?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!mem) return { error: 'No organisation found' }

  const supplierId = formData.get('supplier_id') as string
  const supplierOrgId = (formData.get('supplier_org_id') as string | null) || null
  const projectId = (formData.get('project_id') as string | null) || null
  const notes = (formData.get('notes') as string | null)?.trim() || null
  const requiredBy = (formData.get('required_by') as string | null) || null
  const deliveryAddress = (formData.get('delivery_address') as string | null)?.trim() || null

  const itemIdsRaw = formData.getAll('item_id') as string[]
  const itemQtysRaw = formData.getAll('item_qty') as string[]
  const itemPricesRaw = formData.getAll('item_price') as string[]

  if (!supplierId || itemIdsRaw.length === 0) {
    return { error: 'Supplier and at least one item are required.' }
  }

  // Create order
  const { data: order, error: orderErr } = await supabase
    .schema('marketplace')
    .from('orders')
    .insert({
      contractor_org_id: mem.organisation_id,
      supplier_org_id: supplierOrgId,
      supplier_id: supplierId,
      project_id: projectId,
      created_by: user.id,
      notes: [notes, deliveryAddress ? `Delivery: ${deliveryAddress}` : null, requiredBy ? `Required by: ${requiredBy}` : null]
        .filter(Boolean).join('\n') || null,
      status: 'submitted',
    })
    .select('id')
    .single()

  if (orderErr) return { error: orderErr.message }

  const items = itemIdsRaw.map((id, i) => ({
    order_id: order.id,
    catalogue_item_id: id || null,
    description: '',
    quantity: parseFloat(itemQtysRaw[i] ?? '1'),
    unit_price: parseFloat(itemPricesRaw[i] ?? '0'),
  }))

  const { error: itemsErr } = await supabase
    .schema('marketplace')
    .from('order_items')
    .insert(items)

  if (itemsErr) return { error: itemsErr.message }

  // Funnel: first marketplace order is a key activation milestone
  const totalAmount = items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0)
  await trackServer(user.id, ANALYTICS_EVENTS.ORDER_PLACED, {
    order_id: order.id,
    supplier_id: supplierId,
    contractor_org_id: mem.organisation_id,
    item_count: items.length,
    total_amount_zar: totalAmount,
    project_id: projectId,
  })

  // Notify supplier (best-effort)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey && supplierOrgId) {
      const { data: supplierUsers } = await supabase
        .from('user_organisations')
        .select('user_id')
        .eq('organisation_id', supplierOrgId)
        .eq('is_active', true)

      const userIds = (supplierUsers ?? []).map((u) => u.user_id).filter((id) => id !== user.id)
      if (userIds.length > 0) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            userIds,
            title: 'New order received',
            body: `A new order has been submitted and awaits your response.`,
            data: { route: `/supplier/orders/${order.id}` },
          }),
        }).catch(() => {/* non-blocking */})
      }
    }
  } catch {/* non-blocking */}

  revalidatePath('/marketplace')
  redirect(`/marketplace/orders/${order.id}`)
}
