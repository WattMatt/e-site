import type { TypedSupabaseClient } from '@esite/db'

export const diaryService = {
  async list(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('site_diary_entries')
      .select('*, author:profiles!created_by(id, full_name)')
      .eq('project_id', projectId)
      .order('entry_date', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: {
    projectId: string
    entryDate: string
    progressNotes: string
    weather?: string
    workersOnSite?: number
    delays?: string
  }) {
    const { data, error } = await client
      .schema('projects')
      .from('site_diary_entries')
      .insert({
        project_id: input.projectId,
        organisation_id: orgId,
        created_by: userId,
        entry_date: input.entryDate,
        progress_notes: input.progressNotes,
        weather: input.weather || null,
        workers_on_site: input.workersOnSite ?? null,
        delays: input.delays || null,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },
}
