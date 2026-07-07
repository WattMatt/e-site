import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ────────────────────────────────────────────────────────────

const { mockAdd, mockUpdateMeta, mockDelete, mockGetSignedUrl, mockUploadFile, mockRemoveFile } =
  vi.hoisted(() => ({
    mockAdd: vi.fn(),
    mockUpdateMeta: vi.fn(),
    mockDelete: vi.fn(),
    mockGetSignedUrl: vi.fn(),
    mockUploadFile: vi.fn(),
    mockRemoveFile: vi.fn(),
  }))

vi.mock('@/actions/node-order-document.actions', () => ({
  addNodeOrderDocumentAction: (...args: unknown[]) => mockAdd(...args),
  updateNodeOrderDocumentMetaAction: (...args: unknown[]) => mockUpdateMeta(...args),
  deleteNodeOrderDocumentAction: (...args: unknown[]) => mockDelete(...args),
  getNodeOrderDocumentSignedUrlAction: (...args: unknown[]) => mockGetSignedUrl(...args),
}))

// Direct-to-storage upload helper — bytes never transit a Next.js route
// (Vercel's ~4.5 MB body cap made the route's 50 MB limit unreachable).
vi.mock('@/lib/storage/node-order-documents-upload', () => ({
  uploadNodeOrderDocumentFile: (...args: unknown[]) => mockUploadFile(...args),
  removeNodeOrderDocumentFile: (...args: unknown[]) => mockRemoveFile(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { UnifiedDocSlot } from './UnifiedDocSlot'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UnifiedDocSlot upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderSlot() {
    return render(
      <UnifiedDocSlot projectId="p-1" nodeOrderId="ord-1" docType="quote" label="Quote" docs={[]} />,
    )
  }

  it('uploads direct to storage then attaches via addNodeOrderDocumentAction', async () => {
    mockUploadFile.mockResolvedValue({ storagePath: 'p-1/ord-1/quote/1-q.pdf', fileName: 'q.pdf' })
    mockAdd.mockResolvedValue({ ok: true })

    const { container } = renderSlot()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['pdf'], 'q.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput, file)

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p-1',
          nodeOrderId: 'ord-1',
          docType: 'quote',
          file: expect.any(File),
        }),
      )
      expect(mockAdd).toHaveBeenCalledWith('p-1', 'ord-1', 'quote', 'p-1/ord-1/quote/1-q.pdf', 'q.pdf')
    })
    expect(mockRemoveFile).not.toHaveBeenCalled()
  })

  it('removes the uploaded object and shows the error when the DB attach fails', async () => {
    mockUploadFile.mockResolvedValue({ storagePath: 'p-1/ord-1/quote/1-orphan.pdf', fileName: 'orphan.pdf' })
    mockAdd.mockResolvedValue({ error: 'Order not found' })

    const { container } = renderSlot()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, new File(['pdf'], 'orphan.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(mockRemoveFile).toHaveBeenCalledWith('p-1/ord-1/quote/1-orphan.pdf')
      expect(screen.getByText(/Order not found/)).toBeTruthy()
    })
  })

  it('shows upload-helper failures (e.g. size cap) without calling the attach action', async () => {
    mockUploadFile.mockRejectedValue(new Error('File exceeds the 50 MB limit.'))

    const { container } = renderSlot()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, new File(['pdf'], 'big.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(screen.getByText(/50 MB limit/)).toBeTruthy()
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
