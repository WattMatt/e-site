import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  worker: vi.fn(async (): Promise<{ reportId: string; storagePath: string } | { error: string }> => ({ reportId: 'r1', storagePath: 'p' })),
  invoke: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  dispatchNotification: vi.fn(async () => undefined),
  requireFeature: vi.fn(async () => undefined),
}))

vi.mock('@/lib/reports/file-inspection-report', () => ({ generateAndFileInspectionReport: h.worker }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: h.dispatchNotification }))
vi.mock('@/lib/features', () => ({ requireFeature: h.requireFeature }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Minimal supabase mock: verifier-owned inspection awaiting verification,
// inspection_only deliverable (no separate-verifier gate, no signature gate).
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'verifier-1' } } }) },
    functions: { invoke: h.invoke },
    rpc: async () => ({ data: 'INS-0001', error: null }),
    schema: () => ({
      from: (t: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => t === 'inspections'
              ? { data: { id: 'insp-1', status: 'awaiting_verification', verifier_id: 'verifier-1', organisation_id: 'org-1', template_id: 'tmpl-1' } }
              : { data: { deliverable_type: 'inspection_only', schema_json: { sections: [] } } },
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
        update: () => ({ eq: () => ({ error: null }) }),
      }),
    }),
  }),
}))

import { certifyInspectionAction } from './inspections-certify.actions'

describe('certifyInspectionAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the report worker and does NOT invoke the legacy render-inspection-pdf', async () => {
    const coc = await certifyInspectionAction({ inspectionId: 'insp-1', projectId: 'proj-1' })
    expect(coc).toBe('INS-0001')
    expect(h.worker).toHaveBeenCalledWith(expect.objectContaining({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'verifier-1' }))
    const renderInvokes = (h.invoke.mock.calls as unknown[][]).filter((c) => c[0] === 'render-inspection-pdf')
    expect(renderInvokes.length).toBe(0)
  })

  it('still returns the COC number when report generation fails (best-effort)', async () => {
    h.worker.mockResolvedValueOnce({ error: 'render boom' })
    const coc = await certifyInspectionAction({ inspectionId: 'insp-1', projectId: 'proj-1' })
    expect(coc).toBe('INS-0001')
  })
})
