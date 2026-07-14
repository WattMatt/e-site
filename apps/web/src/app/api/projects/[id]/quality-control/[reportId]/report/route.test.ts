// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Env must be set before route.ts evaluates its module-level consts.
// vi.hoisted runs before the hoisted import below.
const { getUserMock, rpcMock, reportResult, roleResult, serviceResults, renderMock } =
  vi.hoisted(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    return {
      getUserMock: vi.fn(),
      rpcMock: vi.fn(),
      reportResult: { value: { data: null as any, error: null as any } },
      roleResult: { value: { data: null as any, error: null as any } },
      // Per-table results served by the mocked service client.
      serviceResults: { value: {} as Record<string, { data: any; error: any }> },
      renderMock: vi.fn(),
    }
  })

// Generic chainable query builder: every builder method returns the chain,
// terminal reads resolve the given result. Thenable so bare `await chain`
// (the qc_entries list read) also works.
function chain(result: { data: any; error: any }) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.maybeSingle = () => Promise.resolve(result)
  c.single = () => Promise.resolve(result)
  c.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return c
}

const serviceResult = (table: string) =>
  serviceResults.value[table] ?? { data: null, error: null }

// The route's createClient — one fake client serves auth.getUser (used by the
// route, the gatherer AND the real requireEffectiveRole), the RLS qc_reports
// visibility read, and the user_effective_project_role RPC (the actual gate
// under test). createServiceClient serves the post-gate reads keyed by table.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    schema: () => ({
      from: () => chain(reportResult.value),
    }),
    rpc: (...a: unknown[]) => rpcMock(...a),
  }),
  createServiceClient: () => ({
    schema: () => ({ from: (table: string) => chain(serviceResult(table)) }),
    from: (table: string) => chain(serviceResult(table)),
    storage: {
      from: () => ({ download: async () => ({ data: null, error: null }) }),
    },
  }),
}))

// Stub only the renderer (react-pdf render is not the gate under test); the
// real gatherQcReportData + requireEffectiveRole run against the mocks above.
vi.mock('@/lib/reports/qc-report', () => ({
  renderQcReport: (...a: unknown[]) => renderMock(...a),
}))

import { GET } from './route'

const PROJECT_ID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const REPORT_ID = '3f8e1a20-51c4-4c37-9be1-2a35c6de9d10'

const REPORT_ROW = {
  id: REPORT_ID,
  project_id: PROJECT_ID,
  organisation_id: 'o1',
  report_no: 7,
  title: 'Slab pour QC',
  description: null,
  location: null,
  inspection_date: null,
  status: 'issued',
  raised_by: 'u-raiser',
  issued_at: null,
  issued_by: null,
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
}

function invoke() {
  return GET(
    {} as any,
    { params: Promise.resolve({ id: PROJECT_ID, reportId: REPORT_ID }) },
  )
}

beforeEach(() => {
  getUserMock.mockReset()
  rpcMock.mockReset()
  renderMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  reportResult.value = { data: REPORT_ROW, error: null }
  // requireEffectiveRole reads the RPC result.
  rpcMock.mockImplementation(async () => roleResult.value)
  roleResult.value = { data: null, error: null }
  serviceResults.value = {
    projects: {
      data: {
        id: PROJECT_ID,
        name: 'P',
        organisation_id: 'o1',
        client_logo_url: null,
        project_logo_url: null,
        report_accent_color: null,
        status: 'active',
      },
      error: null,
    },
    organisations: {
      data: { id: 'o1', name: 'Org', logo_url: null, report_accent_color: null },
      error: null,
    },
    qc_entries: { data: [], error: null },
    profiles: { data: [{ id: 'u-raiser', full_name: 'Raiser', email: null }], error: null },
  }
  renderMock.mockResolvedValue(Buffer.from('%PDF-fake'))
})

describe('GET /api/projects/[id]/quality-control/[reportId]/report — gate', () => {
  it('401 when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await invoke()
    expect(res.status).toBe(401)
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('404 when the report row is not visible (RLS — e.g. a draft for a client_viewer)', async () => {
    reportResult.value = { data: null, error: null }
    const res = await invoke()
    expect(res.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('403 when the caller has no effective role on the project', async () => {
    roleResult.value = { data: null, error: null }
    const res = await invoke()
    expect(res.status).toBe(403)
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('200 inline PDF for a project_manager effective role', async () => {
    roleResult.value = { data: 'project_manager', error: null }
    const res = await invoke()
    expect(res.status).toBe(200)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="qc-report-7.pdf"')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('200 for a client_viewer when the report row is visible (issued)', async () => {
    roleResult.value = { data: 'client_viewer', error: null }
    const res = await invoke()
    expect(res.status).toBe(200)
    expect(renderMock).toHaveBeenCalledTimes(1)
  })
})
