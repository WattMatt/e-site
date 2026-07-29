/**
 * qc-report-data.test.ts
 *
 * Tests gatherQcReportData with mocked Supabase clients (mirrors
 * snag-visit-report-data.test.ts). Verifies the Stage-3 data-layer additions:
 *   - conformance/severity surfaced onto each entry
 *   - report-level conformance tally (pass/fail/na + failBySeverity)
 *   - Defect S4: a within-cap download failure becomes a placeholder
 *     (dataUri: null) counted in unavailableCount — NOT dropped and NOT folded
 *     into omittedCount — so the 1-based "Photo N" numbering (and any per-photo
 *     comment referencing it) stays valid
 *   - the >cap omittedCount is still the count beyond MAX_PHOTOS_PER_ENTRY (24)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be vi.hoisted() to avoid TDZ with top-level vi.mock()
// ---------------------------------------------------------------------------

const { mockRequireEffectiveRole, mockCreateServiceClient } = vi.hoisted(() => ({
  mockRequireEffectiveRole: vi.fn(),
  mockCreateServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: mockRequireEffectiveRole,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockCreateServiceClient,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-001'
const REPORT_ID = 'report-001'
const ORG_ID = 'org-001'
const USER_ID = 'user-001'

const DATA_URI_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// A file_path whose download is made to fail (Defect S4 within-cap failure).
const FAIL_PATH = 'entries/FAIL-p2.png'

const REPORT_ROW = {
  id: REPORT_ID,
  project_id: PROJECT_ID,
  organisation_id: ORG_ID,
  report_no: 7,
  title: 'Slab pour QC',
  description: 'Pre-pour inspection.',
  location: 'Level 3',
  inspection_date: '2026-07-14',
  status: 'issued',
  raised_by: 'user-raiser',
  issued_at: '2026-07-14T10:00:00Z',
  issued_by: 'user-raiser',
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-14T10:00:00Z',
}

const PROJECT_ROW = {
  id: PROJECT_ID,
  name: 'Kingswalk Mall',
  organisation_id: ORG_ID,
  client_logo_url: null,
  project_logo_url: null,
  report_accent_color: '#0055AA',
  status: 'active',
}

const ORG_ROW = {
  id: ORG_ID,
  name: 'WM Consulting',
  logo_url: null,
  report_accent_color: null,
}

const PROFILES = [
  { id: 'user-raiser', full_name: 'Alice Raiser', email: 'alice@example.com' },
]

// entry-1 (fail/major): 3 within-cap photos, p2's download fails → placeholder.
// A comment references p2 by photo_id; its photoIndex must stay 2.
const ENTRY_1 = {
  id: 'entry-1',
  report_id: REPORT_ID,
  title: 'Rebar spacing',
  description: 'Two spans over 200mm.',
  conformance: 'fail',
  severity: 'major',
  sort_order: 0,
  created_by: 'user-raiser',
  qc_entry_photos: [
    { id: 'p1', file_path: 'entries/p1.png', caption: 'A', kind: 'photo', source_floor_plan_id: null, sort_order: 0, created_at: '2026-07-14T08:00:00Z' },
    { id: 'p2', file_path: FAIL_PATH, caption: null, kind: 'photo', source_floor_plan_id: null, sort_order: 1, created_at: '2026-07-14T08:01:00Z' },
    { id: 'p3', file_path: 'entries/p3.png', caption: null, kind: 'photo', source_floor_plan_id: null, sort_order: 2, created_at: '2026-07-14T08:02:00Z' },
  ],
  qc_comments: [
    { id: 'c1', created_by: 'user-raiser', created_at: '2026-07-14T09:00:00Z', body: 'Still short one bar.', photo_id: 'p2' },
    { id: 'c2', created_by: 'user-raiser', created_at: '2026-07-14T09:05:00Z', body: 'Whole-entry note.', photo_id: null },
  ],
}

// entry-2 (pass): 26 photos, all download OK → omittedCount 2, rendered 24.
const ENTRY_2 = {
  id: 'entry-2',
  report_id: REPORT_ID,
  title: 'Cover blocks',
  description: null,
  conformance: 'pass',
  severity: null,
  sort_order: 1,
  created_by: 'user-raiser',
  qc_entry_photos: Array.from({ length: 26 }, (_, i) => ({
    id: `e2-${i + 1}`,
    file_path: `entries/e2-${i + 1}.png`,
    caption: null,
    kind: 'photo',
    source_floor_plan_id: null,
    sort_order: i,
    created_at: `2026-07-14T07:${String(i).padStart(2, '0')}:00Z`,
  })),
  qc_comments: [],
}

// entry-3 (na): no photos.
const ENTRY_3 = {
  id: 'entry-3',
  report_id: REPORT_ID,
  title: 'Housekeeping',
  description: null,
  conformance: 'na',
  severity: null,
  sort_order: 2,
  created_by: 'user-raiser',
  qc_entry_photos: [],
  qc_comments: [],
}

const ENTRIES = [ENTRY_1, ENTRY_2, ENTRY_3]

// ---------------------------------------------------------------------------
// Chainable query builder (resolves to { data, error })
// ---------------------------------------------------------------------------

function makeQuery(result: unknown) {
  const q: any = {
    schema: () => q,
    from: () => q,
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    maybeSingle: () => Promise.resolve({ data: result, error: null }),
    single: () => Promise.resolve({ data: result, error: null }),
    then: (resolve: any) => Promise.resolve({ data: result, error: null }).then(resolve),
  }
  return q
}

// Cookie client: auth + the RLS-gated qc_reports read (the visibility gate).
function buildCookieMock() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    schema: (_name: string) => ({
      from: (_table: string) => makeQuery(REPORT_ROW),
    }),
  }
}

// Service client: all name-resolving reads + storage downloads.
function buildServiceMock() {
  return {
    schema: (name: string) => ({
      from: (table: string) => {
        if (name === 'projects' && table === 'projects') return makeQuery(PROJECT_ROW)
        if (name === 'projects' && table === 'qc_entries') return makeQuery(ENTRIES)
        return makeQuery(null)
      },
    }),
    from: (table: string) => {
      if (table === 'organisations') return makeQuery(ORG_ROW)
      if (table === 'profiles') return makeQuery(PROFILES)
      return makeQuery(null)
    },
    storage: {
      from: (_bucket: string) => ({
        download: async (path: string) => {
          // Defect S4: this one download fails; the gatherer must degrade it to
          // a placeholder (dataUri null), not drop the photo.
          if (path === FAIL_PATH) return { data: null, error: { message: 'not found' } }
          const bin = Buffer.from(DATA_URI_PNG.split(',')[1], 'base64')
          const pseudoBlob = {
            type: 'image/png',
            arrayBuffer: async () =>
              bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer,
          }
          return { data: pseudoBlob, error: null }
        },
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gatherQcReportData', () => {
  beforeEach(() => {
    mockRequireEffectiveRole.mockResolvedValue({ ok: true, role: 'project_manager' })
    mockCreateServiceClient.mockReturnValue(buildServiceMock())
  })

  it('throws the RBAC error when the caller has no project access', async () => {
    mockRequireEffectiveRole.mockResolvedValue({ ok: false, error: 'No access to this project' })
    const { gatherQcReportData } = await import('./qc-report-data')
    await expect(
      gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID),
    ).rejects.toThrow('No access to this project')
  })

  it('surfaces conformance + severity onto each entry', async () => {
    const { gatherQcReportData } = await import('./qc-report-data')
    const data = await gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID)
    const [e1, e2, e3] = data.entries
    expect(e1.conformance).toBe('fail')
    expect(e1.severity).toBe('major')
    expect(e2.conformance).toBe('pass')
    expect(e2.severity).toBeNull()
    expect(e3.conformance).toBe('na')
    expect(e3.severity).toBeNull()
  })

  it('computes the report-level conformance tally', async () => {
    const { gatherQcReportData } = await import('./qc-report-data')
    const data = await gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID)
    expect(data.tally).toEqual({
      pass: 1,
      fail: 1,
      na: 1,
      failBySeverity: { minor: 0, major: 1, critical: 0 },
    })
  })

  it('Defect S4: a within-cap download failure becomes a placeholder, not a dropped row', async () => {
    const { gatherQcReportData } = await import('./qc-report-data')
    const data = await gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID)
    const e1 = data.entries.find((e) => e.id === 'entry-1')!
    // All three within-cap photos kept — the failed one is a placeholder.
    expect(e1.photos).toHaveLength(3)
    expect(e1.unavailableCount).toBe(1)
    expect(e1.omittedCount).toBe(0)
    const failed = e1.photos.find((p) => p.id === 'p2')!
    expect(failed.dataUri).toBeNull()
    // The other two downloaded fine.
    expect(e1.photos.find((p) => p.id === 'p1')!.dataUri).toMatch(/^data:image\//)
    expect(e1.photos.find((p) => p.id === 'p3')!.dataUri).toMatch(/^data:image\//)
  })

  it('Defect S4: Photo-N numbering stays stable through a failed download', async () => {
    const { gatherQcReportData } = await import('./qc-report-data')
    const data = await gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID)
    const e1 = data.entries.find((e) => e.id === 'entry-1')!
    // 1-based indices unchanged despite the p2 failure.
    expect(e1.photos.map((p) => p.index)).toEqual([1, 2, 3])
    expect(e1.photos.find((p) => p.id === 'p2')!.index).toBe(2)
    // The comment that referenced p2 still points at Photo 2.
    const photoComment = e1.comments.find((c) => c.id === 'c1')!
    expect(photoComment.photoIndex).toBe(2)
    // The whole-entry comment has no photo reference.
    expect(e1.comments.find((c) => c.id === 'c2')!.photoIndex).toBeNull()
  })

  it('caps rendered photos at 24 and reports the rest as omittedCount (not unavailable)', async () => {
    const { gatherQcReportData } = await import('./qc-report-data')
    const data = await gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID)
    const e2 = data.entries.find((e) => e.id === 'entry-2')!
    expect(e2.photos).toHaveLength(24)
    expect(e2.omittedCount).toBe(2) // 26 − 24
    expect(e2.unavailableCount).toBe(0)
  })

  it('resolves branding with the project accent colour', async () => {
    const { gatherQcReportData } = await import('./qc-report-data')
    const data = await gatherQcReportData(buildCookieMock() as any, PROJECT_ID, REPORT_ID)
    expect(data.branding.accent).toBe('#0055AA')
    expect(data.branding.kicker).toMatch(/QUALITY CONTROL/i)
  })
})
