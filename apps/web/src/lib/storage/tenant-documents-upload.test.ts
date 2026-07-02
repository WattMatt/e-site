import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the browser supabase client ────────────────────────────────────────

const { mockUpload, mockRemove } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockRemove: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => mockUpload(bucket, ...args),
        remove: (...args: unknown[]) => mockRemove(bucket, ...args),
      }),
    },
  }),
}))

import { uploadTenantDocumentFile, removeTenantDocumentFile } from './tenant-documents-upload'

const PROJECT = '4f7d5cbc-8b34-485c-a62c-caf44c655335'
const NODE = '45a74ded-a71d-46c2-8b6c-81137044ca97'

describe('uploadTenantDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.mockResolvedValue({ error: null })
  })

  it('uploads straight to the tenant-documents bucket and returns the storage path', async () => {
    const file = new File(['pdf-bytes'], 'Electrical Layout.pdf', { type: 'application/pdf' })
    const res = await uploadTenantDocumentFile({ projectId: PROJECT, nodeId: NODE, file, kind: 'layout' })

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [bucket, path, uploaded, opts] = mockUpload.mock.calls[0]
    expect(bucket).toBe('tenant-documents')
    // Path convention: {projectId}/{nodeId}/{timestamp}-{sanitised filename}
    expect(path).toMatch(new RegExp(`^${PROJECT}/${NODE}/\\d+-Electrical_Layout\\.pdf$`))
    expect(uploaded).toBe(file)
    expect(opts).toEqual({ contentType: 'application/pdf' })
    expect(res.storagePath).toBe(path)
    expect(res.filename).toBe('Electrical Layout.pdf')
  })

  it('imposes no size or MIME restriction on layout drawings (T1)', async () => {
    // 10 MB DWG — larger than Vercel's 4.5 MB function cap that broke the old route
    const big = new File([new Uint8Array(10 * 1024 * 1024)], 'plan.dwg', { type: 'image/vnd.dwg' })
    const res = await uploadTenantDocumentFile({ projectId: PROJECT, nodeId: NODE, file: big, kind: 'layout' })
    expect(res.storagePath).toContain('plan.dwg')
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('rejects non-PDF/Excel scope documents without touching storage', async () => {
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await expect(
      uploadTenantDocumentFile({ projectId: PROJECT, nodeId: NODE, file, kind: 'scope' }),
    ).rejects.toThrow(/PDF and Excel/)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rejects scope documents over 50 MB without touching storage', async () => {
    const file = new File(['x'], 'scope.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 })
    await expect(
      uploadTenantDocumentFile({ projectId: PROJECT, nodeId: NODE, file, kind: 'scope' }),
    ).rejects.toThrow(/50 MB/)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('surfaces a readable error when the storage upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } })
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    await expect(
      uploadTenantDocumentFile({ projectId: PROJECT, nodeId: NODE, file, kind: 'layout' }),
    ).rejects.toThrow(/Upload failed: new row violates row-level security policy/)
  })
})

describe('removeTenantDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the object from the tenant-documents bucket', async () => {
    mockRemove.mockResolvedValue({ error: null })
    await removeTenantDocumentFile(`${PROJECT}/${NODE}/123-plan.pdf`)
    expect(mockRemove).toHaveBeenCalledWith('tenant-documents', [`${PROJECT}/${NODE}/123-plan.pdf`])
  })

  it('is best-effort: swallows storage errors', async () => {
    mockRemove.mockRejectedValue(new Error('network down'))
    await expect(removeTenantDocumentFile('a/b/c.pdf')).resolves.toBeUndefined()
  })
})
