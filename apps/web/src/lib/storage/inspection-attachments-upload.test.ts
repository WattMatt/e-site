import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the browser supabase client ────────────────────────────────────────

const { mockUpload, mockRemove, mockSingle } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockRemove: vi.fn(),
  mockSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ single: mockSingle }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => mockUpload(bucket, ...args),
        remove: (...args: unknown[]) => mockRemove(bucket, ...args),
      }),
    },
  }),
}))

import {
  uploadInspectionAttachmentFile,
  removeInspectionAttachmentFile,
} from './inspection-attachments-upload'

const PROJECT = '4f7d5cbc-8b34-485c-a62c-caf44c655335'
const INSPECTION = '45a74ded-a71d-46c2-8b6c-81137044ca97'
const SECTION = 'sec-1'
const FIELD = 'f-file-1'

const uploadOpts = (file: File) => ({
  inspectionId: INSPECTION,
  sectionId: SECTION,
  fieldId: FIELD,
  file,
})

describe('uploadInspectionAttachmentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue({ data: { project_id: PROJECT, status: 'in_progress' } })
    mockUpload.mockResolvedValue({ error: null })
  })

  it('uploads straight to the inspection-attachments bucket and returns the storage path', async () => {
    const file = new File(['pdf-bytes'], 'Spec Sheet.pdf', { type: 'application/pdf' })
    const res = await uploadInspectionAttachmentFile(uploadOpts(file))

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [bucket, path, uploaded, opts] = mockUpload.mock.calls[0]
    expect(bucket).toBe('inspection-attachments')
    // Path convention: {projectId}/{inspectionId}/{sectionId}/{fieldId}/{ts}-{sanitised}
    // — segment 2 (inspectionId) is what the 00073 bucket RLS policies check.
    expect(path).toMatch(
      new RegExp(`^${PROJECT}/${INSPECTION}/${SECTION}/${FIELD}/\\d+-Spec_Sheet\\.pdf$`),
    )
    expect(uploaded).toBe(file)
    expect(opts).toEqual({ contentType: 'application/pdf' })
    expect(res.storagePath).toBe(path)
    expect(res.filename).toBe('Spec Sheet.pdf')
  })

  it('accepts files larger than Vercel’s 4.5 MB body cap that broke the old route', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024)], 'manual.pdf', {
      type: 'application/pdf',
    })
    const res = await uploadInspectionAttachmentFile(uploadOpts(big))
    expect(res.storagePath).toContain('manual.pdf')
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('rejects MIME types outside PDF/DOCX/XLSX without touching the network', async () => {
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await expect(uploadInspectionAttachmentFile(uploadOpts(file))).rejects.toThrow(
      /PDF, Word .* and Excel/,
    )
    expect(mockSingle).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('allows application/octet-stream and an empty MIME type (route parity)', async () => {
    // Some browsers/OSes report .docx/.xlsx as octet-stream or nothing at all.
    const generic = new File(['x'], 'spec.docx', { type: 'application/octet-stream' })
    await expect(uploadInspectionAttachmentFile(uploadOpts(generic))).resolves.toBeDefined()

    const untyped = new File(['x'], 'spec.xlsx')
    await expect(uploadInspectionAttachmentFile(uploadOpts(untyped))).resolves.toBeDefined()
  })

  it('gives a readable error for a non-writable inspection status, before uploading', async () => {
    mockSingle.mockResolvedValue({ data: { project_id: PROJECT, status: 'certified' } })
    const file = new File(['x'], 'spec.pdf', { type: 'application/pdf' })
    await expect(uploadInspectionAttachmentFile(uploadOpts(file))).rejects.toThrow(
      /status 'certified'/,
    )
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('throws when the inspection cannot be read', async () => {
    mockSingle.mockResolvedValue({ data: null })
    const file = new File(['x'], 'spec.pdf', { type: 'application/pdf' })
    await expect(uploadInspectionAttachmentFile(uploadOpts(file))).rejects.toThrow(
      /Inspection not found/,
    )
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('surfaces a readable error when the storage upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } })
    const file = new File(['x'], 'spec.pdf', { type: 'application/pdf' })
    await expect(uploadInspectionAttachmentFile(uploadOpts(file))).rejects.toThrow(
      /Upload failed: new row violates row-level security policy/,
    )
  })
})

describe('removeInspectionAttachmentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the object from the inspection-attachments bucket', async () => {
    mockRemove.mockResolvedValue({ error: null })
    await removeInspectionAttachmentFile(`${PROJECT}/${INSPECTION}/${SECTION}/${FIELD}/123-spec.pdf`)
    expect(mockRemove).toHaveBeenCalledWith('inspection-attachments', [
      `${PROJECT}/${INSPECTION}/${SECTION}/${FIELD}/123-spec.pdf`,
    ])
  })

  it('is best-effort: swallows storage errors', async () => {
    mockRemove.mockRejectedValue(new Error('network down'))
    await expect(removeInspectionAttachmentFile('a/b/c/d/e.pdf')).resolves.toBeUndefined()
  })
})
