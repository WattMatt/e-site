import type { TypedSupabaseClient } from '@esite/db'
import type { CreateRfiInput, RespondToRfiInput } from '../schemas/rfi.schema'
import { fetchProfileMap } from './_utils'

export const rfiService = {
  async listByOrg(client: TypedSupabaseClient, orgId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .select('id, subject, status, priority, due_date, created_at, raised_by')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    const rfis = data ?? []
    const profiles = await fetchProfileMap(client, rfis.map(r => r.raised_by))
    return rfis.map(r => ({
      ...r,
      raised_by_profile: r.raised_by ? (profiles[r.raised_by] ?? null) : null,
    }))
  },

  async list(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .select('*, rfi_responses(id, body, responded_by, created_at)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    const rfis = data ?? []
    const allUserIds = rfis.flatMap(r => [
      r.raised_by,
      r.assigned_to,
      ...((r as any).rfi_responses ?? []).map((res: any) => res.responded_by),
    ])
    const profiles = await fetchProfileMap(client, allUserIds)
    return rfis.map(r => ({
      ...r,
      raised_by_profile: r.raised_by ? (profiles[r.raised_by] ?? null) : null,
      assigned_to_profile: (r as any).assigned_to ? (profiles[(r as any).assigned_to] ?? null) : null,
      rfi_responses: ((r as any).rfi_responses ?? []).map((res: any) => ({
        ...res,
        responder: res.responded_by ? (profiles[res.responded_by] ?? null) : null,
      })),
    }))
  },

  async getById(client: TypedSupabaseClient, id: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .select('*, rfi_responses(*, responded_by)')
      .eq('id', id)
      .single()
    if (error) throw error
    const r = data as any
    const allUserIds = [
      r.raised_by,
      r.assigned_to,
      ...(r.rfi_responses ?? []).map((res: any) => res.responded_by),
    ]
    const profiles = await fetchProfileMap(client, allUserIds)
    return {
      ...r,
      raised_by_profile: r.raised_by ? (profiles[r.raised_by] ?? null) : null,
      assigned_to_profile: r.assigned_to ? (profiles[r.assigned_to] ?? null) : null,
      rfi_responses: (r.rfi_responses ?? []).map((res: any) => ({
        ...res,
        responder: res.responded_by ? (profiles[res.responded_by] ?? null) : null,
      })),
    }
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
