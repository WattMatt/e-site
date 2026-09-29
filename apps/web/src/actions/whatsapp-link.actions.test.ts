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

import { requestWhatsAppCodeAction, getWhatsAppLinkStatusAction, removeWhatsAppLinkAction } from './whatsapp-link.actions'

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
  it('stores a HASH (never the code) and returns the message to SEND — nothing is sent outbound', async () => {
    process.env.WHATSAPP_BUSINESS_NUMBER = '+1 555 157 6223'
    const svc = fakeSupabase({
      'phone_links:select': [{ data: [] }, { data: null }],
      'phone_links:insert': [{ data: { id: LINK } }],
    })
    createServiceClientMock.mockReturnValue(svc)
    const r = await requestWhatsAppCodeAction({ phone: '082 123 4567' })
    if (!('ok' in r)) throw new Error('expected ok')
    expect(r).toMatchObject({ ok: true, masked: '+27 82 *** 4567', waNumber: '15551576223' })
    const code = /^LINK (\d{6})$/.exec(r.message)![1]
    const ins = svc.calls.find((c) => c.table === 'phone_links' && c.op === 'insert')!.args[0]
    expect(ins).toMatchObject({ user_id: ME, phone_e164: '+27821234567', status: 'pending_otp' })
    const upd = svc.calls.find((c) => c.table === 'phone_links' && c.op === 'update')!.args[0]
    expect(upd.otp_hash).toBe(hashOtp(LINK, code))
    expect(JSON.stringify(svc.calls)).not.toContain(code)
    expect(svc.calls.some((c) => c.table === 'outbox')).toBe(false)
    expect(kickMock).not.toHaveBeenCalled()
  })
  it('works without a configured business number (the page then names the number in text)', async () => {
    delete process.env.WHATSAPP_BUSINESS_NUMBER
    createServiceClientMock.mockReturnValue(fakeSupabase({ 'phone_links:select': [{ data: [] }, { data: null }], 'phone_links:insert': [{ data: { id: LINK } }] }))
    const r = await requestWhatsAppCodeAction({ phone: '082 123 4567' })
    expect(r).toMatchObject({ ok: true, waNumber: null })
  })
  it('caps code sends at 3 per hour', async () => {
    const svc = fakeSupabase({
      'phone_links:select': [{ data: [] }, { data: { id: LINK, status: 'pending_otp', otp_window_start: new Date().toISOString(), otp_window_count: 3 } }],
    })
    createServiceClientMock.mockReturnValue(svc)
    expect(await requestWhatsAppCodeAction({ phone: '0821234567' })).toEqual({ error: 'Too many codes — try again in an hour.' })
  })
})

describe('getWhatsAppLinkStatusAction', () => {
  it('active once the webhook has activated the link', async () => {
    createServiceClientMock.mockReturnValue(fakeSupabase({ 'phone_links:select': [{ data: { status: 'active', phone_e164: '+27821234567' } }] }))
    expect(await getWhatsAppLinkStatusAction()).toEqual({ status: 'active', masked: '+27 82 *** 4567' })
  })
  it('pending while waiting for the code to arrive', async () => {
    createServiceClientMock.mockReturnValue(fakeSupabase({ 'phone_links:select': [{ data: { status: 'pending_otp', phone_e164: '+27821234567' } }] }))
    expect(await getWhatsAppLinkStatusAction()).toEqual({ status: 'pending', masked: '+27 82 *** 4567' })
  })
  it('none when nothing is in progress', async () => {
    createServiceClientMock.mockReturnValue(fakeSupabase({ 'phone_links:select': [{ data: null }] }))
    expect(await getWhatsAppLinkStatusAction()).toEqual({ status: 'none' })
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
