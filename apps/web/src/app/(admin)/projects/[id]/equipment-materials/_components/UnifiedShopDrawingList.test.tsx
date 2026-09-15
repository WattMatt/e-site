import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ────────────────────────────────────────────────────────────

const { mockAddDrawing, mockUploadFile, mockRemoveFile } = vi.hoisted(() => ({
  mockAddDrawing: vi.fn(),
  mockUploadFile: vi.fn(),
  mockRemoveFile: vi.fn(),
}))

vi.mock('@/actions/node-order-shop-drawing.actions', () => ({
  addShopDrawingAction: (...args: unknown[]) => mockAddDrawing(...args),
  markShopDrawingReceivedAction: vi.fn(),
  approveShopDrawingAction: vi.fn(),
  revertShopDrawingAction: vi.fn(),
  removeShopDrawingAction: vi.fn(),
  getShopDrawingSignedUrlAction: vi.fn(),
}))

// Shop drawings share the node-order-documents bucket + direct-upload helper.
vi.mock('@/lib/storage/node-order-documents-upload', () => ({
  uploadNodeOrderDocumentFile: (...args: unknown[]) => mockUploadFile(...args),
  removeNodeOrderDocumentFile: (...args: unknown[]) => mockRemoveFile(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { UnifiedShopDrawingList } from './UnifiedShopDrawingList'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UnifiedShopDrawingList upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderList() {
    return render(<UnifiedShopDrawingList projectId="p-1" nodeOrderId="ord-1" drawings={[]} />)
  }

  it('uploads direct to storage with docType shop_drawing then attaches via addShopDrawingAction', async () => {
    mockUploadFile.mockResolvedValue({ storagePath: 'p-1/ord-1/shop_drawing/1-d.pdf', fileName: 'd.pdf' })
    mockAddDrawing.mockResolvedValue({ ok: true })

    const { container } = renderList()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, new File(['pdf'], 'd.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p-1',
          nodeOrderId: 'ord-1',
          docType: 'shop_drawing',
          file: expect.any(File),
        }),
      )
      expect(mockAddDrawing).toHaveBeenCalledWith('p-1', 'ord-1', 'p-1/ord-1/shop_drawing/1-d.pdf', 'd.pdf')
    })
    expect(mockRemoveFile).not.toHaveBeenCalled()
  })

  it('removes the uploaded object and shows the error when the DB attach fails', async () => {
    mockUploadFile.mockResolvedValue({ storagePath: 'p-1/ord-1/shop_drawing/1-orphan.pdf', fileName: 'orphan.pdf' })
    mockAddDrawing.mockResolvedValue({ error: 'Order not found' })

    const { container } = renderList()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, new File(['pdf'], 'orphan.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(mockRemoveFile).toHaveBeenCalledWith('p-1/ord-1/shop_drawing/1-orphan.pdf')
      expect(screen.getByText(/Order not found/)).toBeTruthy()
    })
  })
})
