// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getByIdMock, createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, projectService: { ...actual.projectService, getById: getByIdMock } }
})

import {
  listTenantDocumentsAction,
  createTenantDocumentAction,
  addTenantDocumentRevisionAction,
  renameTenantDocumentAction,
  reorderTenantDocumentsAction,
  deleteTenantDocumentRevisionAction,
  deleteTenantDocumentAction,
  getRevisionSignedUrlAction,
} from './tenant-documents.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'
const DOC_ID = '33333333-3333-3333-3333-333333333333'
const REV_ID = '44444444-4444-4444-4444-444444444444'

/** Minimal supabase mock: auth.getUser + the effective-role RPC + the
 *  guardNodeBelongsToProject existence check (two chained .eq() on nodes).
 *  The .eq().maybeSingle() path returns { node_id: NODE } so ownership checks
 *  on tenant_documents succeed. The .eq().eq().maybeSingle() path returns
 *  { id: NODE } so guardNodeBelongsToProject succeeds. */
function mockClient(opts: {
  role?: string | null
  selectData?: unknown
  storageMock?: {
    remove?: ReturnType<typeof vi.fn>
    createSignedUrl?: ReturnType<typeof vi.fn>
  }
} = {}) {
  const { role = 'owner', selectData = null } = opts
  const removeMock = opts.storageMock?.remove ?? vi.fn().mockResolvedValue({ error: null })
  const createSignedUrlMock =
    opts.storageMock?.createSignedUrl ??
    vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.url' }, error: null })

  // Leaf data object returned after the final order/in/maybeSingle call
  const leafData = { data: Array.isArray(selectData) ? selectData : [], error: null }

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: (_table: string) => ({
        select: () => ({
          // .eq(id).eq(project_id).maybeSingle() — guardNodeBelongsToProject (nodes)
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: NODE }, error: null }),
              // For single-column selects on revisions/docs
              order: () => ({
                ...leafData,
                // Support double .order().order() (list docs: kind then sort_order)
                order: () => leafData,
              }),
            }),
            // .eq(id).maybeSingle() — tenant_documents ownership lookup
            maybeSingle: () => Promise.resolve({ data: { node_id: NODE }, error: null }),
            // For order chaining without a second .eq()
            order: () => ({
              ...leafData,
              // Support double .order().order() (list docs: kind then sort_order)
              order: () => leafData,
            }),
            in: () => ({
              order: () => leafData,
            }),
          }),
          in: () => ({
            order: () => leafData,
          }),
          order: () => ({
            ...leafData,
            order: () => leafData,
          }),
        }),
      }),
    }),
    storage: {
      from: (_bucket: string) => ({
        remove: removeMock,
        createSignedUrl: createSignedUrlMock,
      }),
    },
  }
}

beforeEach(() => {
  createClientMock.mockReset()
  revalidatePathMock.mockReset()
  getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('input validation', () => {
  it('rejects a non-uuid projectId before any I/O', async () => {
    const res = await createTenantDocumentAction('not-a-uuid', NODE, 'layout', 'Title', {
      storagePath: 'x/y.pdf',
      fileName: 'y.pdf',
      revLabel: 'Rev A',
    })
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid nodeId before any I/O', async () => {
    const res = await createTenantDocumentAction(PROJECT, 'not-a-uuid', 'layout', 'Title', {
      storagePath: 'x/y.pdf',
      fileName: 'y.pdf',
      revLabel: 'Rev A',
    })
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// RBAC gate
// ---------------------------------------------------------------------------

describe('RBAC gate', () => {
  it('denies createTenantDocumentAction for contractor — no write fetch issued', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await createTenantDocumentAction(PROJECT, NODE, 'layout', 'Title', {
      storagePath: 'x/y.pdf',
      fileName: 'y.pdf',
      revLabel: 'Rev A',
    })

    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('denies addTenantDocumentRevisionAction for contractor — no write fetch issued', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await addTenantDocumentRevisionAction(PROJECT, DOC_ID, {
      storagePath: 'x/y.pdf',
      fileName: 'y.pdf',
      revLabel: 'Rev B',
    })

    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('denies deleteTenantDocumentAction for contractor — no write fetch issued', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await deleteTenantDocumentAction(PROJECT, DOC_ID)

    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows listTenantDocumentsAction for contractor (read — no write role needed)', async () => {
    const docRow = { id: DOC_ID, node_id: NODE, kind: 'layout', title: 'Floor Plan', sort_order: 0 }
    const revRow = {
      id: REV_ID,
      tenant_document_id: DOC_ID,
      rev_label: 'Rev A',
      storage_path: 'a/a.pdf',
      file_name: 'a.pdf',
      note: null,
      issued_at: '2026-06-01T10:00:00Z',
      uploaded_by: 'u-1',
      created_at: '2026-06-01T10:00:00Z',
    }

    const docSelectChain = {
      select: () => ({
        eq: () => ({
          order: () => ({
            data: [docRow],
            error: null,
            order: () => ({ data: [docRow], error: null }),
          }),
        }),
      }),
    }
    const revSelectChain = {
      select: () => ({
        in: () => ({
          order: () => ({ data: [revRow], error: null }),
        }),
      }),
    }

    const contractorClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      // rpc not called by guardProjectRead — but stub it defensively
      rpc: () => Promise.resolve({ data: 'contractor', error: null }),
      schema: () => ({
        from: (table: string) => {
          if (table === 'tenant_documents') return docSelectChain
          if (table === 'tenant_document_revisions') return revSelectChain
          return docSelectChain
        },
      }),
      storage: { from: () => ({ remove: vi.fn(), createSignedUrl: vi.fn() }) },
    }
    createClientMock.mockResolvedValue(contractorClient)

    const res = await listTenantDocumentsAction(PROJECT, NODE)

    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.documents).toHaveLength(1)
    expect(res.documents[0].revisions).toHaveLength(1)
  })

  it('rejects renameTenantDocumentAction when document belongs to a different project (cross-project gap closed)', async () => {
    // Simulate: the document's node_id resolves (doc exists) but that node
    // does NOT belong to the requested projectId → guardNodeBelongsToProject returns null row.
    const OTHER_NODE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const crossProjectClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
      schema: () => ({
        from: (table: string) => {
          if (table === 'tenant_documents') {
            // doc exists, returns a node_id from a different project
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { node_id: OTHER_NODE }, error: null }),
                }),
              }),
            }
          }
          // nodes — guardNodeBelongsToProject: eq(id=OTHER_NODE).eq(project_id=PROJECT) → no row
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }
        },
      }),
      storage: { from: () => ({ remove: vi.fn(), createSignedUrl: vi.fn() }) },
    }
    createClientMock.mockResolvedValue(crossProjectClient)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await renameTenantDocumentAction(PROJECT, DOC_ID, 'Malicious Rename')

    expect('error' in res).toBe(true)
    // No service-role write should have been issued
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows createTenantDocumentAction for owner', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'owner' }))
    const fetchMock = vi
      .fn()
      // POST tenant_documents
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: DOC_ID }]),
        text: () => Promise.resolve(''),
      })
      // POST tenant_document_revisions
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: REV_ID }]),
        text: () => Promise.resolve(''),
      })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createTenantDocumentAction(PROJECT, NODE, 'layout', 'Title', {
      storagePath: 'p/f.pdf',
      fileName: 'f.pdf',
      revLabel: 'Rev A',
    })

    expect('error' in res).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// createTenantDocumentAction
// ---------------------------------------------------------------------------

describe('createTenantDocumentAction', () => {
  it('POSTs to /rest/v1/tenant_documents then /rest/v1/tenant_document_revisions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: DOC_ID }]),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: REV_ID }]),
        text: () => Promise.resolve(''),
      })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createTenantDocumentAction(PROJECT, NODE, 'scope', 'My Scope Doc', {
      storagePath: 'org/proj/file.pdf',
      fileName: 'file.pdf',
      revLabel: 'Rev 1',
      note: 'first issue',
    })

    expect(res).toMatchObject({ ok: true, documentId: DOC_ID })

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(firstUrl).toContain('/rest/v1/tenant_documents')
    expect(firstInit.headers).toMatchObject({ 'Content-Profile': 'structure' })

    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(secondUrl).toContain('/rest/v1/tenant_document_revisions')
    expect(secondInit.headers).toMatchObject({ 'Content-Profile': 'structure' })

    // uploaded_by should be set in the revision body
    const revBody = JSON.parse(secondInit.body as string)
    expect(revBody.uploaded_by).toBe('u-1')

    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT}/tenant-schedule`)
  })
})

// ---------------------------------------------------------------------------
// addTenantDocumentRevisionAction
// ---------------------------------------------------------------------------

describe('addTenantDocumentRevisionAction', () => {
  it('POSTs to /rest/v1/tenant_document_revisions with uploaded_by', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: REV_ID }]),
      text: () => Promise.resolve(''),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await addTenantDocumentRevisionAction(PROJECT, DOC_ID, {
      storagePath: 'org/proj/rev2.pdf',
      fileName: 'rev2.pdf',
      revLabel: 'Rev 2',
    })

    expect(res).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/tenant_document_revisions')
    expect(init.headers).toMatchObject({ 'Content-Profile': 'structure' })
    const body = JSON.parse(init.body as string)
    expect(body.uploaded_by).toBe('u-1')
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// renameTenantDocumentAction
// ---------------------------------------------------------------------------

describe('renameTenantDocumentAction', () => {
  it('PATCHes /rest/v1/tenant_documents with the new title', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(''),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await renameTenantDocumentAction(PROJECT, DOC_ID, 'New Title')

    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/tenant_documents')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.title).toBe('New Title')
  })
})

// ---------------------------------------------------------------------------
// reorderTenantDocumentsAction
// ---------------------------------------------------------------------------

describe('reorderTenantDocumentsAction', () => {
  it('PATCHes sort_order for each id in order, scoped to node_id', async () => {
    const ID_A = '55555555-5555-5555-5555-555555555555'
    const ID_B = '66666666-6666-6666-6666-666666666666'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await reorderTenantDocumentsAction(PROJECT, NODE, 'layout', [ID_A, ID_B])

    expect(res).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [url0, init0] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url0).toContain(`id=eq.${ID_A}`)
    expect(url0).toContain(`node_id=eq.${NODE}`)
    expect(JSON.parse(init0.body as string).sort_order).toBe(0)

    const [url1, init1] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url1).toContain(`id=eq.${ID_B}`)
    expect(url1).toContain(`node_id=eq.${NODE}`)
    expect(JSON.parse(init1.body as string).sort_order).toBe(1)
  })

  it('rejects when nodeId does not belong to projectId — no service-role write issued', async () => {
    // guardNodeBelongsToProject: .eq(id).eq(project_id).maybeSingle() → null (foreign node)
    const crossNodeClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
      schema: () => ({
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
      storage: { from: () => ({ remove: vi.fn(), createSignedUrl: vi.fn() }) },
    }
    createClientMock.mockResolvedValue(crossNodeClient)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const ID_A = '55555555-5555-5555-5555-555555555555'
    const OTHER_NODE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const res = await reorderTenantDocumentsAction(PROJECT, OTHER_NODE, 'layout', [ID_A])

    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listTenantDocumentsAction
// ---------------------------------------------------------------------------

describe('listTenantDocumentsAction', () => {
  it('groups revisions under their document, newest first', async () => {
    const docRow = { id: DOC_ID, node_id: NODE, kind: 'layout', title: 'Floor Plan', sort_order: 0 }
    const rev1 = {
      id: REV_ID,
      tenant_document_id: DOC_ID,
      rev_label: 'Rev B',
      storage_path: 'a/b.pdf',
      file_name: 'b.pdf',
      note: null,
      issued_at: '2026-06-03T10:00:00Z',
      uploaded_by: 'u-1',
      created_at: '2026-06-03T10:00:00Z',
    }
    const rev2 = {
      id: '77777777-7777-7777-7777-777777777777',
      tenant_document_id: DOC_ID,
      rev_label: 'Rev A',
      storage_path: 'a/a.pdf',
      file_name: 'a.pdf',
      note: null,
      issued_at: '2026-06-01T10:00:00Z',
      uploaded_by: 'u-1',
      created_at: '2026-06-01T10:00:00Z',
    }

    // We need to control what schema().from() returns per table
    // The mock client returns selectData for both calls. We'll use a custom mock.
    const docSelectChain = {
      select: () => ({
        eq: () => ({
          order: () => ({
            data: [docRow],
            error: null,
            // Support double .order().order() (kind then sort_order)
            order: () => ({ data: [docRow], error: null }),
          }),
        }),
      }),
    }
    const revSelectChain = {
      select: () => ({
        in: () => ({
          order: () => ({
            data: [rev1, rev2],
            error: null,
          }),
        }),
      }),
    }

    const customClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
      schema: () => ({
        from: (table: string) => {
          if (table === 'tenant_documents') return docSelectChain
          if (table === 'tenant_document_revisions') return revSelectChain
          // nodes check for guardNodeBelongsToProject — not called for listAction
          return docSelectChain
        },
      }),
      storage: {
        from: () => ({
          remove: vi.fn(),
          createSignedUrl: vi.fn(),
        }),
      },
    }
    createClientMock.mockResolvedValue(customClient)

    const res = await listTenantDocumentsAction(PROJECT, NODE)

    expect('error' in res).toBe(false)
    if ('error' in res) return

    expect(res.documents).toHaveLength(1)
    const doc = res.documents[0]
    expect(doc.id).toBe(DOC_ID)
    expect(doc.revisions).toHaveLength(2)
    // Newest first: rev1 has later issued_at
    expect(doc.revisions[0].id).toBe(REV_ID)
  })
})

// ---------------------------------------------------------------------------
// deleteTenantDocumentRevisionAction
// ---------------------------------------------------------------------------

describe('deleteTenantDocumentRevisionAction', () => {
  it('DELETEs the revision row and removes storage object best-effort', async () => {
    const removeMock = vi.fn().mockResolvedValue({ error: null })
    // Table-discriminated mock: revision lookup → doc lookup → node lookup
    const customClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
      schema: () => ({
        from: (table: string) => {
          if (table === 'tenant_document_revisions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: REV_ID, storage_path: 'org/proj/file.pdf', tenant_document_id: DOC_ID },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'tenant_documents') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { node_id: NODE }, error: null }),
                }),
              }),
            }
          }
          // nodes — guardNodeBelongsToProject: .select().eq(id).eq(project_id).maybeSingle()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: NODE }, error: null }),
                }),
              }),
            }),
          }
        },
      }),
      storage: {
        from: (_bucket: string) => ({
          remove: removeMock,
          createSignedUrl: vi.fn(),
        }),
      },
    }
    createClientMock.mockResolvedValue(customClient)

    const fetchMock = vi
      .fn()
      // DELETE revision row
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await deleteTenantDocumentRevisionAction(PROJECT, REV_ID)

    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/tenant_document_revisions')
    expect(init.method).toBe('DELETE')
    expect(removeMock).toHaveBeenCalledWith(['org/proj/file.pdf'])
  })
})

// ---------------------------------------------------------------------------
// deleteTenantDocumentAction
// ---------------------------------------------------------------------------

describe('deleteTenantDocumentAction', () => {
  it('reads revision storage paths, DELETEs the doc row, removes storage objects', async () => {
    const removeMock = vi.fn().mockResolvedValue({ error: null })
    const revRows = [
      { id: REV_ID, storage_path: 'org/proj/rev1.pdf', tenant_document_id: DOC_ID },
      { id: '55555555-5555-5555-5555-555555555555', storage_path: 'org/proj/rev2.pdf', tenant_document_id: DOC_ID },
    ]
    // Table-discriminated mock: doc node_id lookup → node guard → revisions list
    const customClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
      schema: () => ({
        from: (table: string) => {
          if (table === 'tenant_documents') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { node_id: NODE }, error: null }),
                }),
              }),
            }
          }
          if (table === 'nodes') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: NODE }, error: null }),
                  }),
                }),
              }),
            }
          }
          // tenant_document_revisions — plain array result (no maybeSingle)
          return {
            select: () => ({
              eq: () => ({
                data: revRows,
                error: null,
              }),
            }),
          }
        },
      }),
      storage: {
        from: (_bucket: string) => ({
          remove: removeMock,
          createSignedUrl: vi.fn(),
        }),
      },
    }
    createClientMock.mockResolvedValue(customClient)

    const fetchMock = vi
      .fn()
      // DELETE tenant_documents row
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await deleteTenantDocumentAction(PROJECT, DOC_ID)

    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/tenant_documents')
    expect(init.method).toBe('DELETE')
    expect(removeMock).toHaveBeenCalledWith(['org/proj/rev1.pdf', 'org/proj/rev2.pdf'])
  })
})

// ---------------------------------------------------------------------------
// getRevisionSignedUrlAction
// ---------------------------------------------------------------------------

describe('getRevisionSignedUrlAction', () => {
  it('returns a signed url with 300s TTL', async () => {
    const createSignedUrlMock = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://signed.url/file.pdf' }, error: null })
    const customClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
      rpc: () => Promise.resolve({ data: 'owner', error: null }),
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: REV_ID, storage_path: 'org/proj/file.pdf' },
                  error: null,
                }),
            }),
          }),
        }),
      }),
      storage: {
        from: (_bucket: string) => ({
          remove: vi.fn(),
          createSignedUrl: createSignedUrlMock,
        }),
      },
    }
    createClientMock.mockResolvedValue(customClient)

    const res = await getRevisionSignedUrlAction(PROJECT, REV_ID)

    expect(res).toEqual({ ok: true, url: 'https://signed.url/file.pdf' })
    expect(createSignedUrlMock).toHaveBeenCalledWith('org/proj/file.pdf', 300)
  })
})
