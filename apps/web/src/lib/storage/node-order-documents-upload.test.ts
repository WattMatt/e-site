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

import {
  uploadNodeOrderDocumentFile,
  removeNodeOrderDocumentFile,
} from './node-order-documents-upload'

const PROJECT = '4f7d5cbc-8b34-485c-a62c-caf44c655335'
const ORDER = '45a74ded-a71d-46c2-8b6c-81137044ca97'

describe('uploadNodeOrderDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.mockResolvedValue({ error: null })
  })

  it('uploads straight to the node-order-documents bucket and returns the storage path', async () => {
    const file = new File(['pdf-bytes'], 'Supplier Quote.pdf', { type: 'application/pdf' })
    const res = await uploadNodeOrderDocumentFile({
      projectId: PROJECT,
      nodeOrderId: ORDER,
      docType: 'quote',
      file,
    })

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [bucket, path, uploaded, opts] = mockUpload.mock.calls[0]
    expect(bucket).toBe('node-order-documents')
    // Path convention: {projectId}/{nodeOrderId}/{docType}/{timestamp}-{sanitised filename}
    expect(path).toMatch(new RegExp(`^${PROJECT}/${ORDER}/quote/\\d+-Supplier_Quote\\.pdf$`))
    expect(uploaded).toBe(file)
    expect(opts).toEqual({ contentType: 'application/pdf' })
    expect(res.storagePath).toBe(path)
    expect(res.fileName).toBe('Supplier Quote.pdf')
  })

  it('builds the docType path segment for shop drawings', async () => {
    const file = new File(['dwg'], 'drawing.dwg', { type: 'image/vnd.dwg' })
    const res = await uploadNodeOrderDocumentFile({
      projectId: PROJECT,
      nodeOrderId: ORDER,
      docType: 'shop_drawing',
      file,
    })
    expect(res.storagePath).toMatch(new RegExp(`^${PROJECT}/${ORDER}/shop_drawing/\\d+-drawing\\.dwg$`))
  })

  it('accepts files between Vercel’s 4.5 MB cap and the 50 MB app cap', async () => {
    // 10 MB — larger than the serverless body cap that broke the old route
    const big = new File([new Uint8Array(10 * 1024 * 1024)], 'quote.pdf', { type: 'application/pdf' })
    const res = await uploadNodeOrderDocumentFile({
      projectId: PROJECT,
      nodeOrderId: ORDER,
      docType: 'quote',
      file: big,
    })
    expect(res.storagePath).toContain('quote.pdf')
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('rejects files over 50 MB without touching storage', async () => {
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 })
    await expect(
      uploadNodeOrderDocumentFile({ projectId: PROJECT, nodeOrderId: ORDER, docType: 'quote', file }),
    ).rejects.toThrow(/50 MB/)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('surfaces a readable error when the storage upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } })
    const file = new File(['x'], 'quote.pdf', { type: 'application/pdf' })
    await expect(
      uploadNodeOrderDocumentFile({ projectId: PROJECT, nodeOrderId: ORDER, docType: 'quote', file }),
    ).rejects.toThrow(/Upload failed: new row violates row-level security policy/)
  })
})

describe('removeNodeOrderDocumentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the object from the node-order-documents bucket', async () => {
    mockRemove.mockResolvedValue({ error: null })
    await removeNodeOrderDocumentFile(`${PROJECT}/${ORDER}/quote/123-quote.pdf`)
    expect(mockRemove).toHaveBeenCalledWith('node-order-documents', [
      `${PROJECT}/${ORDER}/quote/123-quote.pdf`,
    ])
  })

  it('is best-effort: swallows storage errors', async () => {
    mockRemove.mockRejectedValue(new Error('network down'))
    await expect(removeNodeOrderDocumentFile('a/b/c/d.pdf')).resolves.toBeUndefined()
  })
})
