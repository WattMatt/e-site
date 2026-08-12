'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { gatherPrefill } from '@/lib/site-forms/prefill-sources'
import {
  projectService,
  ORG_WRITE_ROLES,
  FORMS_FIELD_ROLES,
  buildGateInput,
  evaluateSubmitGates,
  evaluateInspection,
  SITE_FORM_SIGNATURE_FIELD_BLOCKS,
  type GateIssue,
  type GateResponseRow,
} from '@esite/shared'
import type { OrgRole, Template } from '@esite/shared'

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
    // Board to read the cable schedule from, when this board is not itself in
    // it. Defaults to nodeId.
    cableScheduleNodeId: uuid.nullable().optional(),
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

/**
 * Completeness check, run server-side at submit.
 *
 * The legal gates in `evaluateSubmitGates` answer "is this record lawful"; this
 * answers "is this record finished". Both must hold. Enforcing only the gates
 * allowed a form with three answered fields to be submitted and then read as
 * complete everywhere downstream.
 *
 * Delegates to the shared engine so visibility rules (`conditional_on`) are
 * honoured — a hidden field is not missing.
 */
async function missingRequiredIssues(
  supabase: AnyClient,
  formId: string,
  templateRowId: string,
  responses: GateResponseRow[],
): Promise<GateIssue[]> {
  const { data: tpl } = await supabase
    .schema('field')
    .from('form_templates')
    .select('schema_json')
    .eq('id', templateRowId)
    .maybeSingle()

  const template = (tpl as { schema_json?: unknown } | null)?.schema_json as Template | undefined
  if (!template?.sections) return []

  const [{ data: photoRows }, { data: sigRows }] = await Promise.all([
    supabase.schema('field').from('form_photos').select('section_id, field_id').eq('form_id', formId),
    supabase.schema('field').from('form_signatures').select('block_id').eq('form_id', formId),
  ])

  // The engine keys signatures by (section_id, field_id); we store them by
  // block_id. Translate through the single shared map, or a signed block would
  // read as unsigned and the form could never be submitted.
  const blockToField = new Map<string, string>()
  for (const [fieldId, block] of Object.entries(SITE_FORM_SIGNATURE_FIELD_BLOCKS)) {
    blockToField.set(block, fieldId)
  }
  const sectionOfField = new Map<string, string>()
  const labelOfField = new Map<string, string>()
  for (const section of template.sections) {
    for (const f of section.fields ?? []) {
      sectionOfField.set(f.field_id, section.section_id)
      labelOfField.set(f.field_id, f.label ?? f.field_id)
      for (const sub of f.fields ?? []) labelOfField.set(sub.field_id, sub.label ?? sub.field_id)
    }
  }

  const signatures = ((sigRows ?? []) as { block_id: string }[])
    .map((s) => blockToField.get(s.block_id))
    .filter((fieldId): fieldId is string => Boolean(fieldId))
    .map((fieldId) => ({ section_id: sectionOfField.get(fieldId), field_id: fieldId }))

  const result = evaluateInspection(template, responses as never, {
    photos: (photoRows ?? []) as { section_id: string; field_id: string }[],
    signatures,
  })

  if (result.missingRequired.length === 0) return []

  // Grouped by section: 180 individual issues would be unreadable, and the
  // capture UI deep-links by sectionId anyway.
  const bySection = new Map<string, string[]>()
  for (const m of result.missingRequired) {
    const list = bySection.get(m.sectionId) ?? []
    // Strip the repeating-group prefix so the user sees the sub-field's name.
    const bare = m.fieldId.replace(/^[a-z0-9_]+\[\d+\]\./, '')
    list.push(labelOfField.get(bare) ?? bare)
    bySection.set(m.sectionId, list)
  }

  return [...bySection.entries()].map(([sectionId, fields]) => {
    const shown = [...new Set(fields)].slice(0, 6)
    const more = fields.length - shown.length
    return {
      code: 'missing_required',
      sectionId,
      message:
        `${fields.length} required answer${fields.length === 1 ? '' : 's'} still outstanding: ` +
        shown.join(', ') +
        (more > 0 ? `, and ${more} more` : '') +
        '.',
    }
  })
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
  const { projectId, templateRowId, nodeId, boardRef, cableScheduleNodeId } = parsed.data

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

  // Pre-populate from what the project already knows. Best-effort by design:
  // the form exists and is usable even if every lookup fails, so a prefill
  // error must never lose the user their new form.
  try {
    const prefill = await gatherPrefill(guard.supabase, {
      projectId,
      nodeId: nodeId ?? null,
      cableScheduleNodeId: cableScheduleNodeId ?? nodeId ?? null,
      userId: guard.userId,
      formNo,
    })
    if (prefill.length > 0) {
      await guard.supabase
        .schema('field')
        .from('form_responses')
        .upsert(
          prefill.map((r) => ({
            form_id: formId,
            section_id: r.sectionId,
            field_id: r.fieldId,
            value_text: r.valueText ?? null,
            value_number: r.valueNumber ?? null,
            latest_responded_by: guard.userId,
            latest_responded_at: new Date().toISOString(),
            prefilled_from: r.source,
          })),
          { onConflict: 'form_id,section_id,field_id' },
        )
    }
  } catch (e) {
    console.error('[createSiteFormAction] prefill failed', e)
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
        // Clearing this is the point: NULL means a person entered the value.
        // A prefilled answer that someone then edited is no longer inherited.
        prefilled_from: null,
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
    .select('section_id, field_id, value_bool, value_number, value_text, value_array, pass_state')
    .eq('form_id', formId)

  if (readError) return { error: msg(readError, 'Could not load responses') }

  const responses = ((rows ?? []) as unknown) as GateResponseRow[]
  const today = new Date().toISOString().slice(0, 10)
  const issues = evaluateSubmitGates(buildGateInput(responses, today))

  // Required-field completeness is enforced HERE, not only in the UI. Without
  // it, three taps on the prove-test-prove steps produced a `submitted` record
  // with no handover state, no instruments, no circuits and no signatures --
  // which then read as complete to the list page, the PDF and the email.
  const missing = await missingRequiredIssues(
    guard.supabase,
    formId,
    belongs.templateRowId,
    responses,
  )

  // Return the whole list rather than submitting partially: a form that fails a
  // legal gate or is incomplete must not enter the record in any state.
  const all = [...issues, ...missing]
  if (all.length > 0) return { issues: all }

  const asLeft =
    responses.find(
      (r) => r.section_id === 'handover_status' && r.field_id === 'as_left_status',
    )?.value_text ?? null

  // .select() so we can count affected rows. Without it PostgREST returns
  // error: null when the predicate matched nothing, and the caller would tell
  // the user the form was submitted while the row sat untouched -- and with
  // as_left_status never written, which the distribution email then reads.
  const { data: updated, error: updateError } = await guard.supabase
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
    .select('id')

  if (updateError) return { error: msg(updateError, 'Could not submit the form') }
  if (!Array.isArray(updated) || updated.length === 0) {
    // Lost the race: someone else submitted or voided this form first.
    return { error: 'This form is no longer a draft — reload to see its current state.' }
  }

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

  const { data: voided, error } = await guard.supabase
    .schema('field')
    .from('site_forms')
    .update({ status: 'void', void_reason: trimmed })
    .eq('id', formId)
    .eq('project_id', projectId)
    .neq('status', 'void')
    .select('id')

  if (error) return { error: msg(error, 'Could not void the form') }
  if (!Array.isArray(voided) || voided.length === 0) {
    return { error: 'This form could not be voided — reload to see its current state.' }
  }

  revalidatePath(`/projects/${projectId}/forms`)
  revalidatePath(`/projects/${projectId}/forms/${formId}`)
  return { ok: true }
}
