// apps/web/src/actions/whatsapp-invite.actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/whatsapp/fake-supabase'

const { createClientMock, createServiceClientMock, kickMock, gateMock, logMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(), createServiceClientMock: vi.fn(), kickMock: vi.fn(), gateMock: vi.fn(), logMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: createServiceClientMock }))
vi.mock('@/lib/whatsapp/kick-worker', () => ({ kickWhatsAppWorker: kickMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: gateMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<object>()), logAuthEvent: logMock }))

import { inviteWhatsAppExternalAction } from './whatsapp-invite.actions'

const PM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NEW_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const input = { projectId: PROJECT, fullName: 'Sipho Dlamini', phone: '082 123 4567' }

beforeEach(() => {
  vi.clearAllMocks()
  createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: PM } } }) } })
  gateMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

function svcWith(responses: Record<string, Array<{ data?: unknown; error?: unknown }>>, createUser = vi.fn(async (_args: Record<string, unknown>) => ({ data: { user: { id: NEW_USER } }, error: null }))) {
  const svc = fakeSupabase(responses) as ReturnType<typeof fakeSupabase> & { auth: unknown }
  svc.auth = { admin: { createUser, deleteUser: vi.fn(async () => ({})) } }
  createServiceClientMock.mockReturnValue(svc)
  return { svc, createUser }
}

describe('inviteWhatsAppExternalAction', () => {
  it('refuses a caller without a project write role — nothing created', async () => {
    gateMock.mockResolvedValue({ ok: false, error: 'Insufficient permissions' })
    const { createUser } = svcWith({})
    expect(await inviteWhatsAppExternalAction(input)).toEqual({ error: 'Insufficient permissions' })
    expect(createUser).not.toHaveBeenCalled()
  })
  it('an already-linked number offers the existing person instead of a duplicate account', async () => {
    const { createUser } = svcWith({ 'phone_links:select': [{ data: { user_id: NEW_USER, status: 'active' } }], 'profiles:select': [{ data: { full_name: 'Sipho D' } }] })
    expect(await inviteWhatsAppExternalAction(input)).toEqual({ existing: { userId: NEW_USER, name: 'Sipho D' } })
    expect(createUser).not.toHaveBeenCalled()
  })
  it('creates a passwordless placeholder-email account, contractor on THIS project only, pending opt-in', async () => {
    const { svc, createUser } = svcWith({
      'phone_links:select': [{ data: null }],
      'projects:select': [{ data: { id: PROJECT, name: 'KINGSWALK', organisation_id: 'ORG' } }],
      'profiles:select': [{ data: { full_name: 'Arno' } }],
      'phone_links:insert': [{ data: { id: 'LINK' } }],
    })
    const r = await inviteWhatsAppExternalAction(input)
    expect(r).toEqual({ ok: true, userId: NEW_USER })
    const cu = createUser.mock.calls[0]![0] as Record<string, any>
    expect(cu.email).toMatch(/^wa-[0-9a-f-]{36}@wa\.e-site\.live$/)
    expect(cu).not.toHaveProperty('password')
    expect(cu.app_metadata).toMatchObject({ provisioned_via: 'whatsapp', invited_by: PM })
    const ins = (t: string) => svc.calls.filter((c) => c.table === t && c.op === 'insert').map((c) => c.args[0])
    expect(ins('user_organisations')[0]).toMatchObject({ user_id: NEW_USER, organisation_id: 'ORG', role: 'contractor', invited_by: PM })
    expect(ins('project_members')[0]).toMatchObject({ user_id: NEW_USER, project_id: PROJECT, role: 'contractor' })
    expect(ins('phone_links')[0]).toMatchObject({ user_id: NEW_USER, phone_e164: '+27821234567', status: 'pending_optin', invited_by: PM, invited_project_id: PROJECT })
    expect(ins('outbox')[0]).toMatchObject({ trigger: 'optin', link_id: 'LINK', payload: { inviter: 'Arno', project: 'KINGSWALK' } })
    expect(kickMock).toHaveBeenCalledWith('optin')
  })
  it('rolls the auth user back if the org membership fails', async () => {
    const { svc } = svcWith({
      'phone_links:select': [{ data: null }],
      'projects:select': [{ data: { id: PROJECT, name: 'K', organisation_id: 'ORG' } }],
      'profiles:select': [{ data: { full_name: 'Arno' } }],
      'user_organisations:insert': [{ error: { message: 'boom' } }],
    })
    expect(await inviteWhatsAppExternalAction(input)).toEqual({ error: 'Could not add them to the organisation: boom' })
    expect((svc.auth as { admin: { deleteUser: ReturnType<typeof vi.fn> } }).admin.deleteUser).toHaveBeenCalledWith(NEW_USER)
  })
})
