/**
 * What follows a submit of a WhatsApp-origin inspection (E4), whichever channel the submit
 * came through (the WhatsApp SUBMIT, or the web page reached by the signed link):
 *   1. whatsapp.enqueue_form_submitted: the confirmation (with the PDF, sent a minute later) to the
 *      person, the summary to the site's linked members; both re-checked at send time
 *   2. notify the verifier in the app, when the submit did not already (the web action does)
 *   3. render the PDF as the session's person and stage it at whatsapp-media/outbound/<session>.pdf
 *      (NOT filed in projects.reports: the 'inspection' report kind is open-read, so an uncertified
 *      PDF there would reach client viewers; certify files the official copy)
 *   4. kick the worker
 *   5. mark the session submitted (last, so a retried SUBMIT can finish an interrupted follow-up)
 * A PDF failure does not stop 4-5: the confirmation then goes without the attachment.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { renderInspectionPdf } from '@/lib/reports/file-inspection-report'
import { dispatchNotification } from '@/lib/notifications'
import { kickWhatsAppWorker } from '@/lib/whatsapp/kick-worker'
import { STAGING_BUCKET } from './service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, any, any>

export interface AfterSubmitDeps {
  sb: Sb
  render(inspectionId: string, userId: string): Promise<Buffer>
  notify: typeof dispatchNotification
  kick: typeof kickWhatsAppWorker
  now: () => Date
}

export function outboundPdfPath(sessionId: string): string {
  return `outbound/${sessionId}.pdf`
}

function defaults(): AfterSubmitDeps {
  return {
    sb: createServiceClient() as Sb,
    render: async (inspectionId, userId) => (await renderInspectionPdf(inspectionId, { asUserId: userId })).pdf,
    notify: dispatchNotification,
    kick: kickWhatsAppWorker,
    now: () => new Date(),
  }
}

export async function afterWhatsAppSubmit(sessionId: string, opts: { notifyVerifier: boolean },
                                          d: AfterSubmitDeps = defaults()): Promise<void> {
  const { data: s, error } = await d.sb.schema('whatsapp').from('form_sessions')
    .select('id, user_id, inspection_id, status').eq('id', sessionId).maybeSingle()
  if (error || !s) throw new Error(`afterWhatsAppSubmit: session ${sessionId} not found`)

  // Queue the messages and notify FIRST: they are cheap and idempotent, and a timeout in the PDF
  // render below must not lose them. The confirmation row waits a minute (send_after) for the PDF.
  const { error: qErr } = await d.sb.schema('whatsapp').rpc('enqueue_form_submitted', { p_session: sessionId })
  if (qErr) throw new Error(`enqueue_form_submitted: ${qErr.message}`)

  if (opts.notifyVerifier) {
    const { data: insp } = await d.sb.schema('inspections').from('inspections')
      .select('verifier_id, target_label, project_id').eq('id', s.inspection_id).maybeSingle()
    if (insp?.verifier_id) {
      await d.notify({
        userIds: [insp.verifier_id],
        title: 'Inspection awaiting your verification',
        body: `"${insp.target_label ?? 'inspection'}" is ready for sign-off`,
        route: `/projects/${insp.project_id}/inspections/${s.inspection_id}`,
        type: 'inspection_awaiting_verification',
        entityType: 'inspection',
        entityId: s.inspection_id,
      })
    }
  }

  try {
    const pdf = await d.render(s.inspection_id, s.user_id)
    const up = await d.sb.storage.from(STAGING_BUCKET).upload(outboundPdfPath(sessionId), pdf,
      { contentType: 'application/pdf', upsert: true })
    if (up.error) throw new Error(up.error.message)
  } catch (e) {
    console.error('[whatsapp-forms] PDF for the confirmation failed; it will go without one', sessionId, e)
  }
  await d.kick('form_submitted')

  // Last: until this lands the session stays live, so a retried SUBMIT finishes the follow-up.
  await d.sb.schema('whatsapp').from('form_sessions')
    .update({ status: 'submitted', submitted_at: d.now().toISOString(), pending_photo_inbound_ids: [] }).eq('id', sessionId)
}

/**
 * Called after a web submit (submitInspectionAction). If the person who submitted opened this
 * inspection on WhatsApp, run the same follow-up so their chat gets the confirmation and the
 * site gets the summary. Never throws: a web submit must not fail because WhatsApp did.
 */
export async function afterWebSubmitOfWhatsAppForm(inspectionId: string, submitterId: string,
                                                   d?: AfterSubmitDeps): Promise<void> {
  try {
    const deps = d ?? defaults()
    const { data } = await deps.sb.schema('whatsapp').from('form_sessions').select('id')
      .eq('inspection_id', inspectionId).eq('user_id', submitterId).in('status', ['open', 'answered'])
      // An expired session means the person has not been in the chat for a day: a free-form
      // confirmation would land outside Meta's 24-hour window.
      .gt('expires_at', deps.now().toISOString())
      .order('created_at', { ascending: false }).limit(1)
    const id = data?.[0]?.id as string | undefined
    if (id) await afterWhatsAppSubmit(id, { notifyVerifier: false }, deps)
  } catch (e) {
    console.error('[whatsapp-forms] web submit follow-up failed', inspectionId, e)
  }
}
