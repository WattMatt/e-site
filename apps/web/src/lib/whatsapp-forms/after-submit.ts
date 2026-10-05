/**
 * What follows a submit of a WhatsApp-origin inspection (E4), whichever channel the submit
 * came through (the WhatsApp SUBMIT, or the web page reached by the signed link):
 *   1. render the PDF as the session's person and stage it at whatsapp-media/outbound/<session>.pdf
 *      (NOT filed in projects.reports: the 'inspection' report kind is open-read, so an uncertified
 *      PDF there would reach client viewers; certify files the official copy)
 *   2. mark the session submitted
 *   3. whatsapp.enqueue_form_submitted: the confirmation (with the PDF) to the person, the summary
 *      to the site's linked members; both re-checked at send time by whatsapp.form_receive_check
 *   4. notify the verifier in the app, when the submit did not already (the web action does)
 *   5. kick the worker
 * A PDF failure does not stop 2-5: the confirmation then goes without the attachment.
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

  try {
    const pdf = await d.render(s.inspection_id, s.user_id)
    const up = await d.sb.storage.from(STAGING_BUCKET).upload(outboundPdfPath(sessionId), pdf,
      { contentType: 'application/pdf', upsert: true })
    if (up.error) throw new Error(up.error.message)
  } catch (e) {
    console.error('[whatsapp-forms] PDF for the confirmation failed; it will go without one', sessionId, e)
  }

  await d.sb.schema('whatsapp').from('form_sessions')
    .update({ status: 'submitted', submitted_at: d.now().toISOString(), pending_photo_inbound_id: null }).eq('id', sessionId)
  const { error: qErr } = await d.sb.schema('whatsapp').rpc('enqueue_form_submitted', { p_session: sessionId })
  if (qErr) console.error('[whatsapp-forms] enqueue_form_submitted failed', sessionId, qErr.message)

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
  await d.kick('form_submitted')
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
      .order('created_at', { ascending: false }).limit(1)
    const id = data?.[0]?.id as string | undefined
    if (id) await afterWhatsAppSubmit(id, { notifyVerifier: false }, deps)
  } catch (e) {
    console.error('[whatsapp-forms] web submit follow-up failed', inspectionId, e)
  }
}
