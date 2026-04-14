import type { TypedSupabaseClient } from '@esite/db'

export const procurementService = {
  async listByOrg(client: TypedSupabaseClient, orgId: string, filters?: {
    status?: string
    projectId?: string
  }) {
    let query = client
      .schema('projects')
      .from('procurement_items')
      .select(`
        *,
        project:projects!project_id(id, name),
        created_by_profile:profiles!created_by(id, full_name),
        supplier:suppliers.suppliers!supplier_id(id, name)
      `)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })

    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.projectId) query = query.eq('project_id', filters.projectId)

    const { data, error } = await query
    if (error) throw error
    return data ?? []
  },

  async listByProject(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('procurement_items')
      .select(`
        *,
        created_by_profile:profiles!created_by(id, full_name),
        supplier:suppliers.suppliers!supplier_id(id, name)
      `)
      .eq('project_id', projectId)
      .order('required_by', { ascending: true, nullsFirst: false })
    if (error) throw error
    return data ?? []
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: {
    projectId: string
    description: string
    quantity?: number
    unit?: string
    requiredBy?: string
    notes?: string
  }) {
    const { data, error } = await client
      .schema('projects')
      .from('procurement_items')
      .insert({
        project_id: input.projectId,
        organisation_id: orgId,
        created_by: userId,
        description: input.description,
        quantity: input.quantity,
        unit: input.unit,
        required_by: input.requiredBy || null,
        notes: input.notes,
        status: 'draft',
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updateStatus(client: TypedSupabaseClient, id: string, status: string, extras?: {
    quotedPrice?: number
    poNumber?: string
    deliveryDate?: string
  }) {
    const { data, error } = await client
      .schema('projects')
      .from('procurement_items')
      .update({
        status,
        quoted_price: extras?.quotedPrice,
        po_number: extras?.poNumber,
        delivery_date: extras?.deliveryDate,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },
}
