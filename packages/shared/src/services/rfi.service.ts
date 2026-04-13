import type { TypedSupabaseClient } from '@esite/db'
import type { CreateRfiInput, RespondToRfiInput } from '../schemas/rfi.schema'

export const rfiService = {
  async list(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .select(`
        *,
        raised_by_profile:profiles!raised_by(id, full_name, avatar_url),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url),
        rfi_responses(id, body, responded_by,
          responder:profiles!responded_by(id, full_name)
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },

  async getById(client: TypedSupabaseClient, id: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .select(`
        *,
        raised_by_profile:profiles!raised_by(id, full_name, email, avatar_url),
        assigned_to_profile:profiles!assigned_to(id, full_name, email, avatar_url),
        rfi_responses(*, responder:profiles!responded_by(id, full_name, avatar_url))
      `)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: CreateRfiInput) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .insert({
        project_id: input.projectId,
        organisation_id: orgId,
        raised_by: userId,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        category: input.category,
        due_date: input.dueDate,
        assigned_to: input.assignedTo,
        status: 'open',
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async respond(client: TypedSupabaseClient, input: RespondToRfiInput, userId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfi_responses')
      .insert({ rfi_id: input.rfiId, body: input.body, responded_by: userId })
      .select()
      .single()
    if (error) throw error
    // Auto-set RFI to 'responded'
    await client
      .schema('projects')
      .from('rfis')
      .update({ status: 'responded' })
      .eq('id', input.rfiId)
    return data
  },

  async close(client: TypedSupabaseClient, rfiId: string, userId: string) {
    const { error } = await client
      .schema('projects')
      .from('rfis')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: userId })
      .eq('id', rfiId)
    if (error) throw error
  },
}
