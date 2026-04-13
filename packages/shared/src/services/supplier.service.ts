import type { TypedSupabaseClient } from '@esite/db'

export const supplierService = {
  async listAll(client: TypedSupabaseClient, filters?: { category?: string }) {
    let query = client
      .schema('suppliers')
      .from('suppliers')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (filters?.category) {
      query = query.contains('categories', [filters.category])
    }

    const { data, error } = await query
    if (error) throw error
    return data ?? []
  },

  async getById(client: TypedSupabaseClient, supplierId: string) {
    const { data, error } = await client
      .schema('suppliers')
      .from('suppliers')
      .select(`
        *,
        supplier_contacts(*)
      `)
      .eq('id', supplierId)
      .single()
    if (error) throw error
    return data
  },

  async getCatalogueItems(client: TypedSupabaseClient, supplierId: string, category?: string) {
    let query = client
      .schema('marketplace')
      .from('catalogue_items')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('is_active', true)
      .eq('marketplace_visible', true)
      .order('category')
      .order('name')

    if (category) query = query.eq('category', category)

    const { data, error } = await query
    if (error) throw error
    return data ?? []
  },

  async createOrder(client: TypedSupabaseClient, contractorOrgId: string, userId: string, input: {
    supplierId: string
    supplierOrgId?: string
    projectId?: string
    notes?: string
    items: Array<{ catalogueItemId: string; quantity: number; unitPrice: number }>
  }) {
    // Create the order
    const { data: order, error: orderErr } = await client
      .schema('marketplace')
      .from('orders')
      .insert({
        contractor_org_id: contractorOrgId,
        supplier_org_id: input.supplierOrgId ?? null,
        supplier_id: input.supplierId,
        project_id: input.projectId ?? null,
        created_by: userId,
        notes: input.notes ?? null,
        status: 'draft',
      })
      .select()
      .single()
    if (orderErr) throw orderErr

    // Create order items
    const items = input.items.map(item => ({
      order_id: order.id,
      catalogue_item_id: item.catalogueItemId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
    }))
    const { error: itemErr } = await client
      .schema('marketplace')
      .from('order_items')
      .insert(items)
    if (itemErr) throw itemErr

    return order
  },

  async getLinkedSuppliers(client: TypedSupabaseClient, contractorOrgId: string) {
    const { data, error } = await client
      .schema('suppliers')
      .from('organisation_suppliers')
      .select(`
        *,
        supplier:suppliers!supplier_id(*)
      `)
      .eq('contractor_org_id', contractorOrgId)
    if (error) throw error
    return data ?? []
  },
}
