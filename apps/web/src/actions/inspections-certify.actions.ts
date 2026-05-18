'use server'

/**
 * Verifier-side state transitions for inspections: certify (with COC# or
 * auto-allocated INS/FAT), send-back-for-reinspection, revoke a
 * certificate, and generate a share link.
 *
 * `inspections` schema is not in the generated DB types — supabase client
 * cast to `any` per Phase-4 convention.
 *
 * Verifier separation: COC + factory_test templates require the verifier
 * to NOT have contributed responses (read from `response_history`). The
 * inspection_only deliverable type may waive this (template-level flag).
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'
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

export interface CertifyInspectionInput {
  inspectionId: string
  projectId: string
  /** Required for deliverable_type='coc'; ignored for INS/FAT (auto-allocated). */
  cocNumber?: string
}

export async function certifyInspectionAction(input: CertifyInspectionInput): Promise<string> {
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
  if (insp.status !== 'awaiting_verification') {
    throw new Error('Inspection is not awaiting verification')
  }
  if (insp.verifier_id !== user.id) {
    throw new Error('Only the assigned verifier can certify this inspection')
  }

  const { data: template } = await supabase
    .schema('inspections')
    .from('templates')
    .select('deliverable_type, schema_json')
    .eq('id', insp.template_id)
    .single()

  const deliverable = template?.deliverable_type as string | undefined
  const requiresSeparate =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (template?.schema_json as any)?.requires_separate_verifier ??
    (deliverable === 'coc' || deliverable === 'factory_test')

  if (requiresSeparate) {
    const { data: contributors } = await supabase
      .schema('inspections')
      .from('response_history')
      .select('responded_by')
      .eq('inspection_id', input.inspectionId)
    const distinct = new Set(
      ((contributors ?? []) as Array<{ responded_by: string }>).map((c) => c.responded_by),
    )
    if (distinct.has(user.id)) {
      throw new Error(
        'Verifier cannot also be a contributor on this template type. Reassign the verifier to someone who has not filled in responses.',
      )
    }
  }

  // Signature required_qualifications gate. If any signature field on the
  // template declares required_qualifications, at least one captured signature
  // must satisfy the qualification heuristically.
  //
  // v1 heuristic (no formal signatories registry):
  //   - 'registered_person' satisfied by any signature with a non-empty
  //     registration_number (proxy: only RPs/MIEs carry a registration_number).
  //   - other qualifications satisfied by substring match against signatory_title
  //     (case-insensitive, underscores → spaces). e.g. required_qualifications
  //     = ['pr_eng'] matches a signatory_title like "Senior Pr Eng".
  //
  // Production v2 would consult a signatories table with verified credentials.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemaJson = template?.schema_json as any
  const sigRequirements: { section_id: string; field_id: string; required_quals: string[]; label: string }[] = []
  for (const section of (schemaJson?.sections ?? []) as Array<{
    section_id: string
    fields?: Array<Record<string, unknown>>
    subsections?: Array<{ fields: Array<Record<string, unknown>> }>
  }>) {
    const allFields = [
      ...((section.fields ?? []) as Array<Record<string, unknown>>),
      ...((section.subsections ?? []).flatMap((ss) => ss.fields ?? []) as Array<Record<string, unknown>>),
    ]
    for (const f of allFields) {
      const quals = (f.required_qualifications as string[] | undefined) ?? []
      if (f.type === 'signature' && quals.length > 0) {
        sigRequirements.push({
          section_id: section.section_id,
          field_id: String(f.field_id),
          required_quals: quals,
          label: String(f.label ?? f.field_id),
        })
      }
    }
  }

  if (sigRequirements.length > 0) {
    const { data: sigs } = await supabase
      .schema('inspections')
      .from('signatures')
      .select('signatory_title, registration_number')
      .eq('inspection_id', input.inspectionId)
    const sigList = (sigs ?? []) as Array<{ signatory_title: string | null; registration_number: string | null }>

    for (const req of sigRequirements) {
      const matched = sigList.some((s) => {
        const title = (s.signatory_title ?? '').toLowerCase()
        // 'registered_person' qualified by presence of a registration_number
        if (req.required_quals.includes('registered_person') && s.registration_number && s.registration_number.trim().length > 0) {
          return true
        }
        // Title heuristic — match underscore-form against space-form
        return req.required_quals.some((q) => title.includes(q.replace(/_/g, ' ')))
      })
      if (!matched) {
        throw new Error(
          `Signature requirement not met for "${req.label}" — needs one of: ${req.required_quals.join(', ')}. None of the captured signatures satisfy this (check signatory title or registration number).`,
        )
      }
    }
  }

  let cocNumber: string
  if (deliverable === 'coc') {
    if (!input.cocNumber || !input.cocNumber.trim()) {
      throw new Error('COC number is required (enter the number from your ECB pad)')
    }
    const candidate = input.cocNumber.trim()
    const { data: dup } = await supabase
      .schema('inspections')
      .from('inspections')
      .select('id')
      .eq('organisation_id', insp.organisation_id)
      .eq('coc_number', candidate)
      .neq('id', input.inspectionId)
      .maybeSingle()
    if (dup) {
      throw new Error(
        `COC number ${candidate} is already used by another inspection in this organisation`,
      )
    }
    cocNumber = candidate
  } else {
    const { data: allocated, error: rpcErr } = await supabase.rpc('allocate_coc_number', {
      _inspection_id: input.inspectionId,
    })
    if (rpcErr) throw rpcErr
    cocNumber = allocated as string
  }

  const { error: updErr } = await supabase
    .schema('inspections')
    .from('inspections')
    .update({
      status: 'certified',
      certified_at: new Date().toISOString(),
      coc_number: cocNumber,
    })
    .eq('id', input.inspectionId)
  if (updErr) throw updErr

  // Best-effort PDF render — Phase 6 ships the edge function; this swallows
  // failures so the cert state remains valid and the render can be retried.
  try {
    const { error: fnErr } = await supabase.functions.invoke('render-inspection-pdf', {
      body: { inspection_id: input.inspectionId },
    })
    if (fnErr) console.warn('render-inspection-pdf failed (Phase 6 pending):', fnErr.message)
  } catch (e) {
    console.warn('render-inspection-pdf invocation failed:', (e as Error).message)
  }

  // Best-effort validation for all deliverable types. The cert is valid even if
  // validation fails (caught + logged) — rules can be re-run later. The
  // validate-inspection function dispatches internally based on template_id and
  // returns 200 with a no-op message for templates that have no registered rules.
  try {
    const { data: cert } = await supabase
      .schema('inspections')
      .from('certificates')
      .select('id')
      .eq('inspection_id', input.inspectionId)
      .is('superseded_at', null)
      .maybeSingle()
    if (cert?.id) {
      const { error: valErr } = await supabase.functions.invoke('validate-inspection', {
        body: { certificate_id: cert.id },
      })
      if (valErr) console.warn('validate-inspection failed (cert still valid):', valErr.message)
    }
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
        body: `COC ${cocNumber} has been issued`,
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
  return cocNumber
}

// ─── sendBackForReinspectionAction ─────────────────────────────────────

export async function sendBackForReinspectionAction(input: {
  inspectionId: string
  projectId: string
  notes: string
}): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  if (!input.notes.trim()) throw new Error('Re-inspection notes are required')

  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('verifier_id')
    .eq('id', input.inspectionId)
    .single()
  if (!insp || insp.verifier_id !== user.id) {
    throw new Error('Only the assigned verifier can send back')
  }

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

// ─── revokeCertificateAction ────────────────────────────────────────────

export async function revokeCertificateAction(input: {
  certificateId: string
  inspectionId: string
  projectId: string
  reason: string
}): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  if (!input.reason.trim()) throw new Error('Revocation reason required')

  const { error } = await supabase
    .schema('inspections')
    .from('certificates')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: user.id,
      revoke_reason: input.reason.trim(),
    })
    .eq('id', input.certificateId)
  if (error) throw error

  // Notify verifier + PMs + contributors. The revoker is excluded so they
  // don't get a self-notification for the action they just took.
  try {
    const { data: insp } = await supabase
      .schema('inspections')
      .from('inspections')
      .select('verifier_id, coc_number')
      .eq('id', input.inspectionId)
      .single()
    const verifierId = (insp as { verifier_id: string | null } | null)?.verifier_id ?? null
    const cocNumber = (insp as { coc_number: string | null } | null)?.coc_number ?? null

    const contributors = await getInspectionContributors(supabase, input.inspectionId)
    const pms = await getProjectManagerIds(supabase, input.projectId)
    const recipients = [
      ...new Set(
        [verifierId, ...contributors, ...pms]
          .filter((id): id is string => Boolean(id))
          .filter((id) => id !== user.id),
      ),
    ]
    if (recipients.length > 0) {
      await dispatchNotification({
        userIds: recipients,
        title: 'Certificate revoked',
        body: cocNumber
          ? `COC ${cocNumber} revoked: ${input.reason.trim().slice(0, 160)}`
          : `Certificate revoked: ${input.reason.trim().slice(0, 200)}`,
        route: `/projects/${input.projectId}/inspections/${input.inspectionId}`,
        type: 'inspection_revoked',
        entityType: 'inspection',
        entityId: input.inspectionId,
      })
    }
  } catch (e) {
    console.warn('revoke notification dispatch failed:', (e as Error).message)
  }

  revalidatePath(`/projects/${input.projectId}/inspections/${input.inspectionId}`)
}

// ─── generateShareLinkAction ───────────────────────────────────────────

export async function generateShareLinkAction(input: {
  certificateId: string
  expiresInDays?: number
}): Promise<string> {
  const supabase = (await createClient()) as AnyClient
  const expiresAt = new Date(
    Date.now() + (input.expiresInDays ?? 90) * 86_400_000,
  ).toISOString()
  const shareToken = crypto.randomUUID()
  const { error } = await supabase
    .schema('inspections')
    .from('certificates')
    .update({ share_token: shareToken, share_expires_at: expiresAt })
    .eq('id', input.certificateId)
  if (error) throw error
  return shareToken
}
