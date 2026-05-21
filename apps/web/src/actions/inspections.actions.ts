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
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'
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
      .eq('project_id', revProjectId),
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
  const supabase = (await createClient()) as AnyClient

  const { data: rows } = await supabase
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('is_active', true)

  const members = (rows as Array<{ user_id: string }> | null) ?? []
  if (members.length === 0) {
    return [] as Array<{ user_id: string; full_name: string | null; email: string | null; role: string | null }>
  }

  const userIds = members.map((m) => m.user_id)
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').in('id', userIds),
    supabase.from('user_organisations').select('user_id, role').in('user_id', userIds).eq('is_active', true),
  ])

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p as { id: string; full_name: string | null; email: string | null }]),
  )
  const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]))

  return members.map((m) => {
    const p = profileMap.get(m.user_id)
    return {
      user_id: m.user_id,
      full_name: p?.full_name ?? null,
      email: p?.email ?? null,
      role: roleMap.get(m.user_id) ?? null,
    }
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

/** Template_ids whose schema carries the `sub_feeds` repeating_group. */
const SUB_FEED_TEMPLATE_IDS = ['fat-inspection-report', 'electrical-main-board-inspection']

/**
 * Pre-create one `sub_feeds` repeating_group entry per outgoing sub-feed of a
 * board, read from the current cable-schedule revision. Seeding one
 * `feed_label` response row per index materialises that entry in the capture
 * UI (synthetic field_id `<group>[<index>].<sub_field>`); the inspector then
 * fills the breaker / meter / CT fields. Best-effort — the caller wraps this
 * in try/catch so a failure never blocks inspection creation.
 */
async function prePopulateSubFeeds(
  supabase: AnyClient,
  args: {
    inspectionId: string
    projectId: string
    templateRowId: string
    boardNodeId: string
    userId: string
  },
): Promise<void> {
  // Only FAT / EMB templates define the sub_feeds repeating_group.
  const { data: tpl } = await supabase
    .schema('inspections')
    .from('templates')
    .select('template_id')
    .eq('id', args.templateRowId)
    .single()
  const templateKey = (tpl as { template_id: string } | null)?.template_id
  if (!templateKey || !SUB_FEED_TEMPLATE_IDS.includes(templateKey)) return

  const revisionId = await getCurrentRevisionId(supabase, args.projectId)
  if (!revisionId) return

  // Outgoing sub-feeds: supplies leaving this board node.
  const { data: supplies } = await supabase
    .schema('cable_schedule')
    .from('supplies')
    .select('to_node_id')
    .eq('revision_id', revisionId)
    .eq('from_node_id', args.boardNodeId)

  const destIds = [
    ...new Set(
      ((supplies as Array<{ to_node_id: string | null }> | null) ?? [])
        .map((s) => s.to_node_id)
        .filter((v): v is string => Boolean(v)),
    ),
  ]
  if (destIds.length === 0) return

  // Resolve each destination's label from structure.nodes.
  const { data: nodes } = await supabase
    .schema('structure')
    .from('nodes')
    .select('id, code, name')
    .in('id', destIds)
  const labelOf = new Map(
    ((nodes as Array<{ id: string; code: string; name: string | null }> | null) ?? []).map(
      (n) => [n.id, n.name || n.code],
    ),
  )
  const labels = destIds.map((id) => labelOf.get(id) ?? id).sort((a, b) => a.localeCompare(b))

  // One feed_label response row per index materialises that repeating_group entry.
  const now = new Date().toISOString()
  const rows = labels.map((label, i) => ({
    inspection_id: args.inspectionId,
    section_id: 'sub_feed_capture',
    field_id: `sub_feeds[${i}].feed_label`,
    value_text: label,
    latest_responded_by: args.userId,
    latest_responded_at: now,
  }))
  const { error } = await supabase.schema('inspections').from('responses').insert(rows)
  if (error) throw error
}

export async function createInspectionAction(input: CreateInspectionInput): Promise<string> {
  const supabase = (await createClient()) as AnyClient
  const user = await requirePmOrAbove(supabase, input.organisationId)

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

  // Pre-populate per-sub-feed capture groups for FAT/EMB inspections on a
  // board. Best-effort — a failure here must never block inspection creation.
  if (input.targetNodeType === 'board' && input.targetNodeId) {
    try {
      await prePopulateSubFeeds(supabase, {
        inspectionId,
        projectId: input.projectId,
        templateRowId: input.templateId,
        boardNodeId: input.targetNodeId,
        userId: user.id,
      })
    } catch (e) {
      console.error('[createInspectionAction] sub-feed pre-population failed:', e)
    }
  }

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

  const [{ data: templates }, { data: profiles }] = await Promise.all([
    templateIds.length
      ? supabase
          .schema('inspections')
          .from('templates')
          .select('id, name, deliverable_type')
          .in('id', templateIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; deliverable_type: string }> }),
    userIds.length
      ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
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
