import type { TypedSupabaseClient } from '@esite/db'
import type { AddQcCommentInput, AddQcEntryInput, CreateQcReportInput, UpdateQcReportInput } from '../schemas/qc.schema'
import type { QcReportStatus } from '../types'
import { fetchProfileMap } from './_utils'

// projects.qc_* tables are not in generated DB types — cast to any for
// .schema('projects') calls, exactly as snag-visit.service.ts does for `field`.

export type QcPhotoKind = 'photo' | 'markup'

export interface QcReport {
  id: string
  project_id: string
  organisation_id: string
  report_no: number
  title: string
  description: string | null
  location: string | null
  inspection_date: string | null
  status: QcReportStatus
  raised_by: string
  issued_at: string | null
  issued_by: string | null
  created_at: string
  updated_at: string
}

export interface QcEntryPhoto {
  id: string
  entry_id: string
  organisation_id: string
  project_id: string
  file_path: string
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  caption: string | null
  sort_order: number
  kind: QcPhotoKind
  source_floor_plan_id: string | null
  annotation_data: unknown | null
  uploaded_by: string
  created_at: string
}

export interface QcComment {
  id: string
  report_id: string
  entry_id: string
  /** NULL = comment on the whole entry/group; set = comment on one photo. */
  photo_id: string | null
  body: string
  created_by: string
  created_at: string
  updated_at: string
}

export const qcService = {
  /** All QC reports for a project with entry/photo counts + raiser names. */
  async listByProject(client: TypedSupabaseClient, projectId: string) {
    const { data: reportRows, error: reportErr } = await (client as any)
      .schema('projects')
      .from('qc_reports')
      .select('*')
      .eq('project_id', projectId)
      .order('report_no', { ascending: false })
    if (reportErr) throw reportErr
    const reports = (reportRows ?? []) as QcReport[]

    // Slim child rows for counting — both tables denormalise project_id, so
    // no per-report round trips.
    const { data: entryRows, error: entryErr } = await (client as any)
      .schema('projects')
      .from('qc_entries')
      .select('id, report_id')
      .eq('project_id', projectId)
    if (entryErr) throw entryErr
    const entries = (entryRows ?? []) as Array<{ id: string; report_id: string }>

    const { data: photoRows, error: photoErr } = await (client as any)
      .schema('projects')
      .from('qc_entry_photos')
      .select('id, entry_id')
      .eq('project_id', projectId)
    if (photoErr) throw photoErr
    const photos = (photoRows ?? []) as Array<{ id: string; entry_id: string }>

    const entryReport = new Map(entries.map((e) => [e.id, e.report_id]))
    const entryCounts: Record<string, number> = {}
    for (const e of entries) entryCounts[e.report_id] = (entryCounts[e.report_id] ?? 0) + 1
    const photoCounts: Record<string, number> = {}
    for (const p of photos) {
      const reportId = entryReport.get(p.entry_id)
      if (reportId) photoCounts[reportId] = (photoCounts[reportId] ?? 0) + 1
    }

    const profiles = await fetchProfileMap(client, reports.map((r) => r.raised_by))
    return reports.map((r) => ({
      ...r,
      raised_by_profile: r.raised_by ? (profiles[r.raised_by] ?? null) : null,
      entryCount: entryCounts[r.id] ?? 0,
      photoCount: photoCounts[r.id] ?? 0,
    }))
  },

  async getById(client: TypedSupabaseClient, reportId: string) {
    const { data, error } = await (client as any)
      .schema('projects')
      .from('qc_reports')
      .select('*')
      .eq('id', reportId)
      .single()
    if (error) throw error
    const r = data as QcReport
    const profiles = await fetchProfileMap(client, [r.raised_by, r.issued_by])
    return {
      ...r,
      raised_by_profile: r.raised_by ? (profiles[r.raised_by] ?? null) : null,
      issued_by_profile: r.issued_by ? (profiles[r.issued_by] ?? null) : null,
    }
  },

  async create(client: TypedSupabaseClient, orgId: string, userId: string, input: CreateQcReportInput) {
    const { data, error } = await (client as any)
      .schema('projects')
      .from('qc_reports')
      .insert({
        project_id: input.projectId,
        organisation_id: orgId,
        raised_by: userId,
        title: input.title,
        // Empty strings → null: description/location are free text, but
        // inspection_date is a DATE column that rejects ''.
        description: input.description || null,
        location: input.location || null,
        inspection_date: input.inspectionDate || null,
        // status defaults to 'draft'; report_no is assigned by the
        // qc_reports_ensure_no BEFORE INSERT trigger (per-project MAX+1).
      })
      .select()
      .single()
    if (error) throw error
    return data as QcReport
  },

  async update(client: TypedSupabaseClient, reportId: string, patch: Omit<UpdateQcReportInput, 'reportId'>) {
    const update: Record<string, unknown> = {}
    if (patch.title !== undefined) update.title = patch.title
    if (patch.description !== undefined) update.description = patch.description || null
    if (patch.location !== undefined) update.location = patch.location || null
    if (patch.inspectionDate !== undefined) update.inspection_date = patch.inspectionDate || null

    if (Object.keys(update).length === 0) {
      throw new Error('update: no editable fields provided')
    }

    const { data, error } = await (client as any)
      .schema('projects')
      .from('qc_reports')
      .update(update)
      .eq('id', reportId)
      .select()
      .single()
    if (error) throw error
    return data as QcReport
  },

  async remove(client: TypedSupabaseClient, reportId: string) {
    const { error } = await (client as any)
      .schema('projects')
      .from('qc_reports')
      .delete()
      .eq('id', reportId)
    if (error) throw error
  },

  /** Adds an entry at the end of the report (sort_order = MAX+1). */
  async addEntry(
    client: TypedSupabaseClient,
    {
      organisationId,
      projectId,
      reportId,
      title,
      description,
    }: AddQcEntryInput & { organisationId: string; projectId: string },
    userId: string,
  ) {
    const { data: last, error: lastErr } = await (client as any)
      .schema('projects')
      .from('qc_entries')
      .select('sort_order')
      .eq('report_id', reportId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastErr) throw lastErr
    const sortOrder = last ? (last.sort_order as number) + 1 : 0

    const { data, error } = await (client as any)
      .schema('projects')
      .from('qc_entries')
      .insert({
        report_id: reportId,
        organisation_id: organisationId,
        project_id: projectId,
        title,
        description: description || null,
        sort_order: sortOrder,
        created_by: userId,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  /**
   * All entries for a report with their photos + comments (photos/comments
   * sorted in JS — nested PostgREST ordering isn't worth the cast gymnastics)
   * and author names resolved for entries and comments.
   */
  async listEntriesWithPhotos(client: TypedSupabaseClient, reportId: string) {
    const { data, error } = await (client as any)
      .schema('projects')
      .from('qc_entries')
      .select('*, qc_entry_photos(*), qc_comments(*)')
      .eq('report_id', reportId)
      .order('sort_order', { ascending: true })
    if (error) throw error
    const entries = (data ?? []) as Array<Record<string, any>>

    const userIds = entries.flatMap((e) => [
      e.created_by,
      ...((e.qc_comments ?? []) as QcComment[]).map((c) => c.created_by),
    ])
    const profiles = await fetchProfileMap(client, userIds)

    return entries.map((e) => ({
      ...e,
      author: e.created_by ? (profiles[e.created_by] ?? null) : null,
      qc_entry_photos: ((e.qc_entry_photos ?? []) as QcEntryPhoto[])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
      qc_comments: ((e.qc_comments ?? []) as QcComment[])
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((c) => ({
          ...c,
          author: c.created_by ? (profiles[c.created_by] ?? null) : null,
        })),
    }))
  },

  /**
   * Adds a comment to an entry (photoId null/omitted = group comment).
   * Resolves report_id from the entry; rejects a photoId that does not belong
   * to the entry (no DB constraint ties photo → same entry).
   */
  async addComment(client: TypedSupabaseClient, input: AddQcCommentInput, userId: string) {
    const { data: entry, error: entryErr } = await (client as any)
      .schema('projects')
      .from('qc_entries')
      .select('id, report_id')
      .eq('id', input.entryId)
      .maybeSingle()
    if (entryErr) throw entryErr
    if (!entry) throw new Error('addComment: entry not found')

    if (input.photoId) {
      const { data: photo, error: photoErr } = await (client as any)
        .schema('projects')
        .from('qc_entry_photos')
        .select('id, entry_id')
        .eq('id', input.photoId)
        .maybeSingle()
      if (photoErr) throw photoErr
      if (!photo || photo.entry_id !== input.entryId) {
        throw new Error('addComment: photo does not belong to this entry')
      }
    }

    const { data, error } = await (client as any)
      .schema('projects')
      .from('qc_comments')
      .insert({
        report_id: entry.report_id,
        entry_id: input.entryId,
        photo_id: input.photoId ?? null,
        body: input.body,
        created_by: userId,
      })
      .select()
      .single()
    if (error) throw error
    return data as QcComment
  },
}
