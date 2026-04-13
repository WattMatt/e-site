import type { TypedSupabaseClient } from '@esite/db'

export const floorPlanService = {
  async listByProject(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('tenants')
      .from('floor_plans')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('level')
    if (error) throw error
    return data
  },

  async getById(client: TypedSupabaseClient, id: string) {
    const { data, error } = await client
      .schema('tenants')
      .from('floor_plans')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async create(client: TypedSupabaseClient, input: {
    organisationId: string
    projectId: string
    userId: string
    name: string
    level?: string
    filePath: string
    fileSizeBytes?: number
    widthPx?: number
    heightPx?: number
    scale?: string
  }) {
    const { data, error } = await client
      .schema('tenants')
      .from('floor_plans')
      .insert({
        organisation_id: input.organisationId,
        project_id: input.projectId,
        uploaded_by: input.userId,
        name: input.name,
        level: input.level,
        file_path: input.filePath,
        file_size_bytes: input.fileSizeBytes,
        width_px: input.widthPx,
        height_px: input.heightPx,
        scale: input.scale,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getSnagPins(client: TypedSupabaseClient, floorPlanId: string) {
    const { data, error } = await client
      .schema('field')
      .from('snags')
      .select('id, title, status, priority, floor_plan_pin')
      .contains('floor_plan_pin', { floorPlanId })
    if (error) throw error
    return (data ?? []).filter((s) => s.floor_plan_pin != null)
  },
}
