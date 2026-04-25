import type { TypedSupabaseClient } from '@esite/db'
import type { CreateSnagInput, UpdateSnagInput } from '../schemas/snag.schema'
import { fetchProfileMap, fetchProjectMap } from './_utils'

export const snagService = {
  async list(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .select('*, snag_photos(id, file_path, caption, photo_type, sort_order)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    const snags = data ?? []
    const profiles = await fetchProfileMap(client, snags.flatMap(s => [s.raised_by, s.assigned_to]))
    return snags.map(s => ({
      ...s,
      raised_by_profile: s.raised_by ? (profiles[s.raised_by] ?? null) : null,
      assigned_to_profile: s.assigned_to ? (profiles[s.assigned_to] ?? null) : null,
    }))
  },

  async listByOrg(client: TypedSupabaseClient, orgId: string, filters?: {
    status?: string
    priority?: string
    assignedTo?: string
    /** "aging" filter: status in (open, in_progress) AND created_at < N days ago. */
    agingDays?: number
  }) {
    let query = client
      .schema('field')
      .from('snags')
      .select('*, snag_photos(id, file_path, sort_order)')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })

    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.priority) query = query.eq('priority', filters.priority)
    if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
    if (filters?.agingDays != null) {
      const cutoff = new Date(Date.now() - filters.agingDays * 86_400_000).toISOString()
      query = query.in('status', ['open', 'in_progress']).lt('created_at', cutoff)
    }

    const { data, error } = await query
    if (error) throw error
    const snags = data ?? []
    const [profiles, projects] = await Promise.all([
      fetchProfileMap(client, snags.flatMap(s => [s.raised_by, s.assigned_to])),
      fetchProjectMap(client, snags.map(s => s.project_id)),
    ])
    return snags.map(s => ({
      ...s,
      raised_by_profile: s.raised_by ? (profiles[s.raised_by] ?? null) : null,
      assigned_to_profile: s.assigned_to ? (profiles[s.assigned_to] ?? null) : null,
      project: s.project_id ? (projects[s.project_id] ?? null) : null,
    }))
  },

  async getById(client: TypedSupabaseClient, id: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .select('*, snag_photos(*)')
      .eq('id', id)
      .single()
    if (error) throw error
    const s = data
    const [profiles, projects] = await Promise.all([
      fetchProfileMap(client, [s.raised_by, s.assigned_to, s.signed_off_by]),
      fetchProjectMap(client, [s.project_id]),
    ])
    return {
      ...s,
      raised_by_profile: s.raised_by ? (profiles[s.raised_by] ?? null) : null,
      assigned_to_profile: s.assigned_to ? (profiles[s.assigned_to] ?? null) : null,
      signed_off_by_profile: s.signed_off_by ? (profiles[s.signed_off_by] ?? null) : null,
      project: s.project_id ? (projects[s.project_id] ?? null) : null,
    }
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

    type SnagCounts = { open: number; in_progress: number; resolved: number; pending_sign_off: number; signed_off: number; closed: number; total: number }
    return (data ?? []).reduce(
      (acc: SnagCounts, snag) => {
        const key = snag.status as keyof Omit<SnagCounts, 'total'>
        acc[key] = (acc[key] ?? 0) + 1
        acc.total++
        return acc
      },
      { open: 0, in_progress: 0, resolved: 0, pending_sign_off: 0, signed_off: 0, closed: 0, total: 0 }
    )
  },
}
