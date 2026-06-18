import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  createClientMock,
  createServiceClientMock,
  requireEffectiveRoleMock,
  getByIdMock,
  workerMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  getByIdMock: vi.fn(),
  workerMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  projectService: { getById: getByIdMock },
}))
vi.mock('@/lib/reports/file-inspection-report', () => ({
  generateAndFileInspectionReport: workerMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

import { regenerateInspectionReportAction } from './inspection-report.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const OTHER_PROJECT = '22222222-2222-2222-2222-222222222222'
const INSPECTION = '33333333-3333-3333-3333-333333333333'

// Service client whose inspections lookup returns a fixed project_id.
function serviceReturning(inspProjectId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: inspProjectId ? { project_id: inspProjectId, organisation_id: 'org-1' } : null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const schema = vi.fn(() => ({ from }))
  return { schema }
}

beforeEach(() => {
  vi.clearAllMocks()
  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  })
  getByIdMock.mockResolvedValue({ id: PROJECT })
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  workerMock.mockResolvedValue({ reportId: 'rep-1', storagePath: 'p/x.pdf' })
})

describe('regenerateInspectionReportAction', () => {
  it('rejects an inspection that belongs to a different project', async () => {
    createServiceClientMock.mockReturnValue(serviceReturning(OTHER_PROJECT))
    const r = await regenerateInspectionReportAction(INSPECTION, PROJECT)
    expect(r).toEqual({ error: 'Not found' })
    expect(workerMock).not.toHaveBeenCalled()
  })

  it('regenerates when the inspection belongs to the project', async () => {
    createServiceClientMock.mockReturnValue(serviceReturning(PROJECT))
    const r = await regenerateInspectionReportAction(INSPECTION, PROJECT)
    expect(r).toEqual({ reportId: 'rep-1' })
    expect(workerMock).toHaveBeenCalledWith({
      inspectionId: INSPECTION,
      projectId: PROJECT,
      orgId: 'org-1',
      userId: 'user-1',
    })
  })

  it('blocks a caller without a write role', async () => {
    createServiceClientMock.mockReturnValue(serviceReturning(PROJECT))
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })
    const r = await regenerateInspectionReportAction(INSPECTION, PROJECT)
    expect(r).toEqual({ error: 'No access to this project' })
    expect(workerMock).not.toHaveBeenCalled()
  })
})
