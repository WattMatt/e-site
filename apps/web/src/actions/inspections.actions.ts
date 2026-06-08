'use server'

/**
 * Inspection lifecycle server actions — assignment, response capture, and
 * verifier-side state transitions.
 *
 * Mirrors the existing patterns:
 *   - `inspections-template.actions.ts` for the schema('inspections') cast +
 *     org-role gating shape.
 *   - `rfi.actions.ts` for the assignee notification dispatch via the
 *     `dispatchNotification` helper (best-effort, never throws).
 *
 * The `inspections` schema is not in the generated DB types yet, so the
 * supabase client is cast to `any` at each call site — same convention used
 * across the cable-schedule and template-library actions.
 *
 * Schema reality check (verified against migration 00066):
 *   - `cable_schedule.boards` + `.sources` are scoped by REVISION, not
 *     project_id. Listing nodes for a project goes via the most-recent
 *     non-superseded revision (ISSUED preferred, else DRAFT).
 *   - `projects.project_members.role` is a project-level enum
 *     (`project_manager|contractor|inspector|supplier|client_viewer`);
 *     verifier-eligibility filtering uses ORG-level role from
 *     `public.user_organisations` (`owner|admin|project_manager`).
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { dispatchNotification } from '@/lib/notifications'
import { requireFeature } from '@/lib/features'
import type { SupabaseClient } from '@supabase/supabase-js'

type AnyClient = SupabaseClient<any, any, any>

// ─── helpers ────────────────────────────────────────────────────────────

async function requirePmOrAbove(supabase: AnyClient, orgId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', orgId)
    .eq('is_active', true)
    .single()

  if (!data || !['owner', 'admin', 'project_manager'].includes(data.role as string)) {
    throw new Error('Forbidden: project_manager or above only')
  }
  return user
}

async function getOrgIdForProject(supabase: AnyClient, projectId: string): Promise<string> {
  const { data } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .single()
  if (!data) throw new Error('Project not found')
  return (data as { organisation_id: string }).organisation_id
}

/**
 * Resolve the "current" cable-schedule revision for a project so we can
 * enumerate its boards + sources. Prefers ISSUED (the canonical built
 * version), falls back to DRAFT, ignores SUPERSEDED.
 *
 * Returns null when the project has no revision at all yet — the new
 * inspection form will then fall back to ad-hoc target entry.
 */
async function getCurrentRevisionId(supabase: AnyClient, projectId: string): Promise<string | null> {
  const { data: issued } = await supabase
    .schema('cable_schedule')
    .from('revisions')
    .select('id, issued_at')
    .eq('project_id', projectId)
    .eq('status', 'ISSUED')
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (issued?.id) return issued.id as string

  const { data: draft } = await supabase
    .schema('cable_schedule')
    .from('revisions')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'DRAFT')
    .limit(1)
    .maybeSingle()

  return (draft?.id as string | undefined) ?? null
}

// ─── listProjectNodesAction ─────────────────────────────────────────────

/**
 * List boards + sources available as inspection targets on a project.
 *
 * Pulls from the current cable-schedule revision (ISSUED→DRAFT preference).
 * Empty list is a valid result — the caller should also offer ad-hoc entry.
 */
export async function listProjectNodesAction(projectId: string) {
  const supabase = (await createClient()) as AnyClient
  const revisionId = await getCurrentRevisionId(supabase, projectId)
  if (!revisionId) return [] as Array<{ type: 'board' | 'source'; id: string; label: string }>

  // Boards are now structure.nodes (migration 00077). Cross-schema PostgREST
  // embeds are unreliable (PGRST200), so we read structure.nodes directly
  // scoped by project_id. Sources remain in cable_schedule.
  const { data: revRow } = await supabase
    .schema('cable_schedule')
    .from('revisions')
    .select('project_id')
    .eq('id', revisionId)
    .single()
  const revProjectId = (revRow as { project_id: string } | null)?.project_id ?? ''

  const [{ data: structureNodes }, { data: sources }] = await Promise.all([
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code, name')
      .eq('project_id', revProjectId)
      .is('deleted_at' as never, null),
    supabase
      .schema('cable_schedule')
      .from('sources')
      .select('id, code')
      .eq('revision_id', revisionId),
  ])

  const nodes: Array<{ type: 'board' | 'source'; id: string; label: string }> = [
    ...((structureNodes as Array<{ id: string; code: string; name: string | null }> | null) ?? []).map((b) => ({
      type: 'board' as const,
      id: b.id,
      label: b.code,
    })),
    ...((sources as Array<{ id: string; code: string }> | null) ?? []).map((s) => ({
      type: 'source' as const,
      id: s.id,
      label: s.code,
    })),
  ]

  return nodes.sort((a, b) => a.label.localeCompare(b.label))
}

// ─── listProjectMembersAction ───────────────────────────────────────────

/**
 * List active members of a project with their org-level role hydrated.
 *
 * Cross-schema profile + user_organisations joins via PostgREST embed are
 * unreliable (Session 28 PGRST200 saga), so we fetch the IDs first then
 * batch-hydrate from public.profiles + public.user_organisations.
 */
export async function listProjectMembersAction(projectId: string) {
  type Member = { user_id: string; full_name: string | null; email: string | null; role: string | null }
  const supabase = (await createClient()) as AnyClient

  // Resolve org for the access gate.
  const { data: project } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return [] as Member[]

  // Gate: any active org member may see the member list (matches the settings
  // members page). Return [] rather than throw, so the un-PM-gated /new page
  // still renders for non-PM members.
  const guard = await requireRole(supabase, project.organisation_id, [
    'owner',
    'admin',
    'project_manager',
    'contractor',
    'inspector',
    'supplier',
    'client_viewer',
  ])
  if (!guard.ok) return [] as Member[]

  const { data: rows } = await supabase
    .schema('projects')
    .from('project_members')
    .select('user_id, organisation_id')
    .eq('project_id', projectId)
    .eq('is_active', true)

  const members = (rows as Array<{ user_id: string; organisation_id: string }> | null) ?? []
  if (members.length === 0) return [] as Member[]

  const userIds = [...new Set(members.map((m) => m.user_id))]
  const orgIds = [...new Set(members.map((m) => m.organisation_id))]

  // Resolve identity (profiles) + org-role via the SERVICE client — the cookie
  // client only ever sees the viewer's own profile under RLS (00009). Safe: the
  // requireRole gate above already authorised the caller. org_role is keyed by
  // (user_id, organisation_id) so cross-org / sub-org members resolve correctly.
  const service = createServiceClient() as AnyClient
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    service.from('profiles').select('id, full_name, email').in('id', userIds),
    service
      .from('user_organisations')
      .select('user_id, organisation_id, role')
      .in('user_id', userIds)
      .in('organisation_id', orgIds),
  ])

  const profileMap = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]),
  )
  const roleMap = new Map(
    ((roles ?? []) as Array<{ user_id: string; organisation_id: string; role: string }>).map((r) => [
      `${r.user_id}|${r.organisation_id}`,
      r.role,
    ]),
  )

  return members.map((m) => {
    const p = profileMap.get(m.user_id)
    return {
      user_id: m.user_id,
      full_name: p?.full_name ?? null,
      email: p?.email ?? null,
      role: roleMap.get(`${m.user_id}|${m.organisation_id}`) ?? null,
    } as Member
  })
}

// ─── createInspectionAction ─────────────────────────────────────────────

export interface CreateInspectionInput {
  organisationId: string
  projectId: string
  templateId: string
  targetNodeType: 'board' | 'source' | 'adhoc'
  targetNodeId: string | null
  targetLabel: string
  targetLocation: string | null
  assignedToId: string | null
  verifierId: string | null
  scheduledAt: string | null
}

export async function createInspectionAction(input: CreateInspectionInput): Promise<string> {
  const supabase = (await createClient()) as AnyClient
  const user = await requirePmOrAbove(supabase, input.organisationId)
  await requireFeature(input.organisationId, 'inspections', supabase)

  const { data, error } = await supabase
    .schema('inspections')
    .from('inspections')
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      template_id: input.templateId,
      target_node_type: input.targetNodeType,
      target_node_id: input.targetNodeId,
      target_label: input.targetLabel,
      target_location: input.targetLocation,
      assigned_to_id: input.assignedToId,
      verifier_id: input.verifierId,
      scheduled_at: input.scheduledAt,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw error
  const inspectionId = (data as { id: string }).id

  // Best-effort notification to the assignee (skip if they assigned themselves).
  if (input.assignedToId && input.assignedToId !== user.id) {
    await dispatchNotification({
      userIds: [input.assignedToId],
      title: 'New inspection assigned to you',
      body: `"${input.targetLabel}"${input.scheduledAt ? ` — scheduled ${input.scheduledAt}` : ''}`,
      route: `/projects/${input.projectId}/inspections/${inspectionId}`,
      type: 'inspection_assigned',
      entityType: 'inspection',
      entityId: inspectionId,
    })
  }

  revalidatePath(`/projects/${input.projectId}/inspections`)
  return inspectionId
}

// ─── updateInspectionAssignmentAction ───────────────────────────────────────

export interface UpdateInspectionAssignmentInput {
  inspectionId: string
  projectId: string
  organisationId: string
  assignedToId: string | null // Inspector — optional (may be unassigned)
  verifierId: string // Verifier — required (mirrors create)
}

/**
 * Reassign an existing inspection's Inspector + Verifier. Allowed at ANY status
 * (per design 2026-06-02). PM+ only — identical gate to createInspectionAction.
 * Notifies the new Inspector only when they actually changed and aren't the actor.
 */
export async function updateInspectionAssignmentAction(
  input: UpdateInspectionAssignmentInput,
): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const user = await requirePmOrAbove(supabase, input.organisationId)
  await requireFeature(input.organisationId, 'inspections', supabase)

  // Read the current assignee to decide whether a notification is warranted.
  const { data: current } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('assigned_to_id')
    .eq('id', input.inspectionId)
    .single()
  const previousAssignee = (current as { assigned_to_id: string | null } | null)?.assigned_to_id ?? null

  const { error } = await supabase
    .schema('inspections')
    .from('inspections')
    .update({ assigned_to_id: input.assignedToId, verifier_id: input.verifierId })
    .eq('id', input.inspectionId)
  if (error) throw error

  if (
    input.assignedToId &&
    input.assignedToId !== previousAssignee &&
    input.assignedToId !== user.id
  ) {
    await dispatchNotification({
      userIds: [input.assignedToId],
      title: 'Inspection assigned to you',
      body: 'You are now the inspector on this inspection.',
      route: `/projects/${input.projectId}/inspections/${input.inspectionId}`,
      type: 'inspection_assigned',
      entityType: 'inspection',
      entityId: input.inspectionId,
    })
  }

  revalidatePath(`/projects/${input.projectId}/inspections/${input.inspectionId}`)
  revalidatePath(`/projects/${input.projectId}/inspections`)
}

// ─── listInspectionsAction ──────────────────────────────────────────────

export async function listInspectionsAction(
  projectId: string,
  filters?: { status?: string },
) {
  const supabase = (await createClient()) as AnyClient
  let query = supabase
    .schema('inspections')
    .from('inspections')
    .select(
      'id, target_label, target_node_type, status, overall_result, coc_number, scheduled_at, started_at, certified_at, template_id, verifier_id, assigned_to_id',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  const { data, error } = await query
  if (error) throw error

  const items =
    (data as Array<{
      id: string
      target_label: string
      target_node_type: string
      status: string
      overall_result: string | null
      coc_number: string | null
      scheduled_at: string | null
      started_at: string | null
      certified_at: string | null
      template_id: string
      verifier_id: string | null
      assigned_to_id: string | null
    }> | null) ?? []

  if (items.length === 0) return []

  // Hydrate template + user names (cross-schema joins via embed are unreliable).
  const templateIds = [...new Set(items.map((i) => i.template_id))]
  const userIds = [
    ...new Set(
      items
        .flatMap((i) => [i.verifier_id, i.assigned_to_id])
        .filter((v): v is string => Boolean(v)),
    ),
  ]

  // The inspections SELECT above is RLS-gated — returned rows prove project
  // access, so resolving assignee/verifier names via the service client here is
  // safe (cookie client can't read other users' profiles; see 00009).
  const service = createServiceClient() as AnyClient
  const [{ data: templates }, { data: profiles }] = await Promise.all([
    templateIds.length
      ? supabase
          .schema('inspections')
          .from('templates')
          .select('id, name, deliverable_type')
          .in('id', templateIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; deliverable_type: string }> }),
    userIds.length
      ? service.from('profiles').select('id, full_name, email').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }),
  ])

  const templateMap = new Map(
    ((templates ?? []) as Array<{ id: string; name: string; deliverable_type: string }>).map((t) => [t.id, t]),
  )
  const userMap = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]),
  )

  return items.map((i) => ({
    ...i,
    template: templateMap.get(i.template_id) ?? null,
    verifier: i.verifier_id ? userMap.get(i.verifier_id) ?? null : null,
    assigned_to: i.assigned_to_id ? userMap.get(i.assigned_to_id) ?? null : null,
  }))
}

// ─── upsertResponseAction ───────────────────────────────────────────────

export interface UpsertResponseInput {
  inspectionId: string
  sectionId: string
  fieldId: string
  value: {
    value_bool?: boolean | null
    value_number?: number | null
    value_text?: string | null
    value_array?: string[] | null
    value_json?: unknown
    pass_state?: 'pass' | 'fail' | 'na' | 'not_checked'
    fail_reason?: string | null
  }
}

export async function upsertResponseAction(input: UpsertResponseInput): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  const { error } = await supabase
    .schema('inspections')
    .from('responses')
    .upsert(
      {
        inspection_id: input.inspectionId,
        section_id: input.sectionId,
        field_id: input.fieldId,
        ...input.value,
        latest_responded_by: user.id,
        latest_responded_at: new Date().toISOString(),
      },
      { onConflict: 'inspection_id,section_id,field_id' },
    )

  if (error) throw error
}

// ─── deleteRepeatingGroupEntryAction ────────────────────────────────────

/**
 * Hard-delete every response row for a single entry of a repeating_group.
 * Synthetic field_id pattern: `<group_field_id>[<index>].<sub_field_id>`.
 *
 * Used by the web/mobile UIs when the user removes an entry from a repeating
 * group. Photos/signatures uploaded under the synthetic field_id are NOT
 * cascade-deleted here in v1 — the storage rows simply orphan (RLS still
 * scopes them per inspection, so they're invisible to the renderer and the
 * PDF appendix). A follow-up GC sweep can clean them up if needed.
 */
export async function deleteRepeatingGroupEntryAction(input: {
  inspectionId: string
  sectionId: string
  groupFieldId: string
  index: number
}): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  // Use a LIKE filter to match every sub-field response for this entry.
  // The synthetic pattern guarantees `<group>[<index>].` uniquely scopes
  // the entry — different indices/groups don't collide.
  const prefix = `${input.groupFieldId}[${input.index}].`
  const { error } = await supabase
    .schema('inspections')
    .from('responses')
    .delete()
    .eq('inspection_id', input.inspectionId)
    .eq('section_id', input.sectionId)
    .like('field_id', `${prefix}%`)

  if (error) throw error
}

// ─── submitInspectionAction ─────────────────────────────────────────────

/**
 * Move an inspection from in_progress (or re-inspect_required) to
 * awaiting_verification and notify the assigned verifier.
 */
export async function submitInspectionAction(
  inspectionId: string,
  projectId: string,
): Promise<void> {
  const supabase = (await createClient()) as AnyClient

  const { error } = await supabase
    .schema('inspections')
    .from('inspections')
    .update({ status: 'awaiting_verification', completed_at: new Date().toISOString() })
    .eq('id', inspectionId)
    .in('status', ['in_progress', 're-inspect_required'])
  if (error) throw error

  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('verifier_id, target_label')
    .eq('id', inspectionId)
    .single()

  const verifierId = (insp as { verifier_id: string | null } | null)?.verifier_id ?? null
  const targetLabel = (insp as { target_label: string } | null)?.target_label ?? 'inspection'

  if (verifierId) {
    await dispatchNotification({
      userIds: [verifierId],
      title: 'Inspection awaiting your verification',
      body: `"${targetLabel}" is ready for sign-off`,
      route: `/projects/${projectId}/inspections/${inspectionId}`,
      type: 'inspection_awaiting_verification',
      entityType: 'inspection',
      entityId: inspectionId,
    })
  }

  revalidatePath(`/projects/${projectId}/inspections/${inspectionId}`)
  revalidatePath(`/projects/${projectId}/inspections`)
}

// ─── abandonInspectionAction ────────────────────────────────────────────

/**
 * Cancel an in-flight inspection. Reason required (audit trail). Only
 * PM-or-above on the parent org may abandon.
 *
 * Returns { ok: true } on success or { ok: false, error: string } on failure
 * so the client can surface the error without throwing.
 */
export async function abandonInspectionAction(
  inspectionId: string,
  projectId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'Reason is required' }
  }

  try {
    const supabase = (await createClient()) as AnyClient
    const orgId = await getOrgIdForProject(supabase, projectId)
    const user = await requirePmOrAbove(supabase, orgId)
    await requireFeature(orgId, 'inspections', supabase)

    // Fetch inspection to validate status and collect notification recipients.
    const { data: insp } = await supabase
      .schema('inspections')
      .from('inspections')
      .select('id, status, target_label, assigned_to_id, verifier_id, organisation_id')
      .eq('id', inspectionId)
      .single()

    if (!insp) return { ok: false, error: 'Inspection not found' }

    const inspection = insp as {
      id: string
      status: string
      target_label: string
      assigned_to_id: string | null
      verifier_id: string | null
      organisation_id: string
    }

    if (['certified', 'abandoned'].includes(inspection.status)) {
      return {
        ok: false,
        error: `Cannot abandon an inspection with status "${inspection.status}"`,
      }
    }

    const { error } = await supabase
      .schema('inspections')
      .from('inspections')
      .update({
        status: 'abandoned',
        abandoned_at: new Date().toISOString(),
        abandoned_by: user.id,
        abandoned_reason: reason.trim(),
      })
      .eq('id', inspectionId)

    if (error) return { ok: false, error: error.message }

    // Best-effort notification to assignee + verifier (skip self-notifications).
    const notifyIds = [
      ...new Set(
        [inspection.assigned_to_id, inspection.verifier_id]
          .filter((id): id is string => Boolean(id) && id !== user.id),
      ),
    ]
    if (notifyIds.length > 0) {
      try {
        await dispatchNotification({
          userIds: notifyIds,
          title: 'Inspection abandoned',
          body: `"${inspection.target_label}" was marked abandoned: ${reason.trim().slice(0, 100)}`,
          route: `/projects/${projectId}/inspections/${inspectionId}`,
          type: 'inspection_abandoned',
          entityType: 'inspection',
          entityId: inspectionId,
        })
      } catch {
        // Notification failure is non-fatal.
      }
    }

    revalidatePath(`/projects/${projectId}/inspections/${inspectionId}`)
    revalidatePath(`/projects/${projectId}/inspections`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── deleteInspectionAction ──────────────────────────────────────────────

/**
 * Permanently hard-delete an inspection and all child rows (responses,
 * photos, signatures, certificates, response_history). Cascades are wired
 * in the DB schema via FK ON DELETE CASCADE.
 *
 * Gated: owner role only. Blocked if status='certified' (legal document).
 * Type-to-confirm: caller must pass the exact string
 * `delete-inspection-{id.slice(0,8)}` as confirmText.
 */
export async function deleteInspectionAction(
  inspectionId: string,
  projectId: string,
  confirmText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expectedConfirm = `delete-inspection-${inspectionId.slice(0, 8)}`
  if (confirmText !== expectedConfirm) {
    return { ok: false, error: 'Confirmation text does not match' }
  }

  try {
    const supabase = (await createClient()) as AnyClient
    const orgId = await getOrgIdForProject(supabase, projectId)
    await requireFeature(orgId, 'inspections', supabase)

    // Owner only.
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')
    const { data: membership } = await supabase
      .from('user_organisations')
      .select('role')
      .eq('user_id', user.id)
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .single()
    if (!membership || membership.role !== 'owner') {
      return { ok: false, error: 'Only the organisation owner can delete inspections' }
    }

    // Fetch to validate status.
    const { data: insp } = await supabase
      .schema('inspections')
      .from('inspections')
      .select('id, status')
      .eq('id', inspectionId)
      .single()

    if (!insp) return { ok: false, error: 'Inspection not found' }

    if ((insp as { status: string }).status === 'certified') {
      return {
        ok: false,
        error: 'Certified inspections are legal documents and cannot be deleted',
      }
    }

    // Hard-delete via raw PostgREST with the service-role key. supabase-js's
    // .schema('inspections').from('inspections').delete() runs under the
    // caller's RLS context, and inspections.inspections has no DELETE policy —
    // so the delete silently matches 0 rows and returns no error. Same fix
    // pattern as the inspection upload routes (commit bd0b0dc). Owner-only and
    // not-certified are already enforced above, so bypassing RLS is safe here.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceKey || !supabaseUrl) {
      return { ok: false, error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' }
    }

    const delRes = await fetch(
      `${supabaseUrl}/rest/v1/inspections?id=eq.${encodeURIComponent(inspectionId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Profile': 'inspections',
          Prefer: 'return=representation',
        },
      },
    )

    if (!delRes.ok) {
      const errText = await delRes.text()
      return {
        ok: false,
        error: `Delete failed (HTTP ${delRes.status}): ${errText.slice(0, 300)}`,
      }
    }

    // return=representation echoes the deleted rows — verify one was actually
    // removed so the action can never again report a false success.
    const deletedRows = (await delRes.json()) as Array<{ id: string }>
    if (deletedRows.length === 0) {
      return {
        ok: false,
        error: 'Delete removed no rows — the inspection may have already been deleted.',
      }
    }

    revalidatePath(`/projects/${projectId}/inspections`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
