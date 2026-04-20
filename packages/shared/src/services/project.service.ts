import type { TypedSupabaseClient } from '@esite/db'
import type { CreateProjectInput, UpdateProjectInput } from '../schemas/project.schema'
import { fetchProfileMap } from './_utils'

export const projectService = {
  async list(client: TypedSupabaseClient, orgId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('projects')
      .select('*, _count:project_members(count)')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    const projects = data ?? []
    const profiles = await fetchProfileMap(client, projects.map(p => (p as any).site_manager_id))
    return projects.map(p => ({
      ...p,
      site_manager: (p as any).site_manager_id ? (profiles[(p as any).site_manager_id] ?? null) : null,
    }))
  },

  async getById(client: TypedSupabaseClient, id: string) {
    const { data, error } = await client
      .schema('projects')
      .from('projects')
      .select('*, project_members(id, role, is_active, user_id)')
      .eq('id', id)
      .single()
    if (error) throw error
    const project = data as any
    const memberUserIds = (project.project_members ?? []).map((m: any) => m.user_id)
    const profiles = await fetchProfileMap(client, [project.site_manager_id, ...memberUserIds])
    return {
      ...project,
      site_manager: project.site_manager_id ? (profiles[project.site_manager_id] ?? null) : null,
      project_members: (project.project_members ?? []).map((m: any) => ({
        ...m,
        profile: m.user_id ? (profiles[m.user_id] ?? null) : null,
      })),
    }
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: CreateProjectInput) {
    const { data, error } = await client
      .schema('projects')
      .from('projects')
      .insert({
        organisation_id: orgId,
        created_by: userId,
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        province: input.province,
        status: input.status,
        start_date: input.startDate,
        end_date: input.endDate,
        contract_value: input.contractValue,
        client_name: input.clientName,
        client_contact: input.clientContact,
      })
      .select()
      .single()
    if (error) throw error
    await client
      .schema('projects')
      .from('project_members')
      .insert({ project_id: data.id, user_id: userId, organisation_id: orgId, role: 'project_manager' })
    return data
  },

  async update(client: TypedSupabaseClient, id: string, input: UpdateProjectInput) {
    const { data, error } = await client
      .schema('projects')
      .from('projects')
      .update({
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        province: input.province,
        status: input.status,
        start_date: input.startDate,
        end_date: input.endDate,
        contract_value: input.contractValue,
        client_name: input.clientName,
        client_contact: input.clientContact,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getStats(client: TypedSupabaseClient, orgId: string) {
    const [projects, snags, cocs] = await Promise.all([
      client
        .schema('projects')
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId)
        .eq('status', 'active'),
      client
        .schema('field')
        .from('snags')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId)
        .in('status', ['open', 'in_progress']),
      client
        .schema('compliance')
        .from('subsections')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId)
        .in('coc_status', ['missing', 'rejected']),
    ])
    return {
      activeProjects: projects.count ?? 0,
      openSnags: snags.count ?? 0,
      pendingCocs: cocs.count ?? 0,
    }
  },
}
