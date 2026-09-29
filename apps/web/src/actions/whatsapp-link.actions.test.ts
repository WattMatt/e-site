// apps/web/src/actions/whatsapp-link.actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/whatsapp/fake-supabase'
import { hashOtp } from '@/lib/whatsapp/otp'

const { createClientMock, createServiceClientMock, kickMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(), createServiceClientMock: vi.fn(), kickMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: createServiceClientMock }))
vi.mock('@/lib/whatsapp/kick-worker', () => ({ kickWhatsAppWorker: kickMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requestWhatsAppCodeAction, confirmWhatsAppCodeAction, removeWhatsAppLinkAction } from './whatsapp-link.actions'

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const signedIn = () => createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } })

beforeEach(() => { vi.clearAllMocks(); signedIn() })

describe('requestWhatsAppCodeAction', () => {
  it('refuses an implausible number without touching the database', async () => {
    const svc = fakeSupabase(); createServiceClientMock.mockReturnValue(svc)
    expect(await requestWhatsAppCodeAction({ phone: '12' })).toEqual({ error: 'Enter a valid mobile number, e.g. 082 123 4567.' })
    expect(svc.calls).toEqual([])
  })
  it('refuses a number already live on ANOTHER account', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: [{ id: 'x', user_id: 'someone-else', status: 'active' }] }] })
    createServiceClientMock.mockReturnValue(svc)
    const r = await requestWhatsAppCodeAction({ phone: '082 123 4567' })
    expect(r).toEqual({ error: 'That number is already linked to another E-Site account.' })
    expect(kickMock).not.toHaveBeenCalled()
  })
  it('stores a HASH (never the code), queues the OTP, kicks the worker', async () => {
    const svc = fakeSupabase({
      'phone_links:select': [{ data: [] }, { data: null }],
      'phone_links:insert': [{ data: { id: LINK } }],
      'outbox:insert': [{ data: null }],
    })
    createServiceClientMock.mockReturnValue(svc)
    const r = await requestWhatsAppCodeAction({ phone: '082 123 4567' })
    expect(r).toEqual({ ok: true, masked: '+27 82 *** 4567' })
    const ins = svc.calls.find((c) => c.table === 'phone_links' && c.op === 'insert')!.args[0]
    expect(ins).toMatchObject({ user_id: ME, phone_e164: '+27821234567', status: 'pending_otp' })
    expect(ins.otp_hash).toMatch(/^[0-9a-f]{64}$/)
    const upd = svc.calls.find((c) => c.table === 'phone_links' && c.op === 'update')!.args[0]
    const out = svc.calls.find((c) => c.table === 'outbox' && c.op === 'insert')!.args[0]
    expect(out).toMatchObject({ user_id: ME, link_id: LINK, trigger: 'otp' })
    expect(upd.otp_hash).toBe(hashOtp(LINK, out.payload.code))
    expect(kickMock).toHaveBeenCalledWith('otp')
  })
  it('caps code sends at 3 per hour', async () => {
    const svc = fakeSupabase({
      'phone_links:select': [{ data: [] }, { data: { id: LINK, status: 'pending_otp', otp_window_start: new Date().toISOString(), otp_window_count: 3 } }],
    })
    createServiceClientMock.mockReturnValue(svc)
    expect(await requestWhatsAppCodeAction({ phone: '0821234567' })).toEqual({ error: 'Too many codes — try again in an hour.' })
  })
})

describe('confirmWhatsAppCodeAction', () => {
  const pending = (over: Record<string, unknown> = {}) => ({ id: LINK, user_id: ME, status: 'pending_otp',
    otp_hash: hashOtp(LINK, '123456'), otp_expires_at: new Date(Date.now() + 60_000).toISOString(), otp_attempts: 0, ...over })

  it('a wrong code counts an attempt and fails', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending() }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '000000' })).toEqual({ error: "That code isn't right." })
    expect(svc.calls.find((c) => c.op === 'update')!.args[0]).toEqual({ otp_attempts: 1 })
  })
  it('the right code after 5 failures is still refused', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending({ otp_attempts: 5 }) }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '123456' })).toEqual({ error: 'Too many attempts — request a new code.' })
  })
  it('an expired code is refused', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending({ otp_expires_at: new Date(Date.now() - 1).toISOString() }) }] })
    createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '123456' })).toEqual({ error: 'That code has expired — request a new one.' })
  })
  it('the right code activates with recorded consent and clears the hash', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending() }], 'phone_links:update': [{ data: null }] })
    createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '123456' })).toEqual({ ok: true })
    const upd = svc.calls.find((c) => c.op === 'update')!.args[0]
    expect(upd).toMatchObject({ status: 'active', otp_hash: null, consent_text_version: '2026-09-28.1' })
    expect(upd.consent_at).toBeTruthy()
    expect(upd.verified_at).toBeTruthy()
  })
})

describe('removeWhatsAppLinkAction', () => {
  it('opts the caller\'s own live link out', async () => {
    const svc = fakeSupabase({ 'phone_links:update': [{ data: null }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await removeWhatsAppLinkAction()).toEqual({ ok: true })
    expect(svc.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'update', args: [expect.objectContaining({ status: 'opted_out' })] }),
      expect.objectContaining({ op: 'eq', args: ['user_id', ME] }),
    ]))
  })
})
