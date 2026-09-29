// apps/edge-functions/supabase/functions/_shared/whatsapp/processor.ts
//
// One inbound WhatsApp message -> one outcome. Every domain write goes through
// a whatsapp.wa_* function, which acts AS the linked user under real RLS
// (migration 00222 part B). This file decides WHICH item and WHICH action;
// it never decides whether the user is ALLOWED — the database does.
import {
  BURST_WINDOW_MS, CONSENT_TEXT_VERSION, WRONG_ITEM_WINDOW_MS, classifyKeyword, decodePayload,
  encodePayload, isWithin, resolveTarget,
} from './core.ts'
import type { MetaClient } from './meta-client.ts'
import type { InboundMessage } from './parse.ts'

export interface LinkRow {
  id: string
  user_id: string
  phone_e164: string
  status: string
  active_item_id: string | null
  active_item_at: string | null
  pending_done_item_id: string | null
  pending_done_at: string | null
  pending_done_wants: 'photo' | 'answer' | null
  pending_inbound_id: string | null
  last_confirm_item_id: string | null
  last_confirm_at: string | null
}

export interface ItemInfo {
  id: string
  ref: string
  title: string
  itemType: string
  origin: string
  projectId: string
  organisationId: string
  snagId: string | null
  status: string
}

export interface InboundRow {
  id: string
  meta_message_id: string
  from_e164: string
  raw: unknown
  attempts: number
}

export type Outcome = 'applied' | 'refused' | 'unmatched' | 'unknown_sender'

export interface ProcessResult {
  outcome: Outcome
  reason: string | null
  userId: string | null
  itemId: string | null
}

// deno-lint-ignore no-explicit-any
type Rpc = any

export interface ProcessorStore {
  /** Prefers a live link (active / pending_optin), else the most recent for the number. */
  linkByPhone(e164: string): Promise<LinkRow | null>
  updateLink(id: string, patch: Record<string, unknown>): Promise<void>
  itemForSentMessage(metaMessageId: string): Promise<string | null>
  itemInfo(itemId: string): Promise<ItemInfo | null>
  call(fn: string, args: Record<string, unknown>): Promise<Rpc>
  upload(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<void>
  /** True if we already told this unknown number "not linked" in the last 24 h; otherwise records now and returns false. */
  unknownSenderRecentlyAnswered(e164: string, now: Date): Promise<boolean>
  inboundById(id: string): Promise<InboundRow | null>
  markInbound(id: string, patch: { outcome: Outcome; outcome_reason: string | null; resolved_user_id: string | null;
                                   resolved_item_id: string | null; processed_at: string }): Promise<void>
}

export interface ProcessorDeps {
  store: ProcessorStore
  meta: MetaClient
  now: () => Date
  appUrl: string
}

export const REPLIES = {
  notLinked: "This number isn't linked to E-Site. Ask your project manager to add you.",
  optinPrompt: 'Tap "Yes, I agree" on the invitation above to start receiving site items here.',
  optedIn: (n: number) => (n > 0
    ? `You're set up. You have ${n} open item${n === 1 ? '' : 's'} — they'll arrive here.`
    : "You're set up. New site items will arrive here."),
  optedOut: "You won't get E-Site messages on WhatsApp any more. Reply START to turn them back on.",
  restarted: 'E-Site messages are back on.',
  unsupported: 'E-Site can take photos and text messages here.',
  noOpen: 'You have no open items right now.',
  pickPrompt: 'Which item is this for?',
  pickButton: 'Choose item',
  acked: (ref: string) => `👍 Acknowledged ${ref}.`,
  doneAnswered: (ref: string, who: string | null) => `✅ ${ref} marked done — it's with ${who ?? 'the sign-off person'} to sign off.`,
  doneClosed: (ref: string) => `✅ ${ref} closed.`,
  alreadyClosed: (ref: string) => `${ref} is already closed.`,
  notHolder: (ref: string, who: string | null) => `${ref} is with ${who ?? 'someone else'} now — nothing for you to do on it.`,
  needsPhoto: (ref: string) => `Send the close-out photo for ${ref} to finish.`,
  needsAnswer: (ref: string) => `Reply with your answer to ${ref}.`,
  useModule: (ref: string, url: string) => `Finish ${ref} in E-Site: ${url}`,
  refused: (ref: string, msg: string) => `Couldn't update ${ref}: ${msg}`,
  noAccess: "You don't have access to that item any more.",
  notFound: "That item isn't available to you.",
  nothingChanged: (ref: string) => `Nothing changed on ${ref} — it may have moved on.`,
  noted: (ref: string) => `📝 Added to ${ref}.`,
  attached: (ref: string) => `📎 Attached to ${ref}.`,
  answered: (ref: string) => `✅ Answer recorded on ${ref}.`,
  redacted: (ref: string) => `Removed from ${ref}. Swipe right on the right item's card and send it again.`,
  redactLate: "That can't be removed here any more — ask the project manager.",
  wrongItem: 'Wrong item',
} as const

const result = (outcome: Outcome, reason: string | null, userId: string | null, itemId: string | null): ProcessResult =>
  ({ outcome, reason, userId, itemId })

function asMessage(raw: unknown): InboundMessage {
  return raw as InboundMessage
}

/** Replies for every non-ok wa_* code. Returns the outcome to record. */
async function replyForCode(deps: ProcessorDeps, to: string, r: Rpc, itemId: string, userId: string): Promise<ProcessResult> {
  const ref = r?.ref ?? 'that item'
  const send = (body: string) => deps.meta.sendText(to, body)
  switch (r?.code) {
    case 'already_closed': await send(REPLIES.alreadyClosed(ref)); break
    case 'not_holder': await send(REPLIES.notHolder(ref, r.holder_name ?? null)); break
    case 'no_access': await send(REPLIES.noAccess); break
    case 'not_found': await send(REPLIES.notFound); break
    case 'nothing_changed': await send(REPLIES.nothingChanged(ref)); break
    case 'use_module': await send(REPLIES.useModule(ref, `${deps.appUrl}/wa/${itemId}`)); break
    case 'refused': await send(REPLIES.refused(ref, String(r.message ?? 'not allowed'))); break
    default: await send(REPLIES.refused(ref, 'unexpected response'))
  }
  return result('refused', String(r?.code ?? 'unknown'), userId, itemId)
}

async function markDone(deps: ProcessorDeps, link: LinkRow, itemId: string): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const to = link.phone_e164
  const r = await store.call('wa_mark_done', { p_user: link.user_id, p_item: itemId })
  if (r?.code === 'ok') {
    await store.updateLink(link.id, { pending_done_item_id: null, pending_done_at: null, pending_done_wants: null,
      active_item_id: itemId, active_item_at: now().toISOString() })
    await meta.sendText(to, r.status === 'closed' ? REPLIES.doneClosed(r.ref) : REPLIES.doneAnswered(r.ref, r.gatekeeper_name ?? null))
    return result('applied', `done_${r.status}`, link.user_id, itemId)
  }
  if (r?.code === 'needs_photo' || r?.code === 'needs_answer') {
    const wants = r.code === 'needs_photo' ? 'photo' : 'answer'
    await store.updateLink(link.id, { pending_done_item_id: itemId, pending_done_at: now().toISOString(),
      pending_done_wants: wants, active_item_id: itemId, active_item_at: now().toISOString() })
    await meta.sendText(to, wants === 'photo' ? REPLIES.needsPhoto(r.ref) : REPLIES.needsAnswer(r.ref))
    return result('applied', `awaiting_${wants}`, link.user_id, itemId)
  }
  return replyForCode(deps, to, r, itemId, link.user_id)
}

/** Attach a text or photo to a known item. `viaPendingDone` makes a photo a close-out / a text an answer. */
async function applyContent(deps: ProcessorDeps, link: LinkRow, inbound: InboundRow, msg: InboundMessage,
                            itemId: string, viaPendingDone: boolean): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const to = link.phone_e164
  const item = await store.itemInfo(itemId)
  if (!item) {
    await meta.sendText(to, REPLIES.notFound)
    return result('refused', 'not_found', link.user_id, null)
  }

  if (msg.type === 'image' && msg.imageId) {
    const { bytes, mime } = await meta.fetchMedia(msg.imageId)
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    // Snag mirrors keep their photos where the Snags module reads them (Phase 2, Task 22).
    const snagMirror = item.origin === 'mirror' && item.itemType === 'snag' && item.snagId
    const bucket = snagMirror ? 'snag-photos' : 'work-item-attachments'
    const folder = snagMirror ? item.snagId : item.id
    const path = `${item.organisationId}/${item.projectId}/${folder}/wa-${msg.id}.${ext}`
    await store.upload(bucket, path, bytes, mime)
    const r = await store.call('wa_add_attachment', { p_user: link.user_id, p_item: item.id, p_bucket: bucket,
      p_path: path, p_mime: mime, p_role: viaPendingDone ? 'closeout' : 'evidence', p_inbound: inbound.id })
    if (r?.code !== 'ok') return replyForCode(deps, to, r, item.id, link.user_id)
    if (msg.text) await store.call('wa_add_note', { p_user: link.user_id, p_item: item.id, p_body: msg.text, p_inbound: inbound.id })
    if (viaPendingDone) return markDone(deps, link, item.id)
    const burst = link.last_confirm_item_id === item.id && isWithin(link.last_confirm_at, now(), BURST_WINDOW_MS)
    if (!burst) {
      await meta.sendButtons(to, REPLIES.attached(r.ref),
        [{ id: encodePayload({ kind: 'wrong', target: 'attachment', id: r.id }), title: REPLIES.wrongItem }], msg.id)
    }
    await store.updateLink(link.id, { active_item_id: item.id, active_item_at: now().toISOString(),
      last_confirm_item_id: item.id, last_confirm_at: now().toISOString() })
    return result('applied', 'attachment', link.user_id, item.id)
  }

  if (msg.type === 'text' && msg.text) {
    if (viaPendingDone && link.pending_done_wants === 'answer') {
      const r = await store.call('wa_rfi_respond', { p_user: link.user_id, p_item: item.id, p_body: msg.text, p_inbound: inbound.id })
      if (r?.code !== 'ok') return replyForCode(deps, to, r, item.id, link.user_id)
      await store.updateLink(link.id, { pending_done_item_id: null, pending_done_at: null, pending_done_wants: null })
      await meta.sendText(to, REPLIES.answered(r.ref))
      return result('applied', 'answered', link.user_id, item.id)
    }
    const r = await store.call('wa_add_note', { p_user: link.user_id, p_item: item.id, p_body: msg.text, p_inbound: inbound.id })
    if (r?.code !== 'ok') return replyForCode(deps, to, r, item.id, link.user_id)
    await meta.sendButtons(to, REPLIES.noted(r.ref),
      [{ id: encodePayload({ kind: 'wrong', target: 'note', id: r.id }), title: REPLIES.wrongItem }], msg.id)
    await store.updateLink(link.id, { active_item_id: item.id, active_item_at: now().toISOString(),
      last_confirm_item_id: item.id, last_confirm_at: now().toISOString() })
    return result('applied', 'note', link.user_id, item.id)
  }

  await meta.sendText(to, REPLIES.unsupported)
  return result('refused', 'unsupported_type', link.user_id, item.id)
}

export async function processInbound(inbound: InboundRow, deps: ProcessorDeps): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const msg = asMessage(inbound.raw)
  const from = inbound.from_e164
  const nowIso = now().toISOString()
  const keyword = msg.type === 'text' && msg.text ? classifyKeyword(msg.text) : null
  const link = await store.linkByPhone(from)

  if (keyword === 'stop') {
    if (link && link.status !== 'opted_out') await store.updateLink(link.id, { status: 'opted_out' })
    await meta.sendText(from, REPLIES.optedOut)
    return result('applied', 'opted_out', link?.user_id ?? null, null)
  }
  if (keyword === 'start' && link?.status === 'opted_out') {
    await store.updateLink(link.id, { status: 'active', consent_at: nowIso, consent_text_version: CONSENT_TEXT_VERSION })
    await meta.sendText(from, REPLIES.restarted)
    return result('applied', 'restarted', link.user_id, null)
  }
  if (link?.status === 'opted_out') return result('refused', 'opted_out', link.user_id, null)   // they said stop: silence
  if (!link || (link.status !== 'active' && link.status !== 'pending_optin')) {
    if (!(await store.unknownSenderRecentlyAnswered(from, now()))) await meta.sendText(from, REPLIES.notLinked)
    return result('unknown_sender', link ? `link_${link.status}` : 'no_link', null, null)
  }

  const payload = decodePayload(msg.payload)

  if (link.status === 'pending_optin') {
    if (payload?.kind === 'optin' && payload.linkId === link.id) {
      if (payload.answer === 'yes') {
        await store.updateLink(link.id, { status: 'active', consent_at: nowIso, verified_at: nowIso,
          consent_text_version: CONSENT_TEXT_VERSION })
        const open = await store.call('wa_open_items', { p_user: link.user_id })
        await meta.sendText(from, REPLIES.optedIn(Array.isArray(open) ? open.length : 0))
        return result('applied', 'opted_in', link.user_id, null)
      }
      await store.updateLink(link.id, { status: 'opted_out' })
      await meta.sendText(from, REPLIES.optedOut)
      return result('applied', 'declined', link.user_id, null)
    }
    await meta.sendText(from, REPLIES.optinPrompt)
    return result('refused', 'pending_optin', link.user_id, null)
  }

  // ── active link ──
  if (payload?.kind === 'optin') return result('refused', 'already_active', link.user_id, null)

  if (payload?.kind === 'ack') {
    const r = await store.call('wa_acknowledge', { p_user: link.user_id, p_item: payload.itemId })
    if (r?.code !== 'ok') return replyForCode(deps, from, r, payload.itemId, link.user_id)
    await store.updateLink(link.id, { active_item_id: payload.itemId, active_item_at: nowIso })
    await meta.sendText(from, REPLIES.acked(r.ref))
    return result('applied', 'acknowledged', link.user_id, payload.itemId)
  }

  if (payload?.kind === 'done') return markDone(deps, link, payload.itemId)

  if (payload?.kind === 'wrong') {
    const r = await store.call('wa_redact', { p_user: link.user_id, p_kind: payload.target, p_id: payload.id })
    await meta.sendText(from, r?.code === 'ok' ? REPLIES.redacted(r.ref) : REPLIES.redactLate)
    return result(r?.code === 'ok' ? 'applied' : 'refused', r?.code === 'ok' ? 'redacted' : 'redact_refused', link.user_id, null)
  }

  if (payload?.kind === 'pick') {
    await store.updateLink(link.id, { active_item_id: payload.itemId, active_item_at: nowIso, pending_inbound_id: null })
    const held = link.pending_inbound_id ? await store.inboundById(link.pending_inbound_id) : null
    if (!held) return result('applied', 'picked', link.user_id, payload.itemId)
    const heldResult = await applyContent(deps, link, held, asMessage(held.raw), payload.itemId, false)
    await store.markInbound(held.id, { outcome: heldResult.outcome, outcome_reason: `picked:${heldResult.reason}`,
      resolved_user_id: link.user_id, resolved_item_id: payload.itemId, processed_at: nowIso })
    return result('applied', 'picked', link.user_id, payload.itemId)
  }

  if (msg.type !== 'text' && msg.type !== 'image') {
    await meta.sendText(from, REPLIES.unsupported)
    return result('refused', 'unsupported_type', link.user_id, null)
  }

  const contextItemId = msg.contextId ? await store.itemForSentMessage(msg.contextId) : null
  const target = resolveTarget({
    payloadItemId: null, contextItemId,
    pendingDoneItemId: link.pending_done_item_id, pendingDoneAt: link.pending_done_at,
    pendingDoneWants: link.pending_done_wants,
    activeItemId: link.active_item_id, activeItemAt: link.active_item_at,
    isImage: msg.type === 'image', now: now(),
  })

  if (target.kind === 'pick') {
    const open = await store.call('wa_open_items', { p_user: link.user_id })
    const rows = Array.isArray(open) ? open : []
    if (rows.length === 0) {
      await meta.sendText(from, REPLIES.noOpen)
      return result('unmatched', 'no_open_items', link.user_id, null)
    }
    await store.updateLink(link.id, { pending_inbound_id: inbound.id })
    await meta.sendList(from, REPLIES.pickPrompt, REPLIES.pickButton,
      rows.map((x: { id: string; ref: string; title: string; project_name: string }) =>
        ({ id: encodePayload({ kind: 'pick', itemId: x.id }), title: x.ref, description: `${x.project_name} · ${x.title}` })))
    return result('unmatched', 'picking', link.user_id, null)
  }

  return applyContent(deps, link, inbound, msg, target.itemId, target.via === 'pending_done')
}

/** Claim and process pending inbound rows (webhook: fresh ones; worker: stragglers older than minAge). */
export async function processPending(
  deps: ProcessorDeps & { store: ProcessorStore & { claimInbound(limit: number, minAgeSeconds: number): Promise<InboundRow[]> } },
  limit = 20,
  minAgeSeconds = 0,
): Promise<number> {
  const rows = await deps.store.claimInbound(limit, minAgeSeconds)
  for (const inbound of rows) {
    try {
      const r = await processInbound(inbound, deps)
      await deps.store.markInbound(inbound.id, { outcome: r.outcome, outcome_reason: r.reason,
        resolved_user_id: r.userId, resolved_item_id: r.itemId, processed_at: deps.now().toISOString() })
    } catch (e) {
      // Left 'pending'; claim_inbound retries it (max 5 attempts) after 2 minutes.
      console.error('whatsapp: processing failed', inbound.id, e)
    }
  }
  return rows.length
}

export { WRONG_ITEM_WINDOW_MS }
