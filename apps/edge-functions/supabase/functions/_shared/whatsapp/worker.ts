// apps/edge-functions/supabase/functions/_shared/whatsapp/worker.ts
import { DAILY_ITEM_CAP, nextSendTime, sastDate } from './core.ts'
import { MetaError, type MetaClient } from './meta-client.ts'
import { foldSend, formConfirmCaption, formPdfFilename, formSubmittedSend, itemCardSend, optinSend, otpSend,
  type FormSummary, type TemplateSend } from './templates.ts'

export interface OutboxRow {
  id: string
  user_id: string
  work_item_id: string | null
  link_id: string | null
  trigger: 'assigned' | 'due_tomorrow' | 'overdue' | 'otp' | 'optin' | 'fold' | 'form_confirm' | 'form_submitted'
  form_session_id?: string | null
  // deno-lint-ignore no-explicit-any
  payload: any
  attempts: number
}

export interface ActiveLink { id: string; phone_e164: string; status: string; quiet_start: string; quiet_end: string }

export interface ReceiveCheck {
  ok: boolean
  reason?: string
  item_id?: string
  ref?: string
  title?: string
  project_name?: string
  due_date?: string
  days_overdue?: number
}

export interface WorkerStore {
  sendingEnabled(): Promise<boolean>
  claim(limit: number): Promise<OutboxRow[]>
  activeLink(userId: string): Promise<ActiveLink | null>
  linkById(id: string): Promise<{ id: string; phone_e164: string; status: string } | null>
  canReceive(userId: string, itemId: string): Promise<ReceiveCheck>
  sentItemCountToday(userId: string, sastDay: string): Promise<number>
  enqueueFold(userId: string, sastDay: string): Promise<void>
  mark(id: string, patch: Record<string, unknown>): Promise<void>
  setLinkActiveItem(linkId: string, itemId: string, atIso: string): Promise<void>
  markLinkUndeliverable(linkId: string, reason: string): Promise<void>
  recordPolicyError(text: string): Promise<void>
  /** whatsapp.form_receive_check: 'ok' or the reason not to send (flag_off, project_off, no_access, gone). */
  formReceiveCheck(outboxId: string): Promise<string>
  formSummary(sessionId: string): Promise<FormSummary | null>
  /** whatsapp-media/outbound/<session>.pdf, or null if the render failed. */
  outboundPdf(sessionId: string): Promise<Uint8Array | null>
  /** whatsapp.templates.status = 'approved' (Meta rejects an unapproved template per recipient). */
  templateApproved(name: string): Promise<boolean>
}

/** Meta: the 24-hour customer-service window has closed, so a free-form message cannot be sent. */
const WINDOW_CLOSED = 131047

export interface DrainStats { sent: number; held: number; suppressed: number; failed: number; retried: number }

const MAX_ATTEMPTS = 5
type Kind = keyof DrainStats

export async function drainOutbox(deps: { store: WorkerStore; meta: MetaClient; now: () => Date }): Promise<DrainStats> {
  const stats: DrainStats = { sent: 0, held: 0, suppressed: 0, failed: 0, retried: 0 }
  const enabled = await deps.store.sendingEnabled()
  const rows = await deps.store.claim(50)
  for (const row of rows) {
    const kind: Kind = enabled
      ? await sendOne(row, deps)
      : (await deps.store.mark(row.id, { status: 'suppressed', error_text: 'platform_disabled' }), 'suppressed')
    stats[kind]++
  }
  return stats
}

async function sendOne(row: OutboxRow, deps: { store: WorkerStore; meta: MetaClient; now: () => Date }): Promise<Kind> {
  const { store, meta, now } = deps
  const suppress = async (reason: string): Promise<Kind> => {
    await store.mark(row.id, { status: 'suppressed', error_text: reason })
    return 'suppressed'
  }

  let to: string
  let linkId: string
  let send: TemplateSend
  let itemId: string | null = null

  if (row.trigger === 'form_confirm' || row.trigger === 'form_submitted') {
    if (!row.form_session_id) return suppress('no_session')
    const chk = await store.formReceiveCheck(row.id)
    if (chk !== 'ok') return suppress(chk)
    const link = await store.activeLink(row.user_id)
    if (!link) return suppress('no_link')
    const summary = await store.formSummary(row.form_session_id)
    if (!summary) return suppress('gone')
    if (row.trigger === 'form_confirm') return sendConfirm(row, link, summary, deps)
    // The summary goes to people who did not just act, so it waits for their quiet hours.
    const at = nextSendTime(now(), link.quiet_start, link.quiet_end)
    if (at.getTime() > now().getTime()) {
      await store.mark(row.id, { status: 'held_quiet', send_after: at.toISOString() })
      return 'held'
    }
    send = formSubmittedSend(summary)
    if (!(await store.templateApproved(send.name))) return suppress('template_not_approved')
    to = link.phone_e164
    linkId = link.id
    return deliver(row, to, linkId, send, null, deps)
  }

  if (row.trigger === 'otp' || row.trigger === 'optin') {
    const link = row.link_id ? await store.linkById(row.link_id) : null
    const wanted = row.trigger === 'otp' ? 'pending_otp' : 'pending_optin'
    if (!link || link.status !== wanted) return suppress('link_state')
    to = link.phone_e164
    linkId = link.id
    send = row.trigger === 'otp'
      ? otpSend(String(row.payload?.code ?? ''))
      : optinSend(String(row.payload?.inviter ?? 'Your project manager'), String(row.payload?.project ?? 'your project'), link.id)
  } else {
    const link = await store.activeLink(row.user_id)
    if (!link) return suppress('no_link')
    const at = nextSendTime(now(), link.quiet_start, link.quiet_end)
    if (at.getTime() > now().getTime()) {
      await store.mark(row.id, { status: 'held_quiet', send_after: at.toISOString() })
      return 'held'
    }
    to = link.phone_e164
    linkId = link.id
    if (row.trigger === 'fold') {
      send = foldSend(Number(row.payload?.count ?? 1))
    } else {
      if (!row.work_item_id) return suppress('no_item')
      const chk = await store.canReceive(row.user_id, row.work_item_id)
      if (!chk.ok) return suppress(chk.reason ?? 'not_receivable')
      const day = sastDate(now())
      if ((await store.sentItemCountToday(row.user_id, day)) >= DAILY_ITEM_CAP) {
        await store.enqueueFold(row.user_id, day)
        return suppress('daily_cap')
      }
      itemId = row.work_item_id
      send = itemCardSend(row.trigger, { itemId, ref: chk.ref!, projectName: chk.project_name!, title: chk.title!,
        dueDate: chk.due_date!, daysOverdue: row.payload?.days_overdue ?? chk.days_overdue })
    }
  }

  return deliver(row, to, linkId, send, itemId, deps)
}

async function deliver(row: OutboxRow, to: string, linkId: string, send: TemplateSend, itemId: string | null,
                       deps: { store: WorkerStore; meta: MetaClient; now: () => Date }): Promise<Kind> {
  const { store, meta, now } = deps
  try {
    const mid = await meta.sendTemplate(to, send.name, send.body, send.buttons)
    await store.mark(row.id, { status: 'sent', meta_message_id: mid, sent_at: now().toISOString(),
      error_code: null, error_text: null, ...(row.trigger === 'otp' ? { payload: {} } : {}) })
    if (itemId) await store.setLinkActiveItem(linkId, itemId, now().toISOString())
    return 'sent'
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError(0, String((e as Error)?.message ?? e), 'transient')
    const text = `${err.code} ${err.message}`
    if (err.klass === 'transient' && row.attempts < MAX_ATTEMPTS) {
      const after = new Date(now().getTime() + 60_000 * 2 ** (row.attempts - 1))
      await store.mark(row.id, { status: 'retry', send_after: after.toISOString(), error_code: err.code, error_text: text })
      return 'retried'
    }
    if (err.klass === 'recipient') await store.markLinkUndeliverable(linkId, text)
    if (err.klass === 'policy') await store.recordPolicyError(text)
    await store.mark(row.id, { status: 'failed', error_code: err.code, error_text: text })
    return 'failed'
  }
}

/**
 * The person who submitted just interacted, so this is a free-form reply inside the 24-hour
 * window: no quiet hold, no template. If the window has closed anyway (Meta 131047) the
 * confirmation is dropped; that is not a reason to stop messaging the number.
 */
async function sendConfirm(row: OutboxRow, link: ActiveLink, summary: FormSummary,
                           deps: { store: WorkerStore; meta: MetaClient; now: () => Date }): Promise<Kind> {
  const { store, meta, now } = deps
  try {
    const pdf = await store.outboundPdf(row.form_session_id!)
    const caption = formConfirmCaption(summary)
    let mid: string
    if (pdf) {
      const filename = formPdfFilename(summary)
      const mediaId = await meta.uploadMedia(pdf, 'application/pdf', filename)
      mid = await meta.sendDocument(link.phone_e164, mediaId, filename, caption)
    } else {
      mid = await meta.sendText(link.phone_e164, caption)
    }
    await store.mark(row.id, { status: 'sent', meta_message_id: mid, sent_at: now().toISOString(), error_code: null, error_text: null })
    return 'sent'
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError(0, String((e as Error)?.message ?? e), 'transient')
    if (err.code === WINDOW_CLOSED) {
      await store.mark(row.id, { status: 'suppressed', error_code: err.code, error_text: 'window_closed' })
      return 'suppressed'
    }
    const text = `${err.code} ${err.message}`
    if (err.klass === 'transient' && row.attempts < MAX_ATTEMPTS) {
      const after = new Date(now().getTime() + 60_000 * 2 ** (row.attempts - 1))
      await store.mark(row.id, { status: 'retry', send_after: after.toISOString(), error_code: err.code, error_text: text })
      return 'retried'
    }
    if (err.klass === 'recipient') await store.markLinkUndeliverable(link.id, text)
    if (err.klass === 'policy') await store.recordPolicyError(text)
    await store.mark(row.id, { status: 'failed', error_code: err.code, error_text: text })
    return 'failed'
  }
}
