import { describe, it, expect, vi } from 'vitest'
import { compareQcPhotos, qcService } from './qc.service'

/** Captures the row handed to .insert(): schema().from().insert().select().single(). */
function buildInsertCaptureClient() {
  const captured: { payload?: any } = {}
  const single = vi.fn(() =>
    Promise.resolve({ data: { id: 'qc-1', ...(captured.payload ?? {}) }, error: null }),
  )
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn((payload: any) => {
    captured.payload = payload
    return { select }
  })
  const from = vi.fn(() => ({ insert }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as any, captured }
}

const ORG = 'org-1'
const USER = 'user-1'
const baseCreateInput = {
  projectId: 'project-1',
  title: 'Slab pour QC',
}

describe('qcService.create — server-forced tenancy + field mapping', () => {
  it('binds organisation_id and raised_by to its arguments, ignoring any input-borne values', async () => {
    const { client, captured } = buildInsertCaptureClient()

    await qcService.create(
      client,
      ORG,
      USER,
      // A hostile caller cannot smuggle tenancy in through the input object.
      { ...baseCreateInput, organisation_id: 'org-evil', raised_by: 'user-evil' } as any,
    )

    expect(captured.payload.organisation_id).toBe(ORG)
    expect(captured.payload.raised_by).toBe(USER)
  })

  it('coerces empty-string optionals to null ("" would break the DATE column)', async () => {
    const { client, captured } = buildInsertCaptureClient()
    await qcService.create(client, ORG, USER, {
      ...baseCreateInput,
      description: '',
      location: '',
      inspectionDate: '',
    } as any)
    expect(captured.payload.description).toBeNull()
    expect(captured.payload.location).toBeNull()
    expect(captured.payload.inspection_date).toBeNull()
  })

  it('does not set status or report_no (DB default + trigger own those)', async () => {
    const { client, captured } = buildInsertCaptureClient()
    await qcService.create(client, ORG, USER, { ...baseCreateInput })
    expect(captured.payload.status).toBeUndefined()
    expect(captured.payload.report_no).toBeUndefined()
  })
})

/** Captures the patch handed to .update(): schema().from().update().eq().select().single(). */
function buildUpdateCaptureClient() {
  const captured: { payload?: any } = {}
  const single = vi.fn(() => Promise.resolve({ data: { id: 'qc-1' }, error: null }))
  const select = vi.fn(() => ({ single }))
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn((payload: any) => {
    captured.payload = payload
    return { eq }
  })
  const from = vi.fn(() => ({ update }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as any, captured }
}

describe('qcService.update', () => {
  it('maps camelCase patch fields to snake_case columns', async () => {
    const { client, captured } = buildUpdateCaptureClient()
    await qcService.update(client, 'qc-1', {
      title: 'Renamed',
      inspectionDate: '2026-07-14',
    })
    expect(captured.payload).toEqual({ title: 'Renamed', inspection_date: '2026-07-14' })
  })

  it('coerces empty-string optionals to null', async () => {
    const { client, captured } = buildUpdateCaptureClient()
    await qcService.update(client, 'qc-1', { description: '', inspectionDate: '' })
    expect(captured.payload.description).toBeNull()
    expect(captured.payload.inspection_date).toBeNull()
  })

  it('throws when no editable fields are provided', async () => {
    const { client } = buildUpdateCaptureClient()
    await expect(qcService.update(client, 'qc-1', {})).rejects.toThrow('no editable fields')
  })
})

/**
 * Mock for addEntry:
 * - max-sort_order lookup → schema().from().select().eq().order().limit().maybeSingle()
 * - entry insert          → schema().from().insert().select().single()
 */
function buildAddEntryClient(lastSortOrder: number | null) {
  const captured: { payload?: any } = {}
  const maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: lastSortOrder === null ? null : { sort_order: lastSortOrder },
      error: null,
    }),
  )
  const limit = vi.fn(() => ({ maybeSingle }))
  const order = vi.fn(() => ({ limit }))
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const single = vi.fn(() =>
    Promise.resolve({ data: { id: 'entry-1', ...(captured.payload ?? {}) }, error: null }),
  )
  const insertSelect = vi.fn(() => ({ single }))
  const insert = vi.fn((payload: any) => {
    captured.payload = payload
    return { select: insertSelect }
  })
  const from = vi.fn(() => ({ select, insert }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as any, captured }
}

describe('qcService.addEntry', () => {
  const input = {
    organisationId: ORG,
    projectId: 'project-1',
    reportId: 'qc-1',
    title: 'DB room',
  }

  it('appends after the current max sort_order', async () => {
    const { client, captured } = buildAddEntryClient(4)
    await qcService.addEntry(client, input, USER)
    expect(captured.payload.sort_order).toBe(5)
  })

  it('starts at sort_order 0 for the first entry', async () => {
    const { client, captured } = buildAddEntryClient(null)
    await qcService.addEntry(client, input, USER)
    expect(captured.payload.sort_order).toBe(0)
  })

  it('binds tenancy + author columns from its arguments', async () => {
    const { client, captured } = buildAddEntryClient(null)
    await qcService.addEntry(client, input, USER)
    expect(captured.payload.report_id).toBe('qc-1')
    expect(captured.payload.organisation_id).toBe(ORG)
    expect(captured.payload.project_id).toBe('project-1')
    expect(captured.payload.created_by).toBe(USER)
  })
})

/**
 * Mock for addComment:
 * - entry lookup  → qc_entries: select().eq().maybeSingle()
 * - photo lookup  → qc_entry_photos: select().eq().maybeSingle()
 * - comment insert → qc_comments: insert().select().single()
 */
function buildAddCommentClient(opts: {
  entry?: { id: string; report_id: string } | null
  photo?: { id: string; entry_id: string } | null
}) {
  const captured: { payload?: any } = {}
  const single = vi.fn(() =>
    Promise.resolve({ data: { id: 'comment-1', ...(captured.payload ?? {}) }, error: null }),
  )
  const insertSelect = vi.fn(() => ({ single }))
  const insert = vi.fn((payload: any) => {
    captured.payload = payload
    return { select: insertSelect }
  })
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'qc_entries' ? (opts.entry ?? null) : (opts.photo ?? null),
            error: null,
          }),
      }),
    }),
    insert,
  }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as any, captured, insert }
}

describe('qcService.addComment', () => {
  const entry = { id: 'entry-1', report_id: 'qc-1' }

  it('resolves report_id from the entry and writes a group comment (photo_id null)', async () => {
    const { client, captured } = buildAddCommentClient({ entry })
    await qcService.addComment(client, { entryId: 'entry-1', body: 'Looks good.' }, USER)
    expect(captured.payload.report_id).toBe('qc-1')
    expect(captured.payload.entry_id).toBe('entry-1')
    expect(captured.payload.photo_id).toBeNull()
    expect(captured.payload.created_by).toBe(USER)
  })

  it('writes photo_id for a per-photo comment when the photo belongs to the entry', async () => {
    const { client, captured } = buildAddCommentClient({
      entry,
      photo: { id: 'photo-1', entry_id: 'entry-1' },
    })
    await qcService.addComment(
      client,
      { entryId: 'entry-1', photoId: 'photo-1', body: 'Crack visible here.' },
      USER,
    )
    expect(captured.payload.photo_id).toBe('photo-1')
  })

  it('rejects a photoId that belongs to a different entry (no insert)', async () => {
    const { client, insert } = buildAddCommentClient({
      entry,
      photo: { id: 'photo-1', entry_id: 'entry-OTHER' },
    })
    await expect(
      qcService.addComment(client, { entryId: 'entry-1', photoId: 'photo-1', body: 'x' }, USER),
    ).rejects.toThrow('does not belong')
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects when the entry does not exist (no insert)', async () => {
    const { client, insert } = buildAddCommentClient({ entry: null })
    await expect(
      qcService.addComment(client, { entryId: 'missing', body: 'x' }, USER),
    ).rejects.toThrow('entry not found')
    expect(insert).not.toHaveBeenCalled()
  })
})

/**
 * Mock for listByProject: three list queries (reports / entries / photos)
 * routed by table name, then fetchProfileMap's public.profiles read via the
 * top-level from().
 */
function buildListClient(opts: {
  reports: Array<Record<string, unknown>>
  entries: Array<{ id: string; report_id: string }>
  photos: Array<{ id: string; entry_id: string }>
}) {
  const listFor = (table: string) => {
    if (table === 'qc_reports') return opts.reports
    if (table === 'qc_entries') return opts.entries
    return opts.photos
  }
  const schemaFrom = vi.fn((table: string) => ({
    select: () => ({
      eq: () => {
        const rows = listFor(table)
        return {
          // qc_reports path adds .order(); entries/photos resolve at .eq()
          order: () => Promise.resolve({ data: rows, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
        }
      },
    }),
  }))
  const client = {
    schema: () => ({ from: schemaFrom }),
    // fetchProfileMap uses the default (public) schema.
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [{ id: USER, full_name: 'Jane' }], error: null }),
      }),
    }),
  }
  return { client: client as any }
}

describe('qcService.listByProject', () => {
  it('computes entry + photo counts per report and joins raiser profiles', async () => {
    const { client } = buildListClient({
      reports: [
        { id: 'r1', report_no: 2, raised_by: USER },
        { id: 'r2', report_no: 1, raised_by: USER },
      ],
      entries: [
        { id: 'e1', report_id: 'r1' },
        { id: 'e2', report_id: 'r1' },
        { id: 'e3', report_id: 'r2' },
      ],
      photos: [
        { id: 'p1', entry_id: 'e1' },
        { id: 'p2', entry_id: 'e1' },
        { id: 'p3', entry_id: 'e3' },
      ],
    })
    const rows = await qcService.listByProject(client, 'project-1')
    const r1 = rows.find((r: any) => r.id === 'r1')
    const r2 = rows.find((r: any) => r.id === 'r2')
    expect(r1).toMatchObject({ entryCount: 2, photoCount: 2 })
    expect(r2).toMatchObject({ entryCount: 1, photoCount: 1 })
    expect((r1 as any).raised_by_profile).toEqual({ id: USER, full_name: 'Jane' })
  })

  it('returns zero counts for a report with no entries', async () => {
    const { client } = buildListClient({
      reports: [{ id: 'r1', report_no: 1, raised_by: USER }],
      entries: [],
      photos: [],
    })
    const rows = await qcService.listByProject(client, 'project-1')
    expect(rows[0]).toMatchObject({ entryCount: 0, photoCount: 0 })
  })
})

/**
 * Mock for listEntriesWithPhotos: one nested read —
 * schema().from('qc_entries').select().eq().order() → entries with embedded
 * qc_entry_photos/qc_comments arrays — then fetchProfileMap via top-level from().
 */
function buildEntriesClient(entries: Array<Record<string, unknown>>) {
  const order = vi.fn(() => Promise.resolve({ data: entries, error: null }))
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const schema = vi.fn(() => ({ from }))
  const client = {
    schema,
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [{ id: USER, full_name: 'Jane' }], error: null }),
      }),
    }),
  }
  return { client: client as any }
}

describe('qcService.listEntriesWithPhotos — deterministic photo ordering', () => {
  it('breaks duplicate sort_order ties by created_at then id, so "Photo N" is stable', async () => {
    // Two photos tie on sort_order 3 AND created_at (the nextSortOrder MAX+1
    // race) — id is the final tiebreaker. Input arrives in a hostile order to
    // prove the sort does the work, not the DB's nested-row order.
    const photos = [
      { id: 'p-z', sort_order: 3, created_at: '2026-07-14T10:00:00Z' },
      { id: 'p-late', sort_order: 1, created_at: '2026-07-14T09:00:00Z' },
      { id: 'p-a', sort_order: 3, created_at: '2026-07-14T10:00:00Z' },
      { id: 'p-early', sort_order: 1, created_at: '2026-07-14T08:00:00Z' },
      { id: 'p-first', sort_order: 0, created_at: '2026-07-14T11:00:00Z' },
    ]
    const { client } = buildEntriesClient([
      { id: 'e1', created_by: USER, sort_order: 0, qc_entry_photos: photos, qc_comments: [] },
    ])

    const [entry] = await qcService.listEntriesWithPhotos(client, 'qc-1')
    expect(entry.qc_entry_photos.map((p: { id: string }) => p.id)).toEqual([
      'p-first',   // sort_order 0
      'p-early',   // sort_order 1, earlier created_at
      'p-late',    // sort_order 1, later created_at
      'p-a',       // sort_order 3, created_at tie → id 'p-a' < 'p-z'
      'p-z',
    ])
  })

  it('exports compareQcPhotos (shared with the PDF gatherer) with the same rule', () => {
    const a = { id: 'a', sort_order: 2, created_at: '2026-07-14T10:00:00Z' }
    const b = { id: 'b', sort_order: 2, created_at: '2026-07-14T10:00:00Z' }
    expect(compareQcPhotos(a, b)).toBeLessThan(0)
    expect(compareQcPhotos(b, a)).toBeGreaterThan(0)
    expect(compareQcPhotos({ ...a, sort_order: 1 }, b)).toBeLessThan(0)
    expect(compareQcPhotos({ ...b, created_at: '2026-07-14T09:00:00Z' }, a)).toBeLessThan(0)
  })
})
