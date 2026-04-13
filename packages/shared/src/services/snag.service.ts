import type { TypedSupabaseClient } from '@esite/db'
import type { CreateSnagInput, UpdateSnagInput } from '../schemas/snag.schema'

export const snagService = {
  async list(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .select(`
        *,
        snag_photos(id, file_path, caption, photo_type, sort_order),
        raised_by_profile:profiles!raised_by(id, full_name, avatar_url),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },

  async listByOrg(client: TypedSupabaseClient, orgId: string, filters?: {
    status?: string
    priority?: string
    assignedTo?: string
  }) {
    let query = client
      .schema('field')
      .from('snags')
      .select(`
        *,
        snag_photos(id, file_path, sort_order),
        raised_by_profile:profiles!raised_by(id, full_name, avatar_url),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url),
        project:projects!project_id(id, name)
      `)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })

    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.priority) query = query.eq('priority', filters.priority)
    if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)

    const { data, error } = await query
    if (error) throw error
    return data
  },

  async getById(client: TypedSupabaseClient, id: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .select(`
        *,
        snag_photos(*),
        raised_by_profile:profiles!raised_by(id, full_name, email, avatar_url),
        assigned_to_profile:profiles!assigned_to(id, full_name, email, avatar_url),
        signed_off_by_profile:profiles!signed_off_by(id, full_name),
        project:projects!project_id(id, name, organisation_id)
      `)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: CreateSnagInput) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .insert({
        project_id: input.projectId,
        organisation_id: orgId,
        raised_by: userId,
        title: input.title,
        description: input.description,
        location: input.location,
        category: input.category,
        priority: input.priority,
        assigned_to: input.assignedTo,
        floor_plan_pin: input.floorPlanPin,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async update(client: TypedSupabaseClient, id: string, input: UpdateSnagInput) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .update({
        title: input.title,
        description: input.description,
        location: input.location,
        category: input.category,
        priority: input.priority,
        status: input.status,
        assigned_to: input.assignedTo,
        floor_plan_pin: input.floorPlanPin,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async signOff(client: TypedSupabaseClient, id: string, userId: string, signaturePath: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .update({
        status: 'signed_off',
        signed_off_by: userId,
        signed_off_at: new Date().toISOString(),
        signature_path: signaturePath,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getStats(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .select('status')
      .eq('project_id', projectId)
    if (error) throw error

    return (data ?? []).reduce(
      (acc, snag) => {
        acc[snag.status] = (acc[snag.status] ?? 0) + 1
        acc.total++
        return acc
      },
      { open: 0, in_progress: 0, resolved: 0, pending_sign_off: 0, signed_off: 0, closed: 0, total: 0 }
    )
  },
}
