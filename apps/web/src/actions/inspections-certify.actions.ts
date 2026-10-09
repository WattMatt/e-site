'use server'

/**
 * Verifier-side state transitions for inspections: certify (with COC# or
 * auto-allocated INS/FAT) and send-back-for-reinspection.
 *
 * `inspections` schema is not in the generated DB types — supabase client
 * cast to `any` per Phase-4 convention.
 *
 * The rules live in the database (migration 00235): the transition guard on
 * inspections.inspections decides who may make each move, and
 * inspections.certification_blockers() holds the certification rules
 * (assigned verifier, separate verifier, signature qualifications, CoC
 * number). These actions ask the same function first only to show its
 * sentence; a direct PostgREST PATCH meets the same guard.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'
import { requireFeature } from '@/lib/features'
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'
import { evaluateInspection, type Response as InspectionResponse, type Template } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the user_ids of all distinct contributors to an inspection,
 * read from response_history (history-of-truth, captures every save).
 */
async function getInspectionContributors(
  supabase: AnyClient,
  inspectionId: string,
): Promise<string[]> {
  const { data } = await supabase
    .schema('inspections')
    .from('response_history')
    .select('responded_by')
    .eq('inspection_id', inspectionId)
  return [
    ...new Set(
      ((data ?? []) as Array<{ responded_by: string }>)
        .map((r) => r.responded_by)
        .filter(Boolean),
    ),
  ]
}

/**
 * Returns the user_ids of project_members whose org-level role is
 * owner / admin / project_manager. Two-step query because PostgREST embed
 * across `projects` and `public` schemas is unreliable (PGRST200 — see
 * Session 22 cable-schedule notes).
 */
async function getProjectManagerIds(
  supabase: AnyClient,
  projectId: string,
): Promise<string[]> {
  const { data: members } = await supabase
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
  const memberIds = ((members ?? []) as Array<{ user_id: string }>)
    .map((m) => m.user_id)
    .filter(Boolean)
  if (memberIds.length === 0) return []

  const { data: roles } = await supabase
    .from('user_organisations')
    .select('user_id, role')
    .in('user_id', memberIds)
  return ((roles ?? []) as Array<{ user_id: string; role: string }>)
    .filter((r) => ['owner', 'admin', 'project_manager'].includes(r.role))
    .map((r) => r.user_id)
}

/**
 * The overall result the engine computes from what was saved: answers, photos and signatures,
 * the same inputs the capture form evaluates.
 */
async function computeOverallResult(
  supabase: AnyClient,
  inspectionId: string,
  template: Template,
): Promise<'pass' | 'fail' | 'conditional_pass'> {
  const db = supabase.schema('inspections')
  const [responses, photos, signatures] = await Promise.all([
    db.from('responses')
      .select('section_id, field_id, value_bool, value_number, value_text, value_array, value_json, pass_state, fail_reason')
      .eq('inspection_id', inspectionId),
    db.from('photos').select('section_id, field_id').eq('inspection_id', inspectionId),
    db.from('signatures').select('section_id, field_id').eq('inspection_id', inspectionId),
  ])
  const failed = responses.error ?? photos.error ?? signatures.error
  if (failed) throw failed
  return evaluateInspection(template, (responses.data ?? []) as InspectionResponse[], {
    photos: (photos.data ?? []) as { section_id: string; field_id: string }[],
    signatures: ((signatures.data ?? []) as { section_id: string | null; field_id: string | null }[]).map((s) => ({
      section_id: s.section_id ?? undefined,
      field_id: s.field_id ?? undefined,
    })),
  }).overallResult
}

export interface CertifyInspectionInput {
  inspectionId: string
  projectId: string
  /** Required for deliverable_type='coc'; ignored for INS/FAT (auto-allocated). */
  cocNumber?: string
}

async function certifyInspection(input: CertifyInspectionInput): Promise<string> {
  const supabase = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('id, status, verifier_id, organisation_id, template_id')
    .eq('id', input.inspectionId)
    .single()
  if (!insp) throw new Error('Inspection not found')
  await requireFeature(insp.organisation_id, 'inspections', supabase)

  const { data: template } = await supabase
    .schema('inspections')
    .from('templates')
    .select('deliverable_type, schema_json')
    .eq('id', insp.template_id)
    .single()
  const deliverable = template?.deliverable_type as string | undefined

  // The result is the engine's, from the saved answers, never the verifier's choice. A FAIL (a
  // required check failed or is missing) is not certified: the verifier sends it back instead.
  const overallResult = await computeOverallResult(supabase, input.inspectionId, template?.schema_json as Template)
  if (overallResult === 'fail') {
    throw new Error(
      'This inspection fails: a required check failed or is unanswered. Send it back for re-inspection instead of certifying.',
    )
  }

  // Who may certify, separate verifier, signature qualifications and the CoC number are one
  // database rule (00235), which the transition guard also enforces. Asked first so the verifier
  // sees the sentence rather than a constraint error.
  const cocNumber = deliverable === 'coc' ? input.cocNumber?.trim() ?? '' : null
  const { data: blocker, error: blockErr } = await supabase
    .schema('inspections')
    .rpc('certification_blockers', { _inspection_id: input.inspectionId, _coc_number: cocNumber })
  if (blockErr) throw blockErr
  if (blocker) throw new Error(blocker as string)

  // certified_at and the INS/FAT number are stamped by the guard; anything sent for them is ignored.
  const { data: certified, error: updErr } = await supabase
    .schema('inspections')
    .from('inspections')
    .update({ status: 'certified', overall_result: overallResult, coc_number: cocNumber })
    .eq('id', input.inspectionId)
    .eq('status', 'awaiting_verification')
    .select('coc_number')
    .maybeSingle()
  if (updErr) throw updErr
  if (!certified) throw new Error('Nothing was certified: the inspection may have moved on. Reload and try again.')
  const issuedNumber = (certified as { coc_number: string }).coc_number

  // Best-effort branded report → projects.reports + handover auto-file (Node
  // renderer; no glyph bug). The cert is a committed DB fact — a render/file
  // failure logs but never blocks certification, and is retryable via
  // regenerateInspectionReportAction.
  try {
    const result = await generateAndFileInspectionReport({
      inspectionId: input.inspectionId,
      projectId: input.projectId,
      orgId: insp.organisation_id,
      userId: user.id,
    })
    if ('error' in result)
      console.warn('inspection report generate/file failed (cert still valid):', result.error)
  } catch (e) {
    console.warn('inspection report generate/file threw (cert still valid):', (e as Error).message)
  }

  // Best-effort validation for all deliverable types. The cert is valid even if
  // validation fails (caught + logged) — rules can be re-run later. The
  // validate-inspection function dispatches internally based on template_id and
  // returns 200 with a no-op message for templates that have no registered
  // rules. Keyed on inspection_id (migration 00159) — the projects.reports
  // pipeline no longer creates inspections.certificates rows, so the old
  // certificate lookup here found nothing and validation silently never ran.
  try {
    const { error: valErr } = await supabase.functions.invoke('validate-inspection', {
      body: { inspection_id: input.inspectionId },
    })
    if (valErr) console.warn('validate-inspection failed (cert still valid):', valErr.message)
  } catch (e) {
    console.warn('validate-inspection invocation failed (cert still valid):', (e as Error).message)
  }

  // Best-effort notification fan-out to PMs + contributors. dispatchNotification
  // is already never-throw; the outer try is defence-in-depth so cert state
  // remains valid even if the recipient queries fail.
  try {
    const contributors = await getInspectionContributors(supabase, input.inspectionId)
    const pms = await getProjectManagerIds(supabase, input.projectId)
    const recipients = [...new Set([...contributors, ...pms].filter((id) => id !== user.id))]
    if (recipients.length > 0) {
      await dispatchNotification({
        userIds: recipients,
        title: 'Inspection certified',
        body: `COC ${issuedNumber} has been issued`,
        route: `/projects/${input.projectId}/inspections/${input.inspectionId}`,
        type: 'inspection_certified',
        entityType: 'inspection',
        entityId: input.inspectionId,
      })
    }
  } catch (e) {
    console.warn('certify notification dispatch failed:', (e as Error).message)
  }

  revalidatePath(`/projects/${input.projectId}/inspections/${input.inspectionId}`)
  revalidatePath(`/projects/${input.projectId}/inspections`)
  return issuedNumber
}

// ─── sendBackForReinspectionAction ─────────────────────────────────────

export interface SendBackInput {
  inspectionId: string
  projectId: string
  notes: string
}

async function sendBackForReinspection(input: SendBackInput): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  if (!input.notes.trim()) throw new Error('Re-inspection notes are required')

  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('verifier_id, organisation_id')
    .eq('id', input.inspectionId)
    .single()
  if (!insp || insp.verifier_id !== user.id) {
    throw new Error('Only the assigned verifier can send back')
  }
  await requireFeature(insp.organisation_id, 'inspections', supabase)

  const { error } = await supabase
    .schema('inspections')
    .from('inspections')
    .update({ status: 're-inspect_required', reinspection_notes: input.notes.trim() })
    .eq('id', input.inspectionId)
    .eq('status', 'awaiting_verification')
  if (error) throw error

  // Notify all contributors that the inspection needs more work, with the
  // verifier's notes. Verifier-self excluded (they wrote the notes).
  try {
    const contributors = await getInspectionContributors(supabase, input.inspectionId)
    const recipients = contributors.filter((id) => id !== user.id)
    if (recipients.length > 0) {
      await dispatchNotification({
        userIds: recipients,
        title: 'Inspection sent back for re-inspection',
        body: input.notes.trim().slice(0, 200),
        route: `/projects/${input.projectId}/inspections/${input.inspectionId}`,
        type: 'inspection_re_inspect_required',
        entityType: 'inspection',
        entityId: input.inspectionId,
      })
    }
  } catch (e) {
    console.warn('send-back notification dispatch failed:', (e as Error).message)
  }

  revalidatePath(`/projects/${input.projectId}/inspections/${input.inspectionId}`)
  revalidatePath(`/projects/${input.projectId}/inspections`)
}

// revokeCertificateAction + generateShareLinkAction were removed here: both
// became unreachable when the report page moved to the projects.reports
// pipeline (no UI referenced them), and both operated on
// inspections.certificates rows the current certify flow no longer creates.
// The public /inspection/[shareToken] page remains for certificates whose
// share links were issued under the legacy flow.

// ─── exported actions ──────────────────────────────────────────────────

/**
 * A refusal travels back as data, never as a thrown error: Next.js replaces
 * the message of an error thrown from a server action with a generic sentence
 * in production builds ("An error occurred in the Server Components render"),
 * so a thrown "send it back" or "COC number is required" never reached the
 * verifier (seen on production, 2026-10-06). Same shape as
 * abandonInspectionAction.
 */
export type VerifierActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

function refusal(e: unknown): { ok: false; error: string } {
  const message = (e as { message?: unknown })?.message
  return { ok: false, error: typeof message === 'string' && message ? message : 'Something went wrong. Reload and try again.' }
}

export async function certifyInspectionAction(
  input: CertifyInspectionInput,
): Promise<VerifierActionResult<string>> {
  try {
    return { ok: true, value: await certifyInspection(input) }
  } catch (e) {
    return refusal(e)
  }
}

export async function sendBackForReinspectionAction(input: SendBackInput): Promise<VerifierActionResult> {
  try {
    await sendBackForReinspection(input)
    return { ok: true, value: undefined }
  } catch (e) {
    return refusal(e)
  }
}
