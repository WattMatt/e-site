import type { TypedSupabaseClient } from '@esite/db'
import type { CreateRfiInput, RespondToRfiInput } from '../schemas/rfi.schema'
import { fetchProfileMap } from './_utils'
import { projectSettingsService } from './project-settings.service'

/**
 * What `projects.rfis_write_guard()` (migration 00201) refuses, in the one
 * place every caller reads it from, so the app and the database cannot drift
 * into two different answers. The database's own sentence names the RFI
 * number; this one is used where the caller has not read it.
 */
export const RFI_CLOSE_REFUSED =
  "Only the person who raised this RFI, or the project's owners, admins or project managers, can close it."

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
    // Resolve the assignee: an explicit choice wins; otherwise fall back to the
    // project's configured default assignee (defaultRfiAssigneeId). M3-safe —
    // resolves to null when neither is set, which is a valid "unassigned" RFI.
    let assignedTo = input.assignedTo || null
    if (!assignedTo) {
      const defaults = await projectSettingsService.getRfiDefaults(client, input.projectId)
      assignedTo = defaults.assigneeId || null
    }

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
        // Empty strings → null: category is free text, but due_date is a DATE
        // column that rejects '' (mobile/web send '' when the field is blank).
        category: input.category || null,
        due_date: input.dueDate || null,
        assigned_to: assignedTo,
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

    // The answer is saved; the status flip is a separate statement and can be
    // refused on its own. Migration 00201's RESTRICTIVE policy narrows UPDATE
    // to callers with an effective role on the RFI's project, and a policy that
    // matches no row raises NOTHING — so the flip is reported by ROWS AFFECTED,
    // not by an error. Swallowing it would leave the RFI reading `open` with an
    // answer under it and nobody told.
    const { data: moved, error: statusError } = await client
      .schema('projects')
      .from('rfis')
      .update({ status: 'responded' })
      .eq('id', input.rfiId)
      .select('id')
    return {
      ...(data as Record<string, unknown>),
      status_moved: !statusError && (moved ?? []).length > 0,
      status_error: statusError?.message ?? null,
    } as any
  },

  async close(client: TypedSupabaseClient, rfiId: string, userId: string) {
    const { data, error } = await client
      .schema('projects')
      .from('rfis')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: userId })
      .eq('id', rfiId)
      .select('id')
    if (error) throw error
    // Same reason as respond(): 00201's policy refuses silently. Without this
    // the caller reports a close that never happened.
    if ((data ?? []).length === 0) throw new Error(RFI_CLOSE_REFUSED)
  },
}
