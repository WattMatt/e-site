'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import { z } from 'zod'

const SA_PROVINCES = [
  'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape',
  'Limpopo', 'Mpumalanga', 'North West', 'Free State', 'Northern Cape',
] as const

const registerSupplierSchema = z.object({
  email:           z.string().email('Valid email required.'),
  password:        z.string().min(8, 'Password must be at least 8 characters.'),
  company_name:    z.string().min(1, 'Company name is required.').max(200),
  trading_name:    z.string().max(200).optional(),
  registration_no: z.string().max(50).optional(),
  vat_number:      z.string().max(20).optional(),
  province:        z.enum(SA_PROVINCES, { message: 'Please select a province.' }),
  address:         z.string().max(500).optional(),
  categories:      z.array(z.string()).min(1, 'Select at least one category.'),
  popia_consent:   z.literal('on', { errorMap: () => ({ message: 'POPIA consent is required to register.' }) }),
})

const updateProfileSchema = z.object({
  name:            z.string().min(1, 'Company name is required.').max(200),
  trading_name:    z.string().max(200).nullish(),
  registration_no: z.string().max(50).nullish(),
  vat_number:      z.string().max(20).nullish(),
  province:        z.string().max(100).nullish(),
  address:         z.string().max(500).nullish(),
  website:         z.string().url('Valid URL required.').max(500).nullish().or(z.literal('')),
  categories:      z.array(z.string()),
})

const catalogueItemSchema = z.object({
  name:                z.string().min(1, 'Name is required.').max(200),
  sku:                 z.string().max(50).nullish(),
  description:         z.string().max(1000).nullish(),
  category:            z.string().min(1, 'Category is required.').max(100),
  unit:                z.string().max(50).default('each'),
  unit_price:          z.preprocess(val => parseFloat(val as string), z.number().positive('Unit price must be positive.')),
  min_order_qty:       z.preprocess(val => parseInt(val as string, 10) || 1, z.number().int().min(1)),
  lead_time_days:      z.preprocess(val => (val && val !== '' ? parseInt(val as string, 10) : null), z.number().int().nullable()),
  marketplace_visible: z.preprocess(val => val === 'on', z.boolean()),
})

const placeOrderScalarSchema = z.object({
  supplier_id:      z.string().uuid('Invalid supplier.'),
  supplier_org_id:  z.string().uuid().nullish(),
  project_id:       z.string().uuid().nullish(),
  notes:            z.string().max(2000).optional(),
  required_by:      z.string().optional(),
  delivery_address: z.string().max(500).optional(),
})

export async function registerSupplierAction(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()

  const parsed = registerSupplierSchema.safeParse({
    email:           formData.get('email'),
    password:        formData.get('password'),
    company_name:    formData.get('company_name'),
    trading_name:    formData.get('trading_name') ?? undefined,
    registration_no: formData.get('registration_no') ?? undefined,
    vat_number:      formData.get('vat_number') ?? undefined,
    province:        formData.get('province'),
    address:         formData.get('address') ?? undefined,
    categories:      formData.getAll('categories'),
    popia_consent:   formData.get('popia_consent'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const {
    email, password, company_name: companyName,
    trading_name: tradingName, registration_no: registrationNo,
    vat_number: vatNumber, province, address, categories: categoriesRaw,
  } = parsed.data

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
      type: 'supplier',
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

  const parsed = updateProfileSchema.safeParse({
    name:            formData.get('name'),
    trading_name:    formData.get('trading_name') || null,
    registration_no: formData.get('registration_no') || null,
    vat_number:      formData.get('vat_number') || null,
    province:        formData.get('province') || null,
    address:         formData.get('address') || null,
    website:         formData.get('website') || null,
    categories:      formData.getAll('categories'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { name, trading_name, registration_no, vat_number, province, address, website, categories } = parsed.data

  const { error } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .update({
      name,
      trading_name:    trading_name ?? null,
      registration_no: registration_no ?? null,
      vat_number:      vat_number ?? null,
      province:        province ?? null,
      address:         address ?? null,
      website:         website || null,
      categories,
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

  const itemParsed = catalogueItemSchema.safeParse({
    name:                formData.get('name'),
    sku:                 formData.get('sku') || null,
    description:         formData.get('description') || null,
    category:            formData.get('category'),
    unit:                formData.get('unit'),
    unit_price:          formData.get('unit_price'),
    min_order_qty:       formData.get('min_order_qty'),
    lead_time_days:      formData.get('lead_time_days'),
    marketplace_visible: formData.get('marketplace_visible'),
  })
  if (!itemParsed.success) {
    return { error: itemParsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { name, sku, description, category, unit, unit_price: unitPrice, min_order_qty: minOrderQty, lead_time_days: leadTimeDays, marketplace_visible: marketplaceVisible } = itemParsed.data

  const { data, error } = await supabase
    .schema('marketplace')
    .from('catalogue_items')
    .insert({
      supplier_id: supplier.id,
      supplier_org_id: mem.organisation_id,
      name,
      sku:         sku ?? null,
      description: description ?? null,
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

  const itemParsed = catalogueItemSchema.safeParse({
    name:                formData.get('name'),
    sku:                 formData.get('sku') || null,
    description:         formData.get('description') || null,
    category:            formData.get('category'),
    unit:                formData.get('unit'),
    unit_price:          formData.get('unit_price'),
    min_order_qty:       formData.get('min_order_qty'),
    lead_time_days:      formData.get('lead_time_days'),
    marketplace_visible: formData.get('marketplace_visible'),
  })
  if (!itemParsed.success) {
    return { error: itemParsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { name, sku, description, category, unit, unit_price: unitPrice, min_order_qty: minOrderQty, lead_time_days: leadTimeDays, marketplace_visible: marketplaceVisible } = itemParsed.data

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

  const orderParsed = placeOrderScalarSchema.safeParse({
    supplier_id:      formData.get('supplier_id'),
    supplier_org_id:  formData.get('supplier_org_id') || null,
    project_id:       formData.get('project_id') || null,
    notes:            formData.get('notes') ?? undefined,
    required_by:      formData.get('required_by') ?? undefined,
    delivery_address: formData.get('delivery_address') ?? undefined,
  })
  if (!orderParsed.success) {
    return { error: orderParsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { supplier_id: supplierId, supplier_org_id: supplierOrgId, project_id: projectId, notes, required_by: requiredBy, delivery_address: deliveryAddress } = orderParsed.data

  const itemIdsRaw = formData.getAll('item_id') as string[]
  const itemQtysRaw = formData.getAll('item_qty') as string[]
  const itemPricesRaw = formData.getAll('item_price') as string[]

  if (itemIdsRaw.length === 0) {
    return { error: 'At least one item is required.' }
  }

  // Create order
  const { data: order, error: orderErr } = await supabase
    .schema('marketplace')
    .from('orders')
    .insert({
      contractor_org_id: mem.organisation_id,
      supplier_org_id: supplierOrgId ?? null,
      supplier_id: supplierId,
      project_id: projectId ?? null,
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
