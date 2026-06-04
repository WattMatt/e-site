import type { TypedSupabaseClient } from '@esite/db'
import type { CreateSnagVisitInput, UpdateSnagVisitInput } from '../schemas/snag-visit.schema'
import { computeVisitBuckets } from './snag-visit-buckets'

// field schema is not in generated DB types — cast to any for .schema('field') calls,
// exactly as snag.service.ts does.

const PHOTO_SELECT = 'id, file_path, caption, photo_type, sort_order' as const

export const snagVisitService = {
  async listVisits(client: TypedSupabaseClient, projectId: string) {

    // Fetch all visits for the project
    const { data: visitRows, error: visitErr } = await (client as any)
      .schema('field')
      .from('snag_visits')
      .select('*')
      .eq('project_id', projectId)
      .order('visit_no', { ascending: true })
    if (visitErr) throw visitErr
    const visits = (visitRows ?? []) as Array<{ id: string; visit_no: number; [k: string]: unknown }>

    // Fetch slim snag rows needed for bucketing
    const { data: snagRows, error: snagErr } = await (client as any)
      .schema('field')
      .from('snags')
      .select('id, raised_on_visit_id, closed_on_visit_id, status')
      .eq('project_id', projectId)
    if (snagErr) throw snagErr
    const snags = snagRows ?? []

    return visits.map(v => {
      const buckets = computeVisitBuckets(v, visits, snags)
      return {
        ...v,
        newCount: buckets.newSnags.length,
        openCount: buckets.stillOpen.length,
        closedCount: buckets.closedThisVisit.length,
      }
    })
  },

  async getVisit(client: TypedSupabaseClient, visitId: string) {
    const { data, error } = await (client as any)
      .schema('field')
      .from('snag_visits')
      .select('*')
      .eq('id', visitId)
      .single()
    if (error) throw error
    return data
  },

  async createVisit(
    client: TypedSupabaseClient,
    {
      organisationId,
      projectId,
      visitDate,
      conductedBy,
      attendees,
      title,
      notes,
    }: CreateSnagVisitInput & { organisationId: string },
  ) {
    const { data, error } = await (client as any)
      .schema('field')
      .from('snag_visits')
      .insert({
        organisation_id: organisationId,
        project_id: projectId,
        visit_date: visitDate,
        conducted_by: conductedBy ?? null,
        attendees: attendees ?? [],
        title: title ?? null,
        notes: notes ?? null,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updateVisit(client: TypedSupabaseClient, visitId: string, patch: Omit<UpdateSnagVisitInput, 'visitId'>) {
    const update: Record<string, unknown> = {}
    if (patch.visitDate !== undefined) update.visit_date = patch.visitDate
    if (patch.conductedBy !== undefined) update.conducted_by = patch.conductedBy
    if (patch.attendees !== undefined) update.attendees = patch.attendees
    if (patch.title !== undefined) update.title = patch.title
    if (patch.notes !== undefined) update.notes = patch.notes

    const { data, error } = await (client as any)
      .schema('field')
      .from('snag_visits')
      .update(update)
      .eq('id', visitId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async deleteVisit(client: TypedSupabaseClient, visitId: string) {
    const { error } = await (client as any)
      .schema('field')
      .from('snag_visits')
      .delete()
      .eq('id', visitId)
    if (error) throw error
  },

  /** All snags for a project with visit linkage + photos — used by the visit page for bucketing + thumbnails. */
  async listVisitSnags(client: TypedSupabaseClient, projectId: string) {
    const { data, error } = await (client as any)
      .schema('field')
      .from('snags')
      .select(`*, snag_photos(${PHOTO_SELECT})`)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },
}
