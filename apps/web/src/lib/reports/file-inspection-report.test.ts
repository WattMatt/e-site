import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks (repo convention — see snag-visit.actions.test.ts) ──
const h = vi.hoisted(() => ({
  gather: vi.fn(),
  render: vi.fn(),
  resolveBranding: vi.fn(() => ({ accent: '#f5a623', issuer: { wordmark: 'WM' }, parties: [], title: 'Inspection & Test Report', kicker: 'ELECTRICAL INSPECTION', projectLine: 'Proj', footerStamp: 'x' })),
  fileIntoHandover: vi.fn(async () => ({ documentId: 'doc-x' })),
  serviceClient: null as any,
}))

vi.mock('./inspection-report-data', () => ({ gatherInspectionReportData: h.gather }))
vi.mock('./render-inspection', () => ({ renderInspectionReport: h.render }))
vi.mock('./branding', () => ({ resolveBranding: h.resolveBranding }))
vi.mock('@/lib/handover/handover-filing', () => ({ fileIntoHandover: h.fileIntoHandover }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.serviceClient }))
vi.mock('@esite/shared', () => ({ buildHandoverDrawingName: (l: string, f: string) => (l ? `${l} — ${f}` : f) }))

import { generateAndFileInspectionReport } from './file-inspection-report'

// Builds a service-client mock that records reports inserts/supersedes and
// returns a queued prior-version + the inspection's template + uploads.
function makeService(opts: { priorVersion?: number; priorHandoverDocs?: Array<{ id: string; storage_path: string }>; fileFields?: Array<{ field_id: string; label: string }>; photos?: Array<{ field_id: string; storage_path: string; caption: string }> }) {
  const calls = { insertReport: null as any, superseded: false, deletedOrigin: false }
  const tenants = {
    documents: {
      // dedup select prior + delete
      select: () => ({ eq: () => ({ eq: () => ({ data: opts.priorHandoverDocs ?? [] }) }) }),
      delete: () => ({ eq: () => ({ eq: () => { calls.deletedOrigin = true; return { data: null, error: null } } }) }),
    },
  }
  const projects = {
    reports: {
      selectPrior: { data: opts.priorVersion ? { id: 'r0', version: opts.priorVersion } : null },
    },
  }
  const inspections = {
    inspections: { data: { template_id: 'tmpl-1' } },
    templates: { data: { schema_json: { sections: [{ section_id: 's1', fields: (opts.fileFields ?? []).map((f) => ({ field_id: f.field_id, label: f.label, type: 'file' })) }] } } },
    photos: { data: opts.photos ?? [] },
  }
  const client: any = {
    schema: (s: string) => ({
      from: (t: string) => {
        if (s === 'projects' && t === 'reports') return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => projects.reports.selectPrior }) }) }) }) }) }),
          insert: (row: any) => { calls.insertReport = row; return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) } },
          update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ neq: async () => { calls.superseded = true; return { error: null } } }) }) }) }),
        }
        if (s === 'tenants' && t === 'documents') return tenants.documents
        if (s === 'inspections' && t === 'inspections') return { select: () => ({ eq: () => ({ maybeSingle: async () => inspections.inspections }) }) }
        if (s === 'inspections' && t === 'templates') return { select: () => ({ eq: () => ({ maybeSingle: async () => inspections.templates }) }) }
        if (s === 'inspections' && t === 'photos') return { select: () => ({ eq: () => ({ in: async () => inspections.photos }) }) }
        return {}
      },
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        download: async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(2), type: 'application/pdf' }, error: null }),
      }),
    },
  }
  return { client, calls }
}

const BASE_DATA = {
  inspectionId: 'insp-1',
  summary: { documentNumber: 'COC-1', templateName: 'Electrical CoC', projectName: 'KW' },
  brandingInput: { orgName: 'WM', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectMarkDataUri: null, projectSubtitle: '' },
}

describe('generateAndFileInspectionReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.gather.mockResolvedValue(BASE_DATA)
    h.render.mockResolvedValue(Buffer.from('PDFBYTES'))
  })

  it('renders, saves a versioned projects.reports row, supersedes priors, and files the report into compliance_certs', async () => {
    const { client, calls } = makeService({ priorVersion: 2, priorHandoverDocs: [{ id: 'hd-1', storage_path: 'org-1/proj-1/old.pdf' }] })
    h.serviceClient = client
    const res = await generateAndFileInspectionReport({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'user-1' })
    expect('reportId' in res && res.reportId).toBe('r1')
    expect(calls.insertReport.kind).toBe('inspection')
    expect(calls.insertReport.version).toBe(3) // prior 2 + 1
    expect(calls.superseded).toBe(true)
    expect(calls.deletedOrigin).toBe(true) // dedup ran
    // first fileIntoHandover call = the report → compliance_certs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h.fileIntoHandover.mock.calls[0] as any)[1].category).toBe('compliance_certs')
  })

  it('files each file-field upload into test_certificates', async () => {
    const { client } = makeService({
      fileFields: [{ field_id: 'datasheet', label: 'Data Sheet' }],
      photos: [{ field_id: 'datasheet', storage_path: 'p/x.pdf', caption: 'x.pdf' }],
    })
    h.serviceClient = client
    await generateAndFileInspectionReport({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'user-1' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadCall = h.fileIntoHandover.mock.calls.find((c) => (c as any)[1].category === 'test_certificates')
    expect(uploadCall).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((uploadCall as any)[1].name).toContain('Data Sheet')
  })

  it('rolls back the reports storage object when the row insert fails', async () => {
    const { client } = makeService({})
    // Force the reports insert to error
    const origFrom = client.schema
    client.schema = (s: string) => {
      const api = origFrom(s)
      if (s === 'projects') return { from: () => ({ ...api.from('reports'), insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'dup' } }) }) }) }) }
      return api
    }
    const removed: string[][] = []
    client.storage.from = () => ({ upload: async () => ({ error: null }), remove: async (p: string[]) => { removed.push(p); return { error: null } }, download: async () => ({ data: null, error: { message: 'x' } }) })
    h.serviceClient = client
    const res = await generateAndFileInspectionReport({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'user-1' })
    expect('error' in res).toBe(true)
    expect(removed.length).toBe(1)
  })
})
