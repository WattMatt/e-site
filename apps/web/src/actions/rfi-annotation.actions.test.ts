// @vitest-environment node
//
// Authorization gate for the floor-plan markup write actions.
//
// Regression guard for the defense-in-depth gap: before this, both actions
// checked only auth.getUser() and relied 100% on RLS. A read-only role
// (inspector/supplier/client_viewer) that could *see* an RFI could therefore
// reach the storage upload / DB insert with nothing but RLS between them and a
// write. These tests assert the app-layer gate (requireEffectiveRole with
// MARKUP_WRITE_ROLES) short-circuits BEFORE any storage or DB mutation.
//
// Style mirrors src/app/api/tenant-schedule/parse/route.test.ts: one fake
// supabase client serves auth.getUser (used by the action AND by the real
// requireEffectiveRole), the projects.rfis read, and the
// user_effective_project_role RPC (the gate under test). MARKUP_WRITE_ROLES +
// requireEffectiveRole are kept REAL — only I/O is faked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  getUserMock,
  rpcMock,
  uploadMock,
  attachInsertMock,
  annInsertMock,
  annUpdateMock,
  rfiResult,
  roleResult,
  attachResult,
  annResult,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  return {
    getUserMock: vi.fn(),
    rpcMock: vi.fn(),
    uploadMock: vi.fn(),
    attachInsertMock: vi.fn(),
    annInsertMock: vi.fn(),
    annUpdateMock: vi.fn(),
    rfiResult: { value: { data: null as any, error: null as any } },
    roleResult: { value: { data: null as any, error: null as any } },
    attachResult: { value: { data: null as any, error: null as any } },
    annResult: { value: { data: null as any, error: null as any } },
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => {
  const tableBuilder = (table: string) => {
    const b: any = {
      _op: 'read',
      select: () => b,
      eq: () => b,
      insert: (...a: any[]) => {
        b._op = 'insert'
        if (table === 'attachments') attachInsertMock(...a)
        if (table === 'rfi_annotations') annInsertMock(...a)
        return b
      },
      update: (...a: any[]) => {
        b._op = 'update'
        if (table === 'rfi_annotations') annUpdateMock(...a)
        return b
      },
      delete: () => b,
      single: () => {
        if (table === 'rfis') return Promise.resolve(rfiResult.value)
        if (table === 'attachments') return Promise.resolve(attachResult.value)
        if (table === 'rfi_annotations') return Promise.resolve(annResult.value)
        return Promise.resolve({ data: null, error: null })
      },
    }
    return b
  }
  const makeClient = () => ({
    auth: { getUser: getUserMock },
    rpc: (...a: any[]) => rpcMock(...a),
    schema: () => ({ from: (t: string) => tableBuilder(t) }),
    from: (t: string) => tableBuilder(t),
    storage: {
      from: () => ({
        upload: (...a: any[]) => {
          uploadMock(...a)
          return Promise.resolve({ error: null })
        },
        remove: () => Promise.resolve({ error: null }),
        download: () => Promise.resolve({ data: null, error: { message: 'n/a' } }),
      }),
    },
  })
  return { createClient: async () => makeClient() }
})

import { createRfiAnnotationAction, updateRfiAnnotationAction } from './rfi-annotation.actions'

const RFI_ID = '11111111-1111-4111-8111-111111111111'
const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const ANN_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const PNG_B64 = 'A'.repeat(128) // valid base64 chars, well under the 20MB cap

function createInput() {
  return { rfiId: RFI_ID, sourceFloorPlanId: PLAN_ID, sceneJson: { version: 1 }, pngBase64: PNG_B64 }
}
function updateInput() {
  return { annotationId: ANN_ID, sceneJson: { version: 1 }, pngBase64: PNG_B64 }
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  // requireEffectiveRole reads the RPC result.
  rpcMock.mockImplementation(async () => roleResult.value)
  rfiResult.value = { data: { id: RFI_ID, organisation_id: 'o1', project_id: PROJECT_ID }, error: null }
  attachResult.value = { data: { id: 'att-1', file_path: 'o1/rfi/markup.png' }, error: null }
  annResult.value = {
    data: {
      id: ANN_ID,
      rfi_id: RFI_ID,
      attachment_id: 'att-1',
      source_floor_plan_id: PLAN_ID,
      organisation_id: 'o1',
    },
    error: null,
  }
  roleResult.value = { data: 'contractor', error: null } // default: an allowed writer
})

describe('createRfiAnnotationAction — authorization gate', () => {
  it('rejects unauthenticated callers before any storage write', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await createRfiAnnotationAction(createInput())
    expect(res.error).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
    expect(annInsertMock).not.toHaveBeenCalled()
  })

  it.each(['client_viewer', 'inspector', 'supplier'])(
    'blocks read-only role %s before any storage/DB write',
    async (role) => {
      roleResult.value = { data: role, error: null }
      const res = await createRfiAnnotationAction(createInput())
      expect(res.error).toMatch(/not allowed|No access/i)
      expect(res.annotationId).toBeUndefined()
      expect(uploadMock).not.toHaveBeenCalled()
      expect(attachInsertMock).not.toHaveBeenCalled()
      expect(annInsertMock).not.toHaveBeenCalled()
    },
  )

  it('blocks a caller with no effective project role', async () => {
    roleResult.value = { data: null, error: null }
    const res = await createRfiAnnotationAction(createInput())
    expect(res.error).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('fails closed when the role RPC errors (never writes)', async () => {
    roleResult.value = { data: null, error: { message: 'rpc boom' } }
    const res = await createRfiAnnotationAction(createInput())
    expect(res.error).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
    expect(annInsertMock).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin', 'project_manager', 'contractor'])(
    'allows write role %s to save the markup',
    async (role) => {
      roleResult.value = { data: role, error: null }
      attachResult.value = { data: { id: 'att-1' }, error: null }
      annResult.value = { data: { id: ANN_ID }, error: null }
      const res = await createRfiAnnotationAction(createInput())
      expect(res.error).toBeUndefined()
      expect(res.annotationId).toBe(ANN_ID)
      expect(uploadMock).toHaveBeenCalledTimes(1)
    },
  )
})

describe('updateRfiAnnotationAction — authorization gate', () => {
  it.each(['client_viewer', 'inspector', 'supplier'])(
    'blocks read-only role %s before re-uploading the markup',
    async (role) => {
      roleResult.value = { data: role, error: null }
      const res = await updateRfiAnnotationAction(updateInput())
      expect(res.error).toMatch(/not allowed|No access/i)
      expect(uploadMock).not.toHaveBeenCalled()
      expect(annUpdateMock).not.toHaveBeenCalled()
    },
  )

  it('fails closed when the role RPC errors (never re-uploads)', async () => {
    roleResult.value = { data: null, error: { message: 'rpc boom' } }
    const res = await updateRfiAnnotationAction(updateInput())
    expect(res.error).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
    expect(annUpdateMock).not.toHaveBeenCalled()
  })

  it('blocks when the annotation has no owning RFI (project unresolvable)', async () => {
    // rfi lookup returns nothing → project can't be resolved → refuse.
    rfiResult.value = { data: null, error: { message: 'no rfi' } }
    const res = await updateRfiAnnotationAction(updateInput())
    expect(res.error).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
    expect(annUpdateMock).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin', 'project_manager', 'contractor'])(
    'allows write role %s to update the markup',
    async (role) => {
      roleResult.value = { data: role, error: null }
      const res = await updateRfiAnnotationAction(updateInput())
      expect(res.error).toBeUndefined()
      expect(res.annotationId).toBe(ANN_ID)
      expect(uploadMock).toHaveBeenCalledTimes(1)
    },
  )
})
