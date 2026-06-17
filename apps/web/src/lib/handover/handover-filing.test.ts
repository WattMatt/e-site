import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileIntoHandover } from './handover-filing'

// A minimal chainable Supabase-ish mock. Each .from() call returns an object
// whose terminal (.maybeSingle/.single) resolves a queued result.
function makeClient(opts: {
  existingRoot?: { id: string; folder_path: string; organisation_id: string } | null
  insertDoc?: { data: { id: string } | null; error: { message: string } | null }
  uploadError?: { message: string } | null
}) {
  const removed: string[][] = []
  const uploaded: Array<{ bucket: string; path: string }> = []
  const insertedRows: Record<string, unknown>[] = []

  const client = {
    schema: (_s: string) => ({
      from: (table: string) => ({
        // ensureHandoverCategoryRoot: select existing root
        select: () => ({
          eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: opts.existingRoot ?? null }) }) }) }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertedRows.push(row)
          return {
            select: () => ({
              single: async () =>
                table === 'handover_folders'
                  ? { data: { id: 'folder-1', folder_path: '/compliance_certs/Compliance Certificates', organisation_id: 'org-1' }, error: null }
                  : (opts.insertDoc ?? { data: { id: 'doc-1' }, error: null }),
            }),
          }
        },
        delete: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          if (opts.uploadError) return { error: opts.uploadError }
          uploaded.push({ bucket, path })
          return { error: null }
        },
        remove: async (paths: string[]) => { removed.push(paths); return { error: null } },
      }),
    },
  }
  return { client, removed, uploaded, insertedRows }
}

describe('fileIntoHandover', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('ensures the category root, uploads bytes, and inserts a documents row tagged with origin_*', async () => {
    const { client, uploaded, insertedRows } = makeClient({ existingRoot: null })
    const res = await fileIntoHandover(client as never, {
      orgId: 'org-1', projectId: 'proj-1', category: 'compliance_certs',
      name: 'Inspection Report COC-1.pdf', bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf', originKind: 'inspection', originId: 'insp-1', userId: 'user-1',
    })
    expect('documentId' in res && res.documentId).toBe('doc-1')
    expect(uploaded.some((u) => u.bucket === 'project-documents')).toBe(true)
    const docRow = insertedRows.find((r) => r.category === 'handover')!
    expect(docRow.origin_kind).toBe('inspection')
    expect(docRow.origin_id).toBe('insp-1')
    expect(docRow.handover_category).toBe('compliance_certs')
  })

  it('rolls back the uploaded blob when the documents insert fails', async () => {
    const { client, removed } = makeClient({
      existingRoot: { id: 'folder-1', folder_path: '/compliance_certs/x', organisation_id: 'org-1' },
      insertDoc: { data: null, error: { message: 'boom' } },
    })
    const res = await fileIntoHandover(client as never, {
      orgId: 'org-1', projectId: 'proj-1', category: 'compliance_certs',
      name: 'r.pdf', bytes: new Uint8Array([1]), mimeType: 'application/pdf',
      originKind: 'inspection', originId: 'insp-1', userId: 'user-1',
    })
    expect('error' in res).toBe(true)
    expect(removed.length).toBe(1) // blob removed
  })
})
