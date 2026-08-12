'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  projectService,
  ORG_WRITE_ROLES,
  FORMS_FIELD_ROLES,
  buildGateInput,
  evaluateSubmitGates,
  type GateIssue,
  type GateResponseRow,
} from '@esite/shared'
import type { OrgRole } from '@esite/shared'

// `use server` files may only export async functions, so everything below that
// is not an action stays module-private.
//
// The `field` schema is not in the generated DB types (same as `inspections`),
// so the client is cast per the house convention rather than fighting the
// generated row types.
type AnyClient = SupabaseClient<any, any, any>

const uuid = z.string().uuid()

const createInputSchema = z
  .object({
    projectId: uuid,
    templateRowId: uuid,
    nodeId: uuid.nullable().optional(),
    boardRef: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (v) => Boolean(v.nodeId) || Boolean(v.boardRef && v.boardRef.trim() !== ''),
    // Mirrors the site_forms_board_identified CHECK, so the user gets a real
    // message instead of a raw constraint violation.
    {
      message:
        'Select a board, or enter a board reference if it is not in the project structure yet.',
    },
  )

const responseInputSchema = z.object({
  formId: uuid,
  projectId: uuid,
  sectionId: z.string().min(1).max(100),
  fieldId: z.string().min(1).max(200),
  valueBool: z.boolean().nullable().optional(),
  valueNumber: z.number().finite().nullable().optional(),
  valueText: z.string().max(20000).nullable().optional(),
  valueArray: z.array(z.string().max(500)).max(200).nullable().optional(),
  passState: z.enum(['pass', 'fail', 'na', 'not_checked']).nullable().optional(),
  failReason: z.string().max(2000).nullable().optional(),
})

type Guarded =
  | { ok: false; error: string }
  | { ok: true; supabase: AnyClient; orgId: string; userId: string }

/**
 * Resolve project → org, verify auth, enforce the role gate.
 *
 * requireEffectiveRole honours per-project promotion, so a contractor promoted
 * to project_manager on this project is treated as one.
 */
async function guardProject(
  projectId: string,
  roles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<Guarded> {
  const supabase = (await createClient()) as unknown as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { ok: false, error: 'Project not found' }

  const gate = await requireEffectiveRole(supabase as never, projectId, roles)
  if (!gate.ok) return { ok: false, error: gate.error }

  return {
    ok: true,
    supabase,
    orgId: (project as { organisation_id: string }).organisation_id,
    userId: user.id,
  }
}

type FormLookup =
  | { ok: false; error: string }
  | { ok: true; status: string; templateRowId: string }

/**
 * Confirm the form belongs to the project being acted on.
 *
 * Some paths below use the service client, which bypasses RLS, so the project
 * link is proven rather than assumed — otherwise a valid form id from another
 * project would be actionable by anyone holding a role here.
 */
async function guardFormBelongsToProject(
  formId: string,
  projectId: string,
): Promise<FormLookup> {
  const service = createServiceClient() as unknown as AnyClient
  const { data, error } = await service
    .schema('field')
    .from('site_forms')
    .select('id, status, template_row_id, project_id')
    .eq('id', formId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) {
    return { ok: false, error: (error as { message?: string }).message ?? 'Could not load the form' }
  }
  if (!data) return { ok: false, error: 'Form not found on this project' }

  const row = data as { status: string; template_row_id: string }
  return { ok: true, status: row.status, templateRowId: row.template_row_id }
}

function msg(e: unknown, fallback: string): string {
  return (e as { message?: string } | null)?.message ?? fallback
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listFormTemplatesAction(): Promise<
  | { error: string; templates?: undefined }
  | {
      error?: undefined
      templates: { id: string; name: string; version: string; templateKey: string }[]
    }
> {
  const supabase = (await createClient()) as unknown as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // RLS on form_templates already scopes this to system templates plus the
  // caller's own organisations.
  const { data, error } = await supabase
    .schema('field')
    .from('form_templates')
    .select('id, name, version, template_key')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return { error: msg(error, 'Could not load templates') }

  const rows = (data ?? []) as {
    id: string
    name: string
    version: string
    template_key: string
  }[]
  return {
    templates: rows.map((t) => ({
      id: t.id,
      name: t.name,
      version: t.version,
      templateKey: t.template_key,
    })),
  }
}

export async function listProjectFormsAction(
  projectId: string,
): Promise<{ error: string; forms?: undefined } | { error?: undefined; forms: unknown[] }> {
  if (!uuid.safeParse(projectId).success) return { error: 'Invalid project id' }

  const supabase = (await createClient()) as unknown as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // No explicit role gate here: the site_forms SELECT policy is the gate, and
  // it deliberately shows client_viewer only distributed forms.
  const { data, error } = await supabase
    .schema('field')
    .from('site_forms')
    .select(
      'id, form_no, node_id, board_ref, board_label, status, as_left_status, created_at, submitted_at, distributed_at, created_by, template_row_id',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) return { error: msg(error, 'Could not load forms') }
  return { forms: (data ?? []) as unknown[] }
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createSiteFormAction(
  input: z.infer<typeof createInputSchema>,
): Promise<
  | { error: string; formId?: undefined; formNo?: undefined }
  | { error?: undefined; formId: string; formNo: string | null }
> {
  const parsed = createInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { projectId, templateRowId, nodeId, boardRef } = parsed.data

  const guard = await guardProject(projectId, FORMS_FIELD_ROLES)
  if (!guard.ok) return { error: guard.error }

  // Resolve the as-found board name from the structure tree when a node was
  // picked. Stored alongside node_id rather than derived at read time: the
  // board may later be renamed or deleted, and this record must still say
  // which board it described.
  let boardLabel: string | null = null
  if (nodeId) {
    const { data: node } = await guard.supabase
      .schema('structure')
      .from('nodes')
      .select('id, code, name, project_id')
      .eq('id', nodeId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!node) return { error: 'That board does not belong to this project' }
    const n = node as { code: string; name: string | null }
    boardLabel = n.name ? `${n.code} — ${n.name}` : n.code
  }

  const { data: created, error: insertError } = await guard.supabase
    .schema('field')
    .from('site_forms')
    .insert({
      organisation_id: guard.orgId,
      project_id: projectId,
      template_row_id: templateRowId,
      node_id: nodeId ?? null,
      board_ref: boardRef?.trim() || null,
      board_label: boardLabel,
      status: 'draft',
      created_by: guard.userId,
    })
    .select('id')
    .single()

  if (insertError || !created) return { error: msg(insertError, 'Could not create the form') }
  const formId = (created as { id: string }).id

  // allocate_form_no is granted to service_role only, so the number is stamped
  // with the service client. A failure here is not fatal: the form exists and
  // can be numbered on a later save rather than losing the user's work.
  let formNo: string | null = null
  try {
    const service = createServiceClient() as unknown as AnyClient
    const { data: no } = await service
      .schema('field')
      .rpc('allocate_form_no', { p_form_id: formId, p_prefix: 'TMS' })
    if (typeof no === 'string') {
      formNo = no
      await service.schema('field').from('site_forms').update({ form_no: no }).eq('id', formId)
    }
  } catch {
    // Deliberately swallowed; see above.
  }

  revalidatePath(`/projects/${projectId}/forms`)
  return { formId, formNo }
}

// ─── Capture ─────────────────────────────────────────────────────────────────

export async function upsertFormResponseAction(
  input: z.infer<typeof responseInputSchema>,
): Promise<{ error: string; ok?: undefined } | { error?: undefined; ok: true }> {
  const parsed = responseInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const v = parsed.data

  const guard = await guardProject(v.projectId, FORMS_FIELD_ROLES)
  if (!guard.ok) return { error: guard.error }

  const belongs = await guardFormBelongsToProject(v.formId, v.projectId)
  if (!belongs.ok) return { error: belongs.error }
  if (belongs.status !== 'draft') {
    return { error: `This form is ${belongs.status} and can no longer be edited.` }
  }

  // Written with the caller's own client, so RLS (user_can_write_form) is a
  // second, independent gate on the draft-only write window.
  const { error } = await guard.supabase
    .schema('field')
    .from('form_responses')
    .upsert(
      {
        form_id: v.formId,
        section_id: v.sectionId,
        field_id: v.fieldId,
        value_bool: v.valueBool ?? null,
        value_number: v.valueNumber ?? null,
        value_text: v.valueText ?? null,
        value_array: v.valueArray ?? null,
        pass_state: v.passState ?? null,
        fail_reason: v.failReason ?? null,
        latest_responded_by: guard.userId,
        latest_responded_at: new Date().toISOString(),
      },
      { onConflict: 'form_id,section_id,field_id' },
    )

  if (error) return { error: msg(error, 'Could not save') }
  return { ok: true }
}

// ─── Submit ──────────────────────────────────────────────────────────────────

export async function submitSiteFormAction(
  formId: string,
  projectId: string,
): Promise<
  | { error: string; issues?: undefined; ok?: undefined }
  | { error?: undefined; issues: GateIssue[]; ok?: undefined }
  | { error?: undefined; issues?: undefined; ok: true }
> {
  if (!uuid.safeParse(formId).success || !uuid.safeParse(projectId).success) {
    return { error: 'Invalid id' }
  }

  const guard = await guardProject(projectId, FORMS_FIELD_ROLES)
  if (!guard.ok) return { error: guard.error }

  const belongs = await guardFormBelongsToProject(formId, projectId)
  if (!belongs.ok) return { error: belongs.error }
  if (belongs.status !== 'draft') return { error: `This form is already ${belongs.status}.` }

  const { data: rows, error: readError } = await guard.supabase
    .schema('field')
    .from('form_responses')
    .select('section_id, field_id, value_bool, value_number, value_text, value_array')
    .eq('form_id', formId)

  if (readError) return { error: msg(readError, 'Could not load responses') }

  const responses = ((rows ?? []) as unknown) as GateResponseRow[]
  const today = new Date().toISOString().slice(0, 10)
  const issues = evaluateSubmitGates(buildGateInput(responses, today))

  // Return the whole issue list rather than submitting partially — a form that
  // fails a legal gate must not enter the record in any state.
  if (issues.length > 0) return { issues }

  const asLeft =
    responses.find(
      (r) => r.section_id === 'handover_status' && r.field_id === 'as_left_status',
    )?.value_text ?? null

  const { error: updateError } = await guard.supabase
    .schema('field')
    .from('site_forms')
    .update({
      status: 'submitted',
      as_left_status: asLeft,
      submitted_by: guard.userId,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', formId)
    .eq('project_id', projectId)
    .eq('status', 'draft')

  if (updateError) return { error: msg(updateError, 'Could not submit the form') }

  revalidatePath(`/projects/${projectId}/forms`)
  revalidatePath(`/projects/${projectId}/forms/${formId}`)
  return { ok: true }
}

// ─── Void ────────────────────────────────────────────────────────────────────

export async function voidSiteFormAction(
  formId: string,
  projectId: string,
  reason: string,
): Promise<{ error: string; ok?: undefined } | { error?: undefined; ok: true }> {
  if (!uuid.safeParse(formId).success || !uuid.safeParse(projectId).success) {
    return { error: 'Invalid id' }
  }
  const trimmed = (reason ?? '').trim()
  if (trimmed.length < 5) {
    return { error: 'Give a reason for voiding this record (at least 5 characters).' }
  }

  // Voiding is a management action: a distributed record has already gone to
  // the project team, and withdrawing it is not a field-level decision.
  const guard = await guardProject(projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const belongs = await guardFormBelongsToProject(formId, projectId)
  if (!belongs.ok) return { error: belongs.error }
  if (belongs.status === 'void') return { error: 'This form is already void.' }

  const { error } = await guard.supabase
    .schema('field')
    .from('site_forms')
    .update({ status: 'void', void_reason: trimmed })
    .eq('id', formId)
    .eq('project_id', projectId)

  if (error) return { error: msg(error, 'Could not void the form') }

  revalidatePath(`/projects/${projectId}/forms`)
  revalidatePath(`/projects/${projectId}/forms/${formId}`)
  return { ok: true }
}
