// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { processInbound, type ProcessorStore, type InboundRow } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
import { LINK_REPLIES } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/link-code.ts'
import type { MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const PHONE = '+27821234567'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = new Date('2026-10-01T10:00:00Z')
const hash = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex')

type Pending = { id: string; user_id: string; otp_hash: string; otp_expires_at: string; otp_attempts: number }
let pending: Pending[]
let patches: Array<[string, Record<string, unknown>]>
let sent: string[]
let store: ProcessorStore
let meta: MetaClient

const row = (text: string): InboundRow => ({ id: 'in-1', meta_message_id: 'wamid.1', from_e164: PHONE, attempts: 1,
  raw: { id: 'wamid.1', from: '27821234567', timestamp: '1', type: 'text', text, contextId: null, payload: null, imageId: null, imageMime: null } })

beforeEach(() => {
  pending = [{ id: LINK, user_id: 'U', otp_hash: hash(LINK, '482917'), otp_expires_at: new Date(NOW.getTime() + 60_000).toISOString(), otp_attempts: 0 }]
  patches = []
  sent = []
  store = {
    pendingOtpLinks: vi.fn(async () => pending),
    updateLink: vi.fn(async (id: string, p: Record<string, unknown>) => { patches.push([id, p]) }),
    linkByPhone: vi.fn(async () => null),
    unknownSenderRecentlyAnswered: vi.fn(async () => false),
  } as never
  meta = { sendText: vi.fn(async (_to: string, body: string) => { sent.push(body); return 'o' }) } as never
})
const deps = () => ({ store, meta, now: () => NOW, appUrl: 'https://www.e-site.live' })

describe('linking by an inbound code', () => {
  it('the right code FROM the number being linked activates it, with consent recorded', async () => {
    const r = await processInbound(row('LINK 482917'), deps())
    expect(r).toMatchObject({ outcome: 'applied', reason: 'linked', userId: 'U' })
    expect(patches[0]).toEqual([LINK, expect.objectContaining({ status: 'active', otp_hash: null, consent_text_version: '2026-09-28.1' })])
    expect(patches[0][1].consent_at).toBe(NOW.toISOString())
    expect(sent).toEqual([LINK_REPLIES.linked])
  })
  it('a wrong code counts an attempt and activates nothing', async () => {
    const r = await processInbound(row('LINK 000000'), deps())
    expect(r.reason).toBe('link_code_wrong')
    expect(patches).toEqual([[LINK, { otp_attempts: 1 }]])
    expect(sent).toEqual([LINK_REPLIES.wrong])
  })
  it('the right code after 5 failures is refused', async () => {
    pending[0].otp_attempts = 5
    const r = await processInbound(row('LINK 482917'), deps())
    expect(r.reason).toBe('link_code_locked')
    expect(patches).toEqual([])
  })
  it('an expired code is refused', async () => {
    pending[0].otp_expires_at = new Date(NOW.getTime() - 1).toISOString()
    const r = await processInbound(row('LINK 482917'), deps())
    expect(r.reason).toBe('link_code_expired')
    expect(patches).toEqual([])
  })
  it('a code from a number nobody is linking is refused (ownership is the point)', async () => {
    pending = []
    const r = await processInbound(row('LINK 482917'), deps())
    expect(r.reason).toBe('no_pending_link')
    expect(sent).toEqual([LINK_REPLIES.noPending])
  })
  it('just the six digits (no LINK prefix) from a number mid-link also links — people type the code they see', async () => {
    ;(store.linkByPhone as ReturnType<typeof vi.fn>).mockResolvedValue({ id: LINK, user_id: 'U', phone_e164: PHONE, status: 'pending_otp' })
    const r = await processInbound(row(' 482917 '), deps())
    expect(r).toMatchObject({ outcome: 'applied', reason: 'linked' })
    expect(sent).toEqual([LINK_REPLIES.linked])
  })
  it('six digits from a number with NO link in progress is not treated as a code', async () => {
    const r = await processInbound(row('482917'), deps())
    expect(r.outcome).toBe('unknown_sender')
    expect(store.pendingOtpLinks).not.toHaveBeenCalled()
  })
  it('anything else from a number mid-link is told to send the code, never "ask your project manager"', async () => {
    ;(store.linkByPhone as ReturnType<typeof vi.fn>).mockResolvedValue({ id: LINK, user_id: 'U', phone_e164: PHONE, status: 'pending_otp' })
    const r = await processInbound(row('hello'), deps())
    expect(r).toMatchObject({ outcome: 'refused', reason: 'awaiting_link_code', userId: 'U' })
    expect(sent).toEqual([LINK_REPLIES.sendCode])
    expect(patches).toEqual([])
  })
  it('if another account took the number meanwhile, it says so', async () => {
    ;(store.updateLink as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
    const r = await processInbound(row('LINK 482917'), deps())
    expect(r.reason).toBe('link_conflict')
    expect(sent).toEqual([LINK_REPLIES.taken])
  })
})
