import type { TypedSupabaseClient } from '@esite/db'
import { fetchProfileMap } from './_utils'

export type DiaryEntryType =
  | 'progress'
  | 'safety'
  | 'quality'
  | 'delay'
  | 'weather'
  | 'workforce'
  | 'general'

export const ENTRY_TYPE_LABELS: Record<DiaryEntryType, string> = {
  progress: 'Progress',
  safety: 'Safety',
  quality: 'Quality',
  delay: 'Delay',
  weather: 'Weather',
  workforce: 'Workforce',
  general: 'General',
}

export const diaryService = {
  async list(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('site_diary_entries')
      .select('*')
      .eq('project_id', projectId)
      .order('entry_date', { ascending: false })
    if (error) throw error
    const entries = data ?? []
    const profiles = await fetchProfileMap(client, entries.map((e: any) => e.created_by))
    return entries.map((e: any) => ({
      ...e,
      author: e.created_by ? (profiles[e.created_by] ?? null) : null,
    }))
  },

  async listByOrg(
    client: TypedSupabaseClient,
    orgId: string,
    filters?: {
      dateFrom?: string  // ISO date string yyyy-mm-dd
      dateTo?: string
      entryType?: DiaryEntryType
      projectId?: string
    },
  ) {
    let query = client
      .schema('projects')
      .from('site_diary_entries')
      .select(`
        *,
        project:projects!project_id(id, name)
      `)
      .eq('organisation_id', orgId)
      .order('entry_date', { ascending: false })

    if (filters?.dateFrom) query = query.gte('entry_date', filters.dateFrom)
    if (filters?.dateTo) query = query.lte('entry_date', filters.dateTo)
    if (filters?.entryType) query = (query as any).eq('entry_type', filters.entryType)
    if (filters?.projectId) query = query.eq('project_id', filters.projectId)

    const { data, error } = await query
    if (error) throw error
    const entries = data ?? []
    const profiles = await fetchProfileMap(client, entries.map((e: any) => e.created_by))
    return entries.map((e: any) => ({
      ...e,
      author: e.created_by ? (profiles[e.created_by] ?? null) : null,
    }))
  },

  /** Returns Mon–Sun for the ISO week containing `date` (defaults to today). */
  getWeekBounds(date?: string): { weekStart: string; weekEnd: string } {
    const d = date ? new Date(date) : new Date()
    const day = d.getUTCDay() // 0 = Sun
    const diffToMon = (day === 0 ? -6 : 1 - day)
    const mon = new Date(d)
    mon.setUTCDate(d.getUTCDate() + diffToMon)
    const sun = new Date(mon)
    sun.setUTCDate(mon.getUTCDate() + 6)
    return {
      weekStart: mon.toISOString().slice(0, 10),
      weekEnd: sun.toISOString().slice(0, 10),
    }
  },

  async getWeeklySummary(
    client: TypedSupabaseClient,
    orgId: string,
    weekStart: string,  // yyyy-mm-dd (Monday)
    weekEnd: string,    // yyyy-mm-dd (Sunday)
  ) {
    const entries = await diaryService.listByOrg(client, orgId, {
      dateFrom: weekStart,
      dateTo: weekEnd,
    })

    const totalEntries = entries.length
    const totalWorkers = entries.reduce((sum: number, e: any) => sum + (e.workers_on_site ?? 0), 0)
    const avgWorkers = totalEntries > 0 ? Math.round(totalWorkers / totalEntries) : 0

    const delayEntries = entries.filter((e: any) => e.delays || e.entry_type === 'delay')
    const safetyEntries = entries.filter((e: any) => e.safety_notes || e.entry_type === 'safety')

    // Group by project
    const byProject: Record<string, { projectName: string; entryCount: number; entryIds: string[] }> = {}
    for (const e of entries) {
      const project = (e as any).project
      if (!project) continue
      if (!byProject[project.id]) {
        byProject[project.id] = { projectName: project.name, entryCount: 0, entryIds: [] }
      }
      byProject[project.id].entryCount++
      byProject[project.id].entryIds.push(e.id as string)
    }

    // Days with entries
    const daysWithEntries = new Set(entries.map((e: any) => e.entry_date as string)).size

    return {
      weekStart,
      weekEnd,
      totalEntries,
      daysWithEntries,
      avgWorkersPerDay: avgWorkers,
      delayCount: delayEntries.length,
      safetyIncidentCount: safetyEntries.length,
      projectBreakdown: Object.values(byProject),
      entries,
    }
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: {
    projectId: string
    entryDate: string
    entryType?: DiaryEntryType
    progressNotes: string
    safetyNotes?: string
    qualityNotes?: string
    delayNotes?: string
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
        entry_type: input.entryType ?? 'progress',
        progress_notes: input.progressNotes,
        safety_notes: input.safetyNotes || null,
        quality_notes: input.qualityNotes || null,
        delay_notes: input.delayNotes || null,
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
