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
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

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
