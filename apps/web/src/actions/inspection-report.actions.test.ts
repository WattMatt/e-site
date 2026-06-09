import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  worker: vi.fn(async () => ({ reportId: 'r1', storagePath: 'p' })),
  requireEffectiveRole: vi.fn(async () => ({ ok: true })),
  getById: vi.fn(async () => ({ organisation_id: 'org-1' })),
}))

vi.mock('@/lib/reports/file-inspection-report', () => ({ generateAndFileInspectionReport: h.worker }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole }))
vi.mock('@esite/shared', () => ({ projectService: { getById: h.getById }, ORG_WRITE_ROLES: ['owner', 'admin', 'project_manager'] }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'pm-1' } } }) },
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'insp-1', project_id: '22222222-2222-2222-2222-222222222222' } }) }) }) }) }),
  }),
}))

import { regenerateInspectionReportAction } from './inspection-report.actions'

describe('regenerateInspectionReportAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gates, then calls the worker and returns the reportId', async () => {
    const res = await regenerateInspectionReportAction('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
    expect(h.requireEffectiveRole).toHaveBeenCalled()
    expect(res.reportId).toBe('r1')
  })

  it('blocks when the role gate fails', async () => {
    h.requireEffectiveRole.mockResolvedValueOnce({ ok: false, error: 'forbidden' } as never)
    const res = await regenerateInspectionReportAction('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
    expect(res.error).toBe('forbidden')
    expect(h.worker).not.toHaveBeenCalled()
  })

  it('rejects an inspection that does not belong to the project', async () => {
    const res = await regenerateInspectionReportAction('not-a-uuid', '22222222-2222-2222-2222-222222222222')
    expect(res.error).toBe('Invalid parameters')
  })
})
