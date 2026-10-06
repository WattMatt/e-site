// apps/edge-functions/supabase/functions/_shared/whatsapp/store.ts
// Supabase-backed ports for processor.ts and worker.ts. Thin by design: every
// decision lives in the pure modules or in SQL. Uses the service client.
import { fromMetaWaId } from './core.ts'
import type { InboundMessage, StatusUpdate } from './parse.ts'
import type { InboundRow, ItemInfo, LinkRow, ProcessorStore } from './processor.ts'
import type { OutboxRow, WorkerStore } from './worker.ts'
import { classifyMetaError } from './meta-client.ts'

// deno-lint-ignore no-explicit-any
type Sb = any
const wa = (sb: Sb) => sb.schema('whatsapp')
const LIVE = ['active', 'pending_optin']
const WINDOW_CLOSED = 131047

// deno-lint-ignore no-explicit-any
function must(r: { data: any; error: { message: string } | null }, what: string): any {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data
}

export async function storeInbound(sb: Sb, messages: InboundMessage[]): Promise<void> {
  if (messages.length === 0) return
  const rows = messages.map(({ metaRaw, ...m }) => ({
    meta_message_id: m.id, from_e164: fromMetaWaId(m.from) ?? `+${m.from}`, raw: m, meta_raw: metaRaw ?? null,
    kind: m.type, context_message_id: m.contextId,
  }))
  must(await wa(sb).from('inbound').upsert(rows, { onConflict: 'meta_message_id', ignoreDuplicates: true }), 'store inbound')
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 }

export async function applyStatuses(sb: Sb, statuses: StatusUpdate[]): Promise<void> {
  for (const s of statuses) {
    const cur = must(await wa(sb).from('outbox').select('id, status, link_id, user_id').eq('meta_message_id', s.id).maybeSingle(), 'status lookup')
    if (!cur) continue
    if (s.status === 'failed') {
      must(await wa(sb).from('outbox').update({ status: 'failed', error_code: s.errorCode, error_text: s.errorTitle, updated_at: new Date().toISOString() }).eq('id', cur.id), 'status failed')
      // 131047 = the 24-hour window had closed: that message is lost, the number is fine.
      if (s.errorCode !== null && s.errorCode !== WINDOW_CLOSED && classifyMetaError(s.errorCode, 200) === 'recipient') {
        must(await wa(sb).from('phone_links').update({ status: 'undeliverable', undeliverable_reason: `${s.errorCode} ${s.errorTitle ?? ''}`.trim() })
          .eq('user_id', cur.user_id).eq('status', 'active'), 'mark undeliverable')
      }
      continue
    }
    if ((RANK[s.status] ?? 0) > (RANK[cur.status] ?? 0)) {
      must(await wa(sb).from('outbox').update({ status: s.status, updated_at: new Date().toISOString() }).eq('id', cur.id), 'status advance')
    }
  }
}

export function createProcessorStore(sb: Sb): ProcessorStore & { claimInbound(limit: number, minAgeSeconds: number): Promise<InboundRow[]> } {
  return {
    async linkByPhone(e164) {
      const rows = must(await wa(sb).from('phone_links').select('*').eq('phone_e164', e164).order('created_at', { ascending: false }), 'link lookup') as LinkRow[]
      return rows.find((r) => LIVE.includes(r.status)) ?? rows[0] ?? null
    },
    async updateLink(id, patch) {
      must(await wa(sb).from('phone_links').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'update link')
    },
    async itemForSentMessage(mid) {
      const r = must(await wa(sb).from('outbox').select('work_item_id').eq('meta_message_id', mid).maybeSingle(), 'context lookup')
      return r?.work_item_id ?? null
    },
    async itemInfo(id): Promise<ItemInfo | null> {
      const r = must(await sb.schema('projects').from('work_items')
        .select('id, ref, title, item_type, origin, project_id, organisation_id, snag_id, status').eq('id', id).maybeSingle(), 'item lookup')
      return r ? { id: r.id, ref: r.ref, title: r.title, itemType: r.item_type, origin: r.origin, projectId: r.project_id,
                   organisationId: r.organisation_id, snagId: r.snag_id, status: r.status } : null
    },
    async call(fn, args) {
      return must(await wa(sb).rpc(fn, args), fn)
    },
    async download(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).download(path)
      if (error || !data) throw new Error(`download ${bucket}: ${error?.message ?? 'no data'}`)
      return new Uint8Array(await data.arrayBuffer())
    },
    async upload(bucket, path, bytes, mime) {
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false })
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`upload: ${error.message}`)
    },
    async unknownSenderRecentlyAnswered(e164, now) {
      const r = must(await wa(sb).from('unknown_senders').select('last_replied_at').eq('phone_e164', e164).maybeSingle(), 'unknown lookup')
      if (r && now.getTime() - Date.parse(r.last_replied_at) < 86_400_000) return true
      must(await wa(sb).from('unknown_senders').upsert({ phone_e164: e164, last_replied_at: now.toISOString() }, { onConflict: 'phone_e164' }), 'unknown record')
      return false
    },
    async pendingOtpLinks(e164) {
      return (must(await wa(sb).from('phone_links').select('id, user_id, otp_hash, otp_expires_at, otp_attempts')
        .eq('phone_e164', e164).eq('status', 'pending_otp').order('created_at', { ascending: false }), 'pending otp links') ?? [])
    },
    async inboundById(id) {
      return must(await wa(sb).from('inbound').select('id, meta_message_id, from_e164, raw, attempts').eq('id', id).maybeSingle(), 'inbound lookup')
    },
    async markInbound(id, patch) {
      must(await wa(sb).from('inbound').update(patch).eq('id', id), 'mark inbound')
    },
    async claimInbound(limit, minAgeSeconds) {
      return must(await wa(sb).rpc('claim_inbound', { p_limit: limit, p_min_age_seconds: minAgeSeconds }), 'claim inbound') ?? []
    },
  }
}

export function createWorkerStore(sb: Sb): WorkerStore {
  return {
    async sendingEnabled() {
      const r = must(await wa(sb).from('settings').select('sending_enabled').eq('id', true).maybeSingle(), 'settings')
      return Boolean(r?.sending_enabled)
    },
    async claim(limit) {
      return (must(await wa(sb).rpc('claim_outbox', { p_limit: limit }), 'claim outbox') ?? []) as OutboxRow[]
    },
    async activeLink(userId) {
      return must(await wa(sb).from('phone_links').select('id, phone_e164, status, quiet_start, quiet_end')
        .eq('user_id', userId).eq('status', 'active').maybeSingle(), 'active link')
    },
    async linkById(id) {
      return must(await wa(sb).from('phone_links').select('id, phone_e164, status').eq('id', id).maybeSingle(), 'link by id')
    },
    async canReceive(userId, itemId) {
      return must(await wa(sb).rpc('receive_check', { p_user: userId, p_item: itemId }), 'receive check')
    },
    async sentItemCountToday(userId, sastDay) {
      const dayStartUtc = new Date(Date.parse(sastDay + 'T00:00:00Z') - 2 * 3600_000).toISOString()
      const { count, error } = await wa(sb).from('outbox').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).in('trigger', ['assigned', 'due_tomorrow', 'overdue'])
        .in('status', ['sent', 'delivered', 'read']).gte('sent_at', dayStartUtc)
      if (error) throw new Error(`count: ${error.message}`)
      return count ?? 0
    },
    async enqueueFold(userId, sastDay) {
      must(await wa(sb).rpc('enqueue_fold', { p_user: userId, p_day: sastDay }), 'enqueue fold')
    },
    async mark(id, patch) {
      must(await wa(sb).from('outbox').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'mark outbox')
    },
    async setLinkActiveItem(linkId, itemId, atIso) {
      must(await wa(sb).from('phone_links').update({ active_item_id: itemId, active_item_at: atIso }).eq('id', linkId), 'active item')
    },
    async markLinkUndeliverable(linkId, reason) {
      must(await wa(sb).from('phone_links').update({ status: 'undeliverable', undeliverable_reason: reason }).eq('id', linkId), 'undeliverable')
    },
    async formReceiveCheck(outboxId) {
      return must(await wa(sb).rpc('form_receive_check', { p_outbox: outboxId }), 'form receive check') ?? 'gone'
    },
    async formSummary(sessionId) {
      const s = must(await wa(sb).from('form_sessions').select('user_id, inspection_id').eq('id', sessionId).maybeSingle(), 'form session')
      if (!s) return null
      const i = must(await sb.schema('inspections').from('inspections').select('target_label, template_id, project_id, verifier_id')
        .eq('id', s.inspection_id).maybeSingle(), 'form inspection')
      if (!i) return null
      const [t, p, people] = await Promise.all([
        sb.schema('inspections').from('templates').select('name').eq('id', i.template_id).maybeSingle(),
        sb.schema('projects').from('projects').select('name').eq('id', i.project_id).maybeSingle(),
        sb.from('profiles').select('id, full_name').in('id', [s.user_id, i.verifier_id].filter(Boolean)),
      ])
      const name = (id: string | null) => (must(people, 'form people') ?? []).find((x: { id: string }) => x.id === id)?.full_name ?? null
      const templateName = must(t, 'form template')?.name ?? 'Inspection'
      return { label: i.target_label || templateName, templateName, projectName: must(p, 'form project')?.name ?? 'the project',
        submitterName: name(s.user_id) ?? 'A team member', verifierName: name(i.verifier_id) }
    },
    async templateApproved(name) {
      const r = must(await wa(sb).from('templates').select('status').eq('name', name).maybeSingle(), 'template status')
      return r?.status === 'approved'
    },
    async outboundPdf(sessionId) {
      const { data, error } = await sb.storage.from('whatsapp-media').download(`outbound/${sessionId}.pdf`)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },
    async recordPolicyError(text) {
      console.error('whatsapp policy error:', text)
      must(await wa(sb).from('settings').update({ last_policy_error_at: new Date().toISOString(), last_policy_error: text }).eq('id', true), 'policy error')
    },
  }
}
