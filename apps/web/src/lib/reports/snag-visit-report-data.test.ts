/**
 * snag-visit-report-data.test.ts
 *
 * Tests gatherSnagVisitReportData using mocked Supabase clients.
 * Verifies: bucket assignment, photo data: URI attachment, before/after split
 * for closed snags, and branding resolution.
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
const VISIT_ID = 'visit-v2'
const USER_ID = 'user-001'

const DATA_URI_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const VISITS = [
  { id: 'visit-v0', visit_no: 0, is_backlog: true },
  { id: 'visit-v1', visit_no: 1, is_backlog: false },
  { id: 'visit-v2', visit_no: 2, is_backlog: false },
]

const THIS_VISIT = {
  id: 'visit-v2',
  visit_no: 2,
  is_backlog: false,
  project_id: PROJECT_ID,
  visit_date: '2026-06-04',
  title: 'Site Visit 2',
  notes: 'Inspection complete.',
  conducted_by: 'user-conductor',
  attendees: ['user-attendee'],
}

// Three snags covering all three buckets
const SNAGS = [
  // NEW this visit — raised on v2
  {
    id: 'snag-new',
    title: 'Missing earth bond',
    priority: 'critical',
    status: 'open',
    location: 'Plant room',
    category: 'Safety',
    description: 'Earth bond missing.',
    raised_by: 'user-001',
    assigned_to: null,
    raised_on_visit_id: 'visit-v2',
    closed_on_visit_id: null,
    created_at: '2026-06-04T00:00:00Z',
    snag_photos: [
      { id: 'photo-1', file_path: 'p/photo-1.jpg', caption: 'Main bar', photo_type: 'evidence', sort_order: 0 },
    ],
  },
  // STILL OPEN — raised on v1, closed on v3 (future, so open as of v2)
  {
    id: 'snag-open',
    title: 'Cracked conduit',
    priority: 'high',
    status: 'in_progress',
    location: 'East riser',
    category: 'Electrical',
    description: null,
    raised_by: null,
    assigned_to: null,
    raised_on_visit_id: 'visit-v1',
    closed_on_visit_id: 'visit-v3', // future visit — still open as of v2
    created_at: '2026-06-01T00:00:00Z',
    snag_photos: [],
  },
  // CLOSED this visit — raised v1, closed v2
  {
    id: 'snag-closed',
    title: 'Exposed terminals',
    priority: 'critical',
    status: 'signed_off',
    location: 'Plant room',
    category: 'Safety',
    description: 'Fixed.',
    raised_by: null,
    assigned_to: null,
    raised_on_visit_id: 'visit-v1',
    closed_on_visit_id: 'visit-v2',
    created_at: '2026-05-30T00:00:00Z',
    snag_photos: [
      { id: 'photo-before', file_path: 'p/before.jpg', caption: 'Before', photo_type: 'evidence', sort_order: 0 },
      { id: 'photo-after', file_path: 'p/after.jpg', caption: 'After', photo_type: 'closeout', sort_order: 1 },
    ],
  },
]

const PROJECT_ROW = {
  id: PROJECT_ID,
  name: 'Kingswalk Mall',
  organisation_id: 'org-001',
  client_logo_url: null,
  project_logo_url: null,
  report_accent_color: '#0055AA',
  status: 'active',
}

const ORG_ROW = {
  id: 'org-001',
  name: 'WM Consulting',
  logo_url: null,
  report_accent_color: null,
}

const PROFILES = [
  { id: 'user-conductor', full_name: 'Jane Conductor', email: 'jane@example.com' },
  { id: 'user-attendee', full_name: 'Bob Attendee', email: 'bob@example.com' },
  { id: 'user-001', full_name: 'Alice Raiser', email: 'alice@example.com' },
]

// ---------------------------------------------------------------------------
// Service-client builder
// ---------------------------------------------------------------------------

function buildServiceMock() {
  // A chainable query builder that resolves to { data, error: null }.
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
      // For the snags query (returns array, no .single())
      then: (resolve: any) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return q
  }

  // Each DB call pattern is matched in sequence via the from() mock.
  const serviceMock: any = {
    schema: (name: string) => {
      const schemaProxy: any = {
        from: (table: string) => {
          if (name === 'projects' && table === 'projects') return makeQuery(PROJECT_ROW)
          if (name === 'field' && table === 'snag_visits') {
            // Either single visit or all visits
            let isSingle = false
            const q: any = {
              select: () => q,
              eq: () => q,
              order: () => q,
              maybeSingle: () => {
                // If we already received .eq('id', visitId) it's the single visit
                return Promise.resolve({ data: THIS_VISIT, error: null })
              },
              then: (resolve: any) =>
                Promise.resolve({ data: VISITS, error: null }).then(resolve),
            }
            return q
          }
          if (name === 'field' && table === 'snags') return makeQuery(SNAGS)
          return makeQuery(null)
        },
      }
      return schemaProxy
    },
    from: (table: string) => {
      if (table === 'organisations') return makeQuery(ORG_ROW)
      if (table === 'profiles') {
        // Returns an array (no .single()), so use then
        const q: any = {
          select: () => q,
          in: () => q,
          then: (resolve: any) => Promise.resolve({ data: PROFILES, error: null }).then(resolve),
        }
        return q
      }
      return makeQuery(null)
    },
    storage: {
      from: (_bucket: string) => ({
        download: async (_path: string) => {
          // Return a duck-typed object with the Blob interface that react-pdf
          // and our gatherer need: { type, arrayBuffer() }.  Building a real
          // Blob from a Node Buffer can fail in some jsdom versions; using an
          // object with an explicit arrayBuffer() impl avoids that entirely.
          const base64 = DATA_URI_PNG.split(',')[1]
          const bin = Buffer.from(base64, 'base64')
          const pseudoBlob = {
            type: 'image/png',
            arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer,
          }
          return { data: pseudoBlob, error: null }
        },
      }),
    },
  }
  return serviceMock
}

// ---------------------------------------------------------------------------
// Cookie client mock (auth only)
// ---------------------------------------------------------------------------

function buildCookieMock() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gatherSnagVisitReportData', () => {
  beforeEach(() => {
    mockRequireEffectiveRole.mockResolvedValue({ ok: true, role: 'project_manager' })
    mockCreateServiceClient.mockReturnValue(buildServiceMock())
  })

  it('returns RBAC error when caller has no project access', async () => {
    mockRequireEffectiveRole.mockResolvedValue({ ok: false, error: 'No access to this project' })
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    await expect(
      gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID),
    ).rejects.toThrow('No access to this project')
  })

  it('places snag raised on this visit in newSnags', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.newSnags.map(s => s.id)).toContain('snag-new')
    expect(data.stillOpen.map(s => s.id)).not.toContain('snag-new')
    expect(data.closedThisVisit.map(s => s.id)).not.toContain('snag-new')
  })

  it('places snag closed-on-future-visit in stillOpen', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.stillOpen.map(s => s.id)).toContain('snag-open')
    expect(data.closedThisVisit.map(s => s.id)).not.toContain('snag-open')
  })

  it('places signed-off snag attributed to this visit in closedThisVisit', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.closedThisVisit.map(s => s.id)).toContain('snag-closed')
    expect(data.newSnags.map(s => s.id)).not.toContain('snag-closed')
  })

  it('attaches a data: URI to photos on a new snag', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    const newSnag = data.newSnags.find(s => s.id === 'snag-new')!
    expect(newSnag.photos.length).toBeGreaterThan(0)
    expect(newSnag.photos[0].dataUri).toMatch(/^data:image\//)
  })

  it('splits closed-snag photos into before (evidence) and after (closeout)', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    const closed = data.closedThisVisit.find(s => s.id === 'snag-closed')!
    expect(closed.beforePhotos).toHaveLength(1)
    expect(closed.afterPhotos).toHaveLength(1)
    expect(closed.beforePhotos[0].caption).toBe('Before')
    expect(closed.afterPhotos[0].caption).toBe('After')
    // photos array is empty for closed snags (before/after split used instead)
    expect(closed.photos).toHaveLength(0)
  })

  it('resolves branding with project accent colour', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.branding.accent).toBe('#0055AA')
    expect(data.branding.kicker).toMatch(/SNAG/i)
  })

  it('resolves conductor name from profiles', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.visit.conductedByName).toBe('Jane Conductor')
  })

  it('resolves attendee names from profiles', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.visit.attendeeNames).toContain('Bob Attendee')
  })

  it('populates visit counts correctly', async () => {
    const { gatherSnagVisitReportData } = await import('./snag-visit-report-data')
    const data = await gatherSnagVisitReportData(buildCookieMock() as any, PROJECT_ID, VISIT_ID)
    expect(data.visit.newCount).toBe(1)
    expect(data.visit.openCount).toBe(1)
    expect(data.visit.closedCount).toBe(1)
  })
})
