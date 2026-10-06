// apps/edge-functions/supabase/functions/_shared/whatsapp/forms.ts
//
// Inspection forms over WhatsApp (E4), edge side. This module only ROUTES: which messages
// belong to a form, and relays what the web app's form service answers. Access, the
// template, the Flow, completeness, the PDF and every write are decided by the web app
// (apps/web/src/lib/whatsapp-forms) through whatsapp.wa_inspection_* under the user's RLS.
//
// One exception is done here on purpose: an inbound photo is copied into Storage
// (whatsapp-media/inbound/<inbound id>) before anything else, because Meta's media URL
// lives five minutes and the web app may be slow to answer.
import {
  FORM_ACTIVITY_WINDOW_MS, FORM_PHOTO_MAX_BYTES, PENDING_POST_TTL_MS, encodePayload, isSubmitWord, isWithin, parseItemRef,
  type Payload,
} from './core.ts'
import type { InboundMessage } from './parse.ts'
import type { InboundRow, LinkRow, ProcessResult, ProcessorDeps } from './processor.ts'

export const STAGING_BUCKET = 'whatsapp-media'

export type FormsOp = 'open' | 'flow_reply' | 'photo' | 'item_choice' | 'submit'

export type FormsMessage =
  | { type: 'text'; body: string }
  | { type: 'buttons'; body: string; buttons: Array<{ id: string; title: string }> }
  | { type: 'flow'; flowId: string; token: string; cta: string; body: string; mode: 'draft' | 'published'; firstScreen: string }

export interface FormsReply {
  /** 'ok' or a refusal code. 'no_session' / 'not_waiting' mean "not mine": the processor carries on. */
  code: string
  messages: FormsMessage[]
  /** The session the link should now point at (open), or null to forget it. Absent = unchanged. */
  session_id?: string | null
}

export interface FormsClient {
  call(op: FormsOp, body: Record<string, unknown>): Promise<FormsReply>
}

export const FORMS = {
  menuRow: 'Inspections',
  listBody: (project: string) => `*${project}* — inspections you can fill in`,
  listButton: 'Inspections',
  noneOpen: (project: string) => `No inspections to fill in on ${project} right now.`,
  photoTooLarge: 'That photo is over 5 MB. Send it as a normal photo (not a document) so WhatsApp shrinks it.',
  notConfigured: 'Forms are not available on WhatsApp yet.',
  noOpenForm: 'There is no open form to submit. Send MENU and open the inspection again.',
} as const

const res = (outcome: ProcessResult['outcome'], reason: string | null, userId: string | null): ProcessResult =>
  ({ outcome, reason, userId, itemId: null })

/** A forms reply that is not "not mine". */
const owned = (r: FormsReply) => r.code !== 'no_session' && r.code !== 'not_waiting'

async function relay(deps: ProcessorDeps, link: LinkRow, r: FormsReply): Promise<void> {
  for (const m of r.messages) {
    if (m.type === 'text') await deps.meta.sendText(link.phone_e164, m.body)
    else if (m.type === 'buttons') await deps.meta.sendButtons(link.phone_e164, m.body, m.buttons)
    else if (m.type === 'flow') {
      await deps.meta.sendFlow(link.phone_e164, { flowId: m.flowId, token: m.token, cta: m.cta, body: m.body,
        mode: m.mode, firstScreen: m.firstScreen })
    }
  }
}

/**
 * Keep the link's form pointer in step with the reply. Only the session the op was ABOUT can
 * clear the pointer (a stale Submit button on an old session must not drop the live one), and
 * only an owned reply refreshes the activity time (a "not mine" must not keep the window open).
 */
async function touch(deps: ProcessorDeps, link: LinkRow, r: FormsReply, opSession: string | null): Promise<void> {
  const patch: Record<string, unknown> = {}
  const aboutCurrent = opSession === null || opSession === link.current_form_session_id
  const clear = () => { patch.current_form_session_id = null; patch.current_form_session_at = null }
  if (r.code === 'no_session' || r.session_id === null) {
    if (aboutCurrent && link.current_form_session_id) clear()
  } else if (r.session_id) {
    patch.current_form_session_id = r.session_id
    patch.current_form_session_at = deps.now().toISOString()
  } else if (owned(r) && link.current_form_session_id && aboutCurrent) {
    patch.current_form_session_at = deps.now().toISOString()
  }
  if (Object.keys(patch).length === 0) return
  await deps.store.updateLink(link.id, patch)
  Object.assign(link, patch)
}

async function run(deps: ProcessorDeps & { forms: FormsClient }, link: LinkRow, op: FormsOp,
                   body: Record<string, unknown>): Promise<ProcessResult | null> {
  const r = await deps.forms.call(op, { user_id: link.user_id, link_id: link.id, ...body })
  await touch(deps, link, r, typeof body.session_id === 'string' ? body.session_id : null)
  if (!owned(r)) {
    // SUBMIT is never ordinary text: tell the person instead of filing the word somewhere.
    if (op === 'submit') {
      await deps.meta.sendText(link.phone_e164, FORMS.noOpenForm)
      return res('refused', 'form_submit:no_session', link.user_id)
    }
    return null
  }
  await relay(deps, link, r)
  return res(r.code === 'ok' ? 'applied' : 'refused', `form_${op}${r.code === 'ok' ? '' : `:${r.code}`}`, link.user_id)
}

/** Whether the menu should offer "Inspections" (the database says what this user may fill in). */
export async function hasOpenInspections(deps: ProcessorDeps, link: LinkRow, projectId: string): Promise<boolean> {
  if (!deps.forms) return false
  const r = await deps.store.call('wa_my_inspections', { p_user: link.user_id, p_project: projectId })
  return Array.isArray(r) && r.length > 0
}

export function formsMenuRow(): { id: string; title: string } {
  return { id: encodePayload({ kind: 'menu', row: 'forms' }), title: FORMS.menuRow }
}

async function sendInspectionList(deps: ProcessorDeps, link: LinkRow): Promise<ProcessResult> {
  const projects = await deps.store.call('wa_my_projects', { p_user: link.user_id })
  const current = (Array.isArray(projects) ? projects : []).find((p: { id: string }) => p.id === link.current_project_id) as
    { id: string; name: string } | undefined
  const name = current?.name ?? 'this project'
  const list = current ? await deps.store.call('wa_my_inspections', { p_user: link.user_id, p_project: current.id }) : []
  const rows = (Array.isArray(list) ? list : []) as Array<{ id: string; label: string | null; template_name: string; mine: boolean }>
  if (rows.length === 0) {
    await deps.meta.sendText(link.phone_e164, FORMS.noneOpen(name))
    return res('applied', 'no_inspections', link.user_id)
  }
  await deps.meta.sendList(link.phone_e164, FORMS.listBody(name), FORMS.listButton,
    rows.map((x) => ({ id: encodePayload({ kind: 'insp', inspectionId: x.id }), title: x.label || x.template_name,
                       description: `${x.template_name}${x.mine ? ' · yours' : ''}` })),
    FORMS.listButton)
  return res('applied', 'inspection_list', link.user_id)
}

/** Payloads this module owns: the Inspections menu row, an inspection pick, the Submit button. */
export async function handleFormsPayload(p: Payload, link: LinkRow, _inbound: InboundRow, deps: ProcessorDeps): Promise<ProcessResult | null> {
  if (!(p.kind === 'menu' && p.row === 'forms') && p.kind !== 'insp' && p.kind !== 'fsubmit') return null
  if (!deps.forms) {
    await deps.meta.sendText(link.phone_e164, FORMS.notConfigured)
    return res('refused', 'forms_not_configured', link.user_id)
  }
  const d = deps as ProcessorDeps & { forms: FormsClient }
  if (p.kind === 'menu') return sendInspectionList(deps, link)
  if (p.kind === 'insp') return run(d, link, 'open', { inspection_id: p.inspectionId })
  return run(d, link, 'submit', { session_id: p.sessionId })
}

/** Content this module owns: a Flow reply, a form photo, a bare item number, SUBMIT. Null falls through. */
export async function handleFormsContent(msg: InboundMessage, link: LinkRow, inbound: InboundRow,
                                         deps: ProcessorDeps): Promise<ProcessResult | null> {
  if (msg.flowResponseJson) {
    if (!deps.forms) {
      await deps.meta.sendText(link.phone_e164, FORMS.notConfigured)
      return res('refused', 'forms_not_configured', link.user_id)
    }
    return run(deps as ProcessorDeps & { forms: FormsClient }, link, 'flow_reply',
               { inbound_id: inbound.id, response_json: msg.flowResponseJson })
  }
  if (!deps.forms) return null
  if (!link.current_form_session_id) {
    // SUBMIT with no form open: say so rather than filing the word as a note on a work item.
    if (msg.type === 'text' && msg.text && isSubmitWord(msg.text)) {
      await deps.meta.sendText(link.phone_e164, FORMS.noOpenForm)
      return res('refused', 'form_submit:no_session', link.user_id)
    }
    return null
  }
  // A "Post to project" the person just started owns their next photos and text.
  const post = link.pending_post as { started_at?: string } | null | undefined
  if (post?.started_at && isWithin(post.started_at, deps.now(), PENDING_POST_TTL_MS)) return null
  const d = deps as ProcessorDeps & { forms: FormsClient }
  const session = link.current_form_session_id
  const active = isWithin(link.current_form_session_at ?? null, deps.now(), FORM_ACTIVITY_WINDOW_MS)
  // A reply to a work-item card belongs to that item.
  if (msg.contextId && (await deps.store.itemForSentMessage(msg.contextId))) return null
  // Something done on a work item since the last form step: unlabelled photos and bare numbers are about it.
  const itemSince = !!link.active_item_at && (!link.current_form_session_at ||
    Date.parse(link.active_item_at) > Date.parse(link.current_form_session_at))

  if (msg.type === 'image' && msg.imageId) {
    const numbered = msg.text ? parseItemRef(msg.text) !== null : false
    if (!numbered && (!active || itemSince)) return null
    const { bytes, mime } = await deps.meta.fetchMedia(msg.imageId)
    if (bytes.length > FORM_PHOTO_MAX_BYTES) {
      await deps.meta.sendText(link.phone_e164, FORMS.photoTooLarge)
      return res('refused', 'photo_too_large', link.user_id)
    }
    const path = `inbound/${inbound.id}`
    await deps.store.upload(STAGING_BUCKET, path, bytes, mime)
    return run(d, link, 'photo', { session_id: session, inbound_id: inbound.id, staging_path: path, caption: msg.text ?? null })
  }

  if (msg.type === 'text' && msg.text) {
    // The web app decides whether the session is still live; "no_session" falls through.
    if (isSubmitWord(msg.text)) return run(d, link, 'submit', { session_id: session })
    if (parseItemRef(msg.text) !== null && active && !itemSince) {
      return run(d, link, 'item_choice', { session_id: session, inbound_id: inbound.id, text: msg.text })
    }
  }
  return null
}
