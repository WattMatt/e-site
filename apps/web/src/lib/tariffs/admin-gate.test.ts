import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('next/navigation', () => ({
  notFound: () => { h.notFound(); throw new Error('NOT_FOUND') },
  redirect: (to: string) => { h.redirect(to); throw new Error(`REDIRECT:${to}`) },
}))

import { isPlatformTariffAdmin, requirePlatformTariffAdmin, requirePlatformTariffAdminAPI, requirePlatformTariffAdminPage } from './admin-gate'
import { fakeSupabase } from '@/test/fake-supabase'

beforeEach(() => vi.clearAllMocks())

describe('platform tariff admin gate', () => {
  it('asks the database helper and fails closed on error', async () => {
    expect(await isPlatformTariffAdmin(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: true, error: null } } }).client as never)).toBe(true)
    expect(await isPlatformTariffAdmin(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client as never)).toBe(false)
    expect(await isPlatformTariffAdmin(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: null, error: { message: 'x' } } } }).client as never)).toBe(false)
  })
  it('pages 404 for a signed-in non-admin and send the signed-out to login', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client)
    await expect(requirePlatformTariffAdminPage()).rejects.toThrow('NOT_FOUND')
    h.createClient.mockResolvedValue(fakeSupabase({ userId: null }).client)
    await expect(requirePlatformTariffAdminPage()).rejects.toThrow('REDIRECT:/login')
  })
  it('actions return a sentence, never a redirect', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client)
    expect(await requirePlatformTariffAdmin()).toEqual({ ok: false, error: 'You do not have permission to do that.' })
    h.createClient.mockResolvedValue(fakeSupabase({ userId: 'u1', rpc: { is_platform_tariff_admin: { data: true, error: null } } }).client)
    expect(await requirePlatformTariffAdmin()).toMatchObject({ ok: true, userId: 'u1' })
  })
  it('API: 401 signed out, 404 non-admin', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ userId: null }).client)
    const a = await requirePlatformTariffAdminAPI()
    expect(a.ok === false && a.response.status).toBe(401)
    h.createClient.mockResolvedValue(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client)
    const b = await requirePlatformTariffAdminAPI()
    expect(b.ok === false && b.response.status).toBe(404)
  })
})
