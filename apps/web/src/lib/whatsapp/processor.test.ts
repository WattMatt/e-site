// apps/web/src/lib/whatsapp/processor.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processInbound, REPLIES, type ProcessorStore, type LinkRow, type ItemInfo, type InboundRow }
  from '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
import type { MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NOTE = '33333333-3333-4333-8333-333333333333'
const PHONE = '+27821234567'
const NOW = new Date('2026-10-01T10:00:00Z')

const items: Record<string, ItemInfo> = {
  [A]: { id: A, ref: 'T-1', title: 'Loose DB-3 cover', itemType: 'task', origin: 'manual', projectId: 'P', organisationId: 'O', snagId: null, status: 'open' },
  [B]: { id: B, ref: 'T-2', title: 'Label DB-4', itemType: 'task', origin: 'manual', projectId: 'P', organisationId: 'O', snagId: null, status: 'open' },
}

function link(over: Partial<LinkRow> = {}): LinkRow {
  return { id: LINK, user_id: USER, phone_e164: PHONE, status: 'active', active_item_id: null, active_item_at: null,
    pending_done_item_id: null, pending_done_at: null, pending_done_wants: null, pending_inbound_id: null,
    last_confirm_item_id: null, last_confirm_at: null, ...over }
}

function row(raw: Record<string, unknown>): InboundRow {
  return { id: 'in-1', meta_message_id: String(raw.id ?? 'wamid.IN'), from_e164: PHONE, raw: { id: 'wamid.IN', from: '27821234567', timestamp: '1', contextId: null, text: null, payload: null, imageId: null, imageMime: null, type: 'text', ...raw }, attempts: 1 }
}

let store: ProcessorStore & { calls: Array<[string, Record<string, unknown>]>; linkPatches: Array<Record<string, unknown>> }
let meta: MetaClient & { sent: Array<{ kind: string; to: string; body: string; extra?: unknown }> }
let rpc: Record<string, Record<string, unknown>>

beforeEach(() => {
  rpc = {}
  const calls: Array<[string, Record<string, unknown>]> = []
  const linkPatches: Array<Record<string, unknown>> = []
  let current: LinkRow | null = link()
  store = {
    calls, linkPatches,
    setLink(l: LinkRow | null) { current = l },
    linkByPhone: vi.fn(async () => current),
    updateLink: vi.fn(async (_id, patch) => { linkPatches.push(patch) }),
    itemForSentMessage: vi.fn(async (mid: string) => (mid === 'wamid.CARD-B' ? B : null)),
    itemInfo: vi.fn(async (id: string) => items[id] ?? null),
    call: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return rpc[fn] ?? { code: 'ok', ref: 'T-1', id: NOTE } }),
    upload: vi.fn(async () => {}),
    unknownSenderRecentlyAnswered: vi.fn(async () => false),
    inboundById: vi.fn(async () => null),
    markInbound: vi.fn(async () => {}),
  } as never
  const sent: Array<{ kind: string; to: string; body: string; extra?: unknown }> = []
  meta = {
    sent,
    sendTemplate: vi.fn(),
    sendText: vi.fn(async (to: string, body: string) => { sent.push({ kind: 'text', to, body }); return 'o' }),
    sendButtons: vi.fn(async (to: string, body: string, buttons: unknown) => { sent.push({ kind: 'buttons', to, body, extra: buttons }); return 'o' }),
    sendList: vi.fn(async (to: string, body: string, _l: string, rows: unknown) => { sent.push({ kind: 'list', to, body, extra: rows }); return 'o' }),
    fetchMedia: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' })),
  } as never
})

const deps = () => ({ store, meta, now: () => NOW, appUrl: 'https://www.e-site.live' })
const setLink = (l: LinkRow | null) => (store as unknown as { setLink(l: LinkRow | null): void }).setLink(l)

describe('senders and consent', () => {
  it('unknown number: one polite reply, no action', async () => {
    setLink(null)
    const r = await processInbound(row({ type: 'text', text: 'hello' }), deps())
    expect(r.outcome).toBe('unknown_sender')
    expect(meta.sent).toEqual([{ kind: 'text', to: PHONE, body: REPLIES.notLinked }])
    expect(store.calls).toEqual([])
  })
  it('unknown number already answered today: silence', async () => {
    setLink(null)
    ;(store.unknownSenderRecentlyAnswered as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    await processInbound(row({ type: 'text', text: 'hello' }), deps())
    expect(meta.sent).toEqual([])
  })
  it('STOP opts out and confirms, from any link state', async () => {
    const r = await processInbound(row({ type: 'text', text: 'Stop' }), deps())
    expect(r).toMatchObject({ outcome: 'applied', reason: 'opted_out' })
    expect(store.linkPatches[0]).toMatchObject({ status: 'opted_out' })
    expect(meta.sent[0].body).toBe(REPLIES.optedOut)
  })
  it('an opted-out number gets no reply to ordinary messages', async () => {
    setLink(link({ status: 'opted_out' }))
    const r = await processInbound(row({ type: 'text', text: 'hi' }), deps())
    expect(r.reason).toBe('opted_out')
    expect(meta.sent).toEqual([])
  })
  it('START re-activates with fresh consent', async () => {
    setLink(link({ status: 'opted_out' }))
    await processInbound(row({ type: 'text', text: 'START' }), deps())
    expect(store.linkPatches[0]).toMatchObject({ status: 'active', consent_at: NOW.toISOString() })
  })
  it('pending opt-in: only the matching Yes activates', async () => {
    setLink(link({ status: 'pending_optin' }))
    rpc.wa_open_items = [{ id: A }, { id: B }] as never
    const r = await processInbound(row({ type: 'button', payload: `optin:yes:${LINK}` }), deps())
    expect(r.reason).toBe('opted_in')
    expect(store.linkPatches[0]).toMatchObject({ status: 'active', consent_at: NOW.toISOString(), verified_at: NOW.toISOString() })
    expect(meta.sent[0].body).toBe(REPLIES.optedIn(2))
  })
  it('pending opt-in: a Yes for ANOTHER link is refused', async () => {
    setLink(link({ status: 'pending_optin' }))
    const r = await processInbound(row({ type: 'button', payload: `optin:yes:${A}` }), deps())
    expect(r).toMatchObject({ outcome: 'refused', reason: 'pending_optin' })
    expect(store.linkPatches).toEqual([])
  })
  it('pending opt-in: No thanks opts out', async () => {
    setLink(link({ status: 'pending_optin' }))
    await processInbound(row({ type: 'button', payload: `optin:no:${LINK}` }), deps())
    expect(store.linkPatches[0]).toMatchObject({ status: 'opted_out' })
  })
})

describe('buttons', () => {
  it('Acknowledge calls wa_acknowledge as the linked user', async () => {
    rpc.wa_acknowledge = { code: 'ok', ref: 'T-1' }
    await processInbound(row({ type: 'button', payload: `ack:${A}` }), deps())
    expect(store.calls).toEqual([['wa_acknowledge', { p_user: USER, p_item: A }]])
    expect(meta.sent[0].body).toBe(REPLIES.acked('T-1'))
  })
  it('Mark done -> answered names the sign-off person', async () => {
    rpc.wa_mark_done = { code: 'ok', ref: 'T-1', status: 'answered', gatekeeper_name: 'Arno' }
    const r = await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(r.outcome).toBe('applied')
    expect(meta.sent[0].body).toBe(REPLIES.doneAnswered('T-1', 'Arno'))
  })
  it('Mark done refused by the guard relays the sentence', async () => {
    rpc.wa_mark_done = { code: 'refused', ref: 'T-1', message: 'Only the person who signs T-1 off can close it.' }
    const r = await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(r.outcome).toBe('refused')
    expect(meta.sent[0].body).toContain('Only the person who signs T-1 off')
  })
  it('Mark done needing a photo arms pending-done', async () => {
    rpc.wa_mark_done = { code: 'needs_photo', ref: 'SNAG-3' }
    await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(store.linkPatches[0]).toMatchObject({ pending_done_item_id: A, pending_done_wants: 'photo', pending_done_at: NOW.toISOString() })
    expect(meta.sent[0].body).toBe(REPLIES.needsPhoto('SNAG-3'))
  })
  it('Mark done on a module-owned mirror links out', async () => {
    rpc.wa_mark_done = { code: 'use_module', ref: 'INS-2' }
    await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(meta.sent[0].body).toBe(REPLIES.useModule('INS-2', `https://www.e-site.live/wa/${A}`))
  })
  it('Wrong item redacts, never moves', async () => {
    rpc.wa_redact = { code: 'ok', ref: 'T-1' }
    await processInbound(row({ type: 'interactive', payload: `wrong:note:${NOTE}` }), deps())
    expect(store.calls).toEqual([['wa_redact', { p_user: USER, p_kind: 'note', p_id: NOTE }]])
    expect(meta.sent[0].body).toBe(REPLIES.redacted('T-1'))
  })
})

describe('free content — never guess', () => {
  it('text with an active item becomes a note on it, with a Wrong-item button', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    rpc.wa_add_note = { code: 'ok', ref: 'T-1', id: NOTE }
    await processInbound(row({ type: 'text', text: 'Cover refitted' }), deps())
    expect(store.calls[0]).toEqual(['wa_add_note', { p_user: USER, p_item: A, p_body: 'Cover refitted', p_inbound: 'in-1' }])
    expect(meta.sent[0]).toMatchObject({ kind: 'buttons', body: REPLIES.noted('T-1'), extra: [{ id: `wrong:note:${NOTE}`, title: REPLIES.wrongItem }] })
  })
  it('a swipe-reply to item B\'s card goes to B even though A is active', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    await processInbound(row({ type: 'text', text: 'done', contextId: 'wamid.CARD-B' }), deps())
    expect(store.calls[0][1]).toMatchObject({ p_item: B })
  })
  it('no current item: asks which, stores the message, attaches NOTHING', async () => {
    rpc.wa_open_items = [{ id: A, ref: 'T-1', title: 'Loose DB-3 cover', project_name: 'K' }, { id: B, ref: 'T-2', title: 'Label', project_name: 'K' }] as never
    const r = await processInbound(row({ type: 'text', text: 'Cover refitted' }), deps())
    expect(r).toMatchObject({ outcome: 'unmatched', reason: 'picking' })
    expect(store.calls.map((c) => c[0]).filter((f) => f !== 'wa_my_projects')).toEqual(['wa_open_items'])
    expect(store.linkPatches[0]).toMatchObject({ pending_inbound_id: 'in-1' })
    expect(meta.sent[0].kind).toBe('list')
    expect((meta.sent[0].extra as Array<{ id: string }>).map((x) => x.id)).toEqual([`pick:${A}`, `pick:${B}`])
  })
  it('picking replays the held message onto the chosen item', async () => {
    setLink(link({ pending_inbound_id: 'in-0' }))
    ;(store.inboundById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row({ id: 'wamid.HELD', type: 'text', text: 'Cover refitted' }))
    rpc.wa_add_note = { code: 'ok', ref: 'T-2', id: NOTE }
    await processInbound(row({ type: 'interactive', payload: `pick:${B}` }), deps())
    expect(store.calls.find((c) => c[0] === 'wa_add_note')?.[1]).toMatchObject({ p_item: B, p_body: 'Cover refitted' })
    expect(store.markInbound).toHaveBeenCalledWith('in-1', expect.objectContaining({ outcome: 'applied', resolved_item_id: B }))
  })
  it('a photo is stored under the item\'s own org/project path, never a client path', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    rpc.wa_add_attachment = { code: 'ok', ref: 'T-1', id: NOTE }
    await processInbound(row({ id: 'wamid.PHOTO', type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg' }), deps())
    expect(store.upload).toHaveBeenCalledWith('work-item-attachments', `O/P/${A}/wa-wamid.PHOTO.jpg`, expect.any(Uint8Array), 'image/jpeg')
    expect(store.calls[0]).toEqual(['wa_add_attachment', { p_user: USER, p_item: A, p_bucket: 'work-item-attachments',
      p_path: `O/P/${A}/wa-wamid.PHOTO.jpg`, p_mime: 'image/jpeg', p_role: 'evidence', p_inbound: 'in-1' }])
  })
  it('a photo while Mark done waits for one is a CLOSEOUT and re-runs Mark done', async () => {
    setLink(link({ pending_done_item_id: A, pending_done_wants: 'photo', pending_done_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    rpc.wa_add_attachment = { code: 'ok', ref: 'T-1', id: NOTE }
    rpc.wa_mark_done = { code: 'ok', ref: 'T-1', status: 'answered', gatekeeper_name: 'Arno' }
    await processInbound(row({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg' }), deps())
    expect(store.calls.map((c) => c[0])).toEqual(['wa_add_attachment', 'wa_mark_done'])
    expect(store.calls[0][1]).toMatchObject({ p_role: 'closeout' })
    expect(store.linkPatches.some((p) => p.pending_done_item_id === null)).toBe(true)
  })
  it('a second photo within 60 s to the same item is not re-confirmed', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString(),
      last_confirm_item_id: A, last_confirm_at: new Date(NOW.getTime() - 20_000).toISOString() }))
    rpc.wa_add_attachment = { code: 'ok', ref: 'T-1', id: NOTE }
    await processInbound(row({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg' }), deps())
    expect(meta.sent).toEqual([])
  })
  it('voice notes and documents are declined politely', async () => {
    const r = await processInbound(row({ type: 'audio' }), deps())
    expect(r).toMatchObject({ outcome: 'refused', reason: 'unsupported_type' })
    expect(meta.sent[0].body).toBe(REPLIES.unsupported)
  })
})

describe('staleness guard', () => {
  it('a STALE active item still forces a pick', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 25 * 3600_000).toISOString() }))
    rpc.wa_open_items = [{ id: A, ref: 'T-1', title: 't', project_name: 'K' }] as never
    const r = await processInbound(row({ type: 'text', text: 'x' }), deps())
    expect(r.reason).toBe('picking')
  })
})
