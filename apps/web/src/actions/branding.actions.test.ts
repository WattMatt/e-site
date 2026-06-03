import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────
// vi.hoisted ensures these are initialised before the hoisted vi.mock factories
// reference them (the SUT imports next/cache at module load, causing TDZ otherwise).
const {
  createClientMock,
  createServiceClientMock,
  requireEffectiveRoleMock,
  revalidatePathMock,
  getByIdMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  getByIdMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: requireEffectiveRoleMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, projectService: { ...actual.projectService, getById: getByIdMock } }
})

import { uploadProjectLogoAction, updateProjectAccentAction } from './branding.actions'

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Minimal supabase mock: auth.getUser only (effective-role is mocked separately). */
function mockRlsClient() {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
  }
}

/** Chainable query builder stub that resolves to `result`. */
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['schema', 'from', 'select', 'eq', 'update']) {
    p[m] = () => qb(result)
  }
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

/** A minimal FormData-like object holding a single file for testing. */
function makeFormData(fileName: string, mimeType: string): FormData {
  const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // fake PNG header
  const file = new File([buf], fileName, { type: mimeType })
  const fd = new FormData()
  fd.append('file', file)
  return fd
}

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeEach(() => {
  vi.clearAllMocks()
  getByIdMock.mockResolvedValue({ id: PROJECT_ID, organisation_id: ORG_ID })
  createClientMock.mockResolvedValue(mockRlsClient())

  // Default service client: storage upload succeeds + projects update succeeds
  const uploadMock = vi.fn().mockResolvedValue({ error: null })
  const updateMock = vi.fn()
  // schema(...).from(...).update(...).eq(...) chain → success
  const eqMock = vi.fn().mockResolvedValue({ error: null })
  const updateChain = vi.fn().mockReturnValue({ eq: eqMock })
  const fromMock = vi.fn().mockReturnValue({ update: updateChain })
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock })
  createServiceClientMock.mockReturnValue({
    schema: schemaMock,
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage.example.com/path' } }),
      }),
    },
    // Surface upload mock for inspection
    _uploadMock: uploadMock,
    _updateChain: updateChain,
    _eqMock: eqMock,
  })
})

// ─── uploadProjectLogoAction ───────────────────────────────────────────────

describe('uploadProjectLogoAction', () => {
  describe('role gate', () => {
    it('allows a project_manager (ORG_WRITE_ROLES)', async () => {
      requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
      const fd = makeFormData('logo.png', 'image/png')
      const res = await uploadProjectLogoAction(PROJECT_ID, 'client', fd)
      expect(res).not.toHaveProperty('error')
    })

    it('rejects a client_viewer (outside ORG_WRITE_ROLES)', async () => {
      requireEffectiveRoleMock.mockResolvedValue({
        ok: false,
        error: 'Your role (client_viewer) is not allowed to perform this action',
      })
      const fd = makeFormData('logo.png', 'image/png')
      const res = await uploadProjectLogoAction(PROJECT_ID, 'client', fd)
      expect(res).toHaveProperty('error')
      // Storage must NOT have been touched
      expect(createServiceClientMock).not.toHaveBeenCalled()
    })
  })

  describe('column written on success', () => {
    beforeEach(() => {
      requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    })

    it('sets client_logo_url for slot=client', async () => {
      const fd = makeFormData('logo.png', 'image/png')
      const svc = createServiceClientMock()
      // Re-mock to inspect what column is updated
      const eqSpy = vi.fn().mockResolvedValue({ error: null })
      const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy })
      const fromSpy = vi.fn().mockReturnValue({ update: updateSpy })
      createServiceClientMock.mockReturnValue({
        schema: vi.fn().mockReturnValue({ from: fromSpy }),
        storage: {
          from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }),
        },
      })

      await uploadProjectLogoAction(PROJECT_ID, 'client', fd)

      // The update call should include client_logo_url
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ client_logo_url: expect.any(String) }),
      )
      expect(revalidatePathMock).toHaveBeenCalled()
    })

    it('sets project_logo_url for slot=project', async () => {
      const fd = makeFormData('mark.png', 'image/png')
      const eqSpy = vi.fn().mockResolvedValue({ error: null })
      const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy })
      const fromSpy = vi.fn().mockReturnValue({ update: updateSpy })
      createServiceClientMock.mockReturnValue({
        schema: vi.fn().mockReturnValue({ from: fromSpy }),
        storage: {
          from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }),
        },
      })

      await uploadProjectLogoAction(PROJECT_ID, 'project', fd)

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ project_logo_url: expect.any(String) }),
      )
    })
  })

  it('returns error when no file is in the FormData', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
    const fd = new FormData() // no file appended
    const res = await uploadProjectLogoAction(PROJECT_ID, 'client', fd)
    expect(res).toHaveProperty('error')
  })

  it('returns error when project is not found', async () => {
    getByIdMock.mockResolvedValue(null)
    const fd = makeFormData('logo.png', 'image/png')
    const res = await uploadProjectLogoAction(PROJECT_ID, 'client', fd)
    expect(res).toHaveProperty('error')
    expect(requireEffectiveRoleMock).not.toHaveBeenCalled()
  })
})

// ─── updateProjectAccentAction ─────────────────────────────────────────────

describe('updateProjectAccentAction', () => {
  describe('role gate', () => {
    it('allows a project_manager (ORG_WRITE_ROLES)', async () => {
      requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
      const res = await updateProjectAccentAction(PROJECT_ID, '#E69500')
      expect(res).not.toHaveProperty('error')
    })

    it('rejects a client_viewer (outside ORG_WRITE_ROLES)', async () => {
      requireEffectiveRoleMock.mockResolvedValue({
        ok: false,
        error: 'Your role (client_viewer) is not allowed to perform this action',
      })
      const res = await updateProjectAccentAction(PROJECT_ID, '#E69500')
      expect(res).toHaveProperty('error')
      expect(createServiceClientMock).not.toHaveBeenCalled()
    })
  })

  describe('hex validation', () => {
    beforeEach(() => {
      requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    })

    it('accepts a valid 6-digit lowercase hex', async () => {
      const res = await updateProjectAccentAction(PROJECT_ID, '#a1b2c3')
      expect(res).not.toHaveProperty('error')
    })

    it('accepts a valid 6-digit uppercase hex', async () => {
      const res = await updateProjectAccentAction(PROJECT_ID, '#E69500')
      expect(res).not.toHaveProperty('error')
    })

    it('rejects a 3-digit short-form hex', async () => {
      const res = await updateProjectAccentAction(PROJECT_ID, '#abc')
      expect(res).toHaveProperty('error')
      expect(createServiceClientMock).not.toHaveBeenCalled()
    })

    it('rejects hex without the # prefix', async () => {
      const res = await updateProjectAccentAction(PROJECT_ID, 'E69500')
      expect(res).toHaveProperty('error')
      expect(createServiceClientMock).not.toHaveBeenCalled()
    })

    it('rejects an invalid character in hex', async () => {
      const res = await updateProjectAccentAction(PROJECT_ID, '#GG1234')
      expect(res).toHaveProperty('error')
    })

    it('rejects an empty string', async () => {
      const res = await updateProjectAccentAction(PROJECT_ID, '')
      expect(res).toHaveProperty('error')
    })
  })

  describe('column written on success', () => {
    it('sets report_accent_color on the projects row', async () => {
      requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })

      const eqSpy = vi.fn().mockResolvedValue({ error: null })
      const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy })
      const fromSpy = vi.fn().mockReturnValue({ update: updateSpy })
      createServiceClientMock.mockReturnValue({
        schema: vi.fn().mockReturnValue({ from: fromSpy }),
        storage: { from: () => ({}) },
      })

      await updateProjectAccentAction(PROJECT_ID, '#E69500')

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ report_accent_color: '#E69500' }),
      )
      expect(revalidatePathMock).toHaveBeenCalled()
    })
  })

  it('returns error when project is not found', async () => {
    getByIdMock.mockResolvedValue(null)
    const res = await updateProjectAccentAction(PROJECT_ID, '#E69500')
    expect(res).toHaveProperty('error')
    expect(requireEffectiveRoleMock).not.toHaveBeenCalled()
  })
})
