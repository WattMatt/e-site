// apps/web/src/actions/whatsapp-admin.actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/whatsapp/fake-supabase'

const { getOrgContextMock, createServiceClientMock } = vi.hoisted(() => ({ getOrgContextMock: vi.fn(), createServiceClientMock: vi.fn() }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock, createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { setWhatsAppSendingAction } from './whatsapp-admin.actions'

beforeEach(() => vi.clearAllMocks())

describe('setWhatsAppSendingAction', () => {
  it.each(['project_manager', 'contractor', 'client_viewer'])('refuses %s', async (role) => {
    getOrgContextMock.mockResolvedValue({ userId: 'u', organisationId: 'o', role })
    const svc = fakeSupabase(); createServiceClientMock.mockReturnValue(svc)
    expect(await setWhatsAppSendingAction({ enabled: true })).toEqual({ error: 'Only an owner or admin can change this.' })
    expect(svc.calls).toEqual([])
  })
  it('owner flips the platform switch', async () => {
    getOrgContextMock.mockResolvedValue({ userId: 'u', organisationId: 'o', role: 'owner' })
    const svc = fakeSupabase({ 'settings:update': [{ data: null }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await setWhatsAppSendingAction({ enabled: true })).toEqual({ ok: true })
    expect(svc.calls.find((c) => c.op === 'update')!.args[0]).toMatchObject({ sending_enabled: true })
  })
})

import { setWhatsAppFormsEnabledAction } from './whatsapp-admin.actions'

describe('setWhatsAppFormsEnabledAction (E4, per organisation)', () => {
  it.each(['project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer'])('refuses %s', async (role) => {
    getOrgContextMock.mockResolvedValue({ userId: 'u', organisationId: 'o', role })
    const svc = fakeSupabase(); createServiceClientMock.mockReturnValue(svc)
    expect(await setWhatsAppFormsEnabledAction({ enabled: true })).toEqual({ error: 'Only an owner or admin can change this.' })
    expect(svc.calls).toEqual([])
  })
  it('an admin switches it for THEIR organisation only, recording who', async () => {
    getOrgContextMock.mockResolvedValue({ userId: 'u-admin', organisationId: 'org-1', role: 'admin' })
    const svc = fakeSupabase({ 'org_settings:upsert': [{ data: null }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await setWhatsAppFormsEnabledAction({ enabled: true })).toEqual({ ok: true })
    const up = svc.calls.find((c) => c.op === 'upsert')!
    expect(up.args[0]).toMatchObject({ organisation_id: 'org-1', forms_enabled: true, updated_by: 'u-admin' })
  })
  it('rejects a non-boolean', async () => {
    getOrgContextMock.mockResolvedValue({ userId: 'u', organisationId: 'o', role: 'owner' })
    createServiceClientMock.mockReturnValue(fakeSupabase())
    await expect(setWhatsAppFormsEnabledAction({ enabled: 'yes' as never })).rejects.toBeTruthy()
  })
})
